# Subdomain 4.2: Optimize Query Performance — End-to-End Walkthroughs

Companion to `concepts.md`. Each optimization is shown **end-to-end**: baseline problem → enable feature → **what you actually see** (before/after profile stats, estimates, clustering info).

> Convention:
> - 🔴 = before (slow)
> - 🟢 = after (optimized)
> - Output blocks show the **actual statistics or estimate**.

---

## Scenario Setup

```sql
USE ROLE SYSADMIN;
USE WAREHOUSE analyst_wh;   -- SMALL
USE SCHEMA sales_db.public;
-- events: 5 TB, ~200,000 micro-partitions, loaded roughly by event_date
```

---

## 1. Query Acceleration Service — End to End

### Baseline: a bursty large scan
```sql
SELECT event_type, COUNT(*)
FROM events
WHERE event_date BETWEEN '2026-01-01' AND '2026-06-30'
GROUP BY event_type;
```
🔴 Profile: one giant `TableScan` dominates; runs 240s on a SMALL warehouse.

### Step 1: Estimate eligibility before enabling
```sql
SELECT SYSTEM$ESTIMATE_QUERY_ACCELERATION('01a2b3c4-...');   -- a query_id
```
```json
{
  "estimatedQueryTimes": {
     "originalQueryTime": 240,
     "estimatedQueryTimeWithAcceleration": 65
  },
  "upperLimitScaleFactor": 8,
  "status": "eligible"
}
```

### Step 2: Enable QAS on the warehouse
```sql
ALTER WAREHOUSE analyst_wh SET
  ENABLE_QUERY_ACCELERATION = TRUE
  QUERY_ACCELERATION_MAX_SCALE_FACTOR = 8;
```

### Step 3: What you see after re-running
🟢 Profile now shows a **Query Acceleration** node; runtime drops ~240s → ~65s. Check what got accelerated:
```sql
SELECT query_id, eligible_query_acceleration_time, upper_limit_scale_factor
FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_ACCELERATION_ELIGIBLE
WHERE warehouse_name = 'ANALYST_WH'
ORDER BY eligible_query_acceleration_time DESC;
```

**Point driven home:** QAS borrows **serverless** compute for the heavy scan step — you get big-warehouse speed on the occasional monster query without paying for a big warehouse all day.

---

## 2. Search Optimization Service — End to End

### Baseline: a needle-in-haystack lookup
```sql
SELECT * FROM events WHERE user_email = 'alice@corp.com';   -- ~5 rows out of billions
```
🔴 Profile:
```
Partitions scanned: 198,442 / 200,000   🔴  (email isn't a clustering key → almost full scan)
Duration: 88s
```

### Step 1: Estimate cost, then enable SOS
```sql
SELECT SYSTEM$ESTIMATE_SEARCH_OPTIMIZATION_COSTS('events', 'EQUALITY(user_email)');
```
```json
{ "tableName":"EVENTS",
  "costPositions":[
     {"name":"BuildCosts","value":12.4,"unit":"Credits"},
     {"name":"StorageCosts","value":38.0,"unit":"GB"} ] }
```
```sql
ALTER TABLE events ADD SEARCH OPTIMIZATION ON EQUALITY(user_email);
```

### Step 2: Confirm it's built
```sql
SHOW TABLES LIKE 'events';
```
```
| name   | search_optimization | search_optimization_progress |
|--------+---------------------+-------------------------------|
| EVENTS | ON                  | 100                           |  <- fully built
```

### Step 3: Re-run the lookup
🟢 Profile:
```
Partitions scanned: 3 / 200,000        (uses the search access path)
Duration: 1.2s
```

**Point driven home:** SOS turned an 88s near-full-scan into a 1.2s targeted lookup by pruning to 3 partitions. It shines **only** for **selective** predicates — a query returning millions of rows wouldn't benefit.

---

## 3. Clustering — End to End

### Baseline: poor clustering on a common filter
```sql
SELECT * FROM events WHERE customer_id = 4472
  AND event_date BETWEEN '2026-06-01' AND '2026-06-30';
```
Check current clustering health:
```sql
SELECT SYSTEM$CLUSTERING_INFORMATION('events', '(customer_id)');
```
🔴
```json
{
  "cluster_by_keys": "LINEAR(customer_id)",
  "average_depth": 412.7,               <- high overlap = poorly clustered
  "partition_depth_histogram": { "00001": 20, "01024": 180000 }
}
```

### Step 1: Define a clustering key
```sql
ALTER TABLE events CLUSTER BY (customer_id, event_date);
```
Automatic Clustering (serverless) now reorganizes in the background.

### Step 2: Monitor re-clustering
```sql
SELECT start_time, credits_used, num_rows_reclustered
FROM SNOWFLAKE.ACCOUNT_USAGE.AUTOMATIC_CLUSTERING_HISTORY
WHERE table_name = 'EVENTS' ORDER BY start_time DESC;
```
```
+---------------------+--------------+----------------------+
| START_TIME          | CREDITS_USED | NUM_ROWS_RECLUSTERED |
|---------------------+--------------+----------------------|
| 2026-09-23 20:10:00 |     18.2     |     2,400,000,000    |
+---------------------+--------------+----------------------+
```

### Step 3: Clustering health after
🟢
```sql
SELECT SYSTEM$CLUSTERING_INFORMATION('events', '(customer_id, event_date)');
```
```json
{ "average_depth": 2.3,   <- much lower = well clustered
  "partition_depth_histogram": { "00001": 150000, "00004": 500 } }
```
Re-run the query → partitions scanned drops sharply, query is fast.

**Point driven home:** `average_depth` is the clustering health metric — high = overlapping partitions (bad pruning), low = well separated (good pruning). Automatic Clustering maintains this for a serverless cost, so only cluster **large tables with a consistent filter/join key**.

---

## 4. Materialized Views — End to End

### Baseline: the same expensive aggregate, run all day by dashboards
```sql
SELECT event_date, event_type, COUNT(*) AS cnt, SUM(revenue) AS rev
FROM events GROUP BY event_date, event_type;   -- scans 5 TB every run
```
🔴 ~120s each time, run 200x/day by BI tools.

### Step 1: Create a materialized view
```sql
CREATE MATERIALIZED VIEW mv_daily_events AS
  SELECT event_date, event_type, COUNT(*) AS cnt, SUM(revenue) AS rev
  FROM events GROUP BY event_date, event_type;
```

### Step 2: Query rewrite — you don't even reference the MV
```sql
-- Same original query against the BASE table:
SELECT event_date, event_type, COUNT(*), SUM(revenue)
FROM events GROUP BY event_date, event_type;
```
🟢 Profile shows the scan replaced by the MV:
```
Operator: MaterializedViewScan (MV_DAILY_EVENTS)   <- auto-substituted!
Partitions scanned: 42 / 42
Duration: 0.8s
```

### Step 3: Monitor MV maintenance
```sql
SELECT * FROM TABLE(INFORMATION_SCHEMA.MATERIALIZED_VIEW_REFRESH_HISTORY());
SELECT table_name, credits_used
FROM SNOWFLAKE.ACCOUNT_USAGE.MATERIALIZED_VIEW_REFRESH_HISTORY
ORDER BY start_time DESC;
```

**Point driven home:** Snowflake **automatically rewrote** the base-table query to hit the MV (0.8s vs 120s) — no query change needed. Worth it here because the aggregate is run 200x/day; if the base table churned constantly, maintenance cost could erase the gain.

---

## 5. Choosing Between Them — Same Table, Different Problems

```sql
-- Problem A: find one user's rows       → SEARCH OPTIMIZATION
SELECT * FROM events WHERE user_email = 'x@y.com';

-- Problem B: range scan on a key, huge   → CLUSTERING
SELECT * FROM events WHERE customer_id = 4472 AND event_date > '2026-06-01';

-- Problem C: occasional 6-month scan      → QUERY ACCELERATION
SELECT event_type, COUNT(*) FROM events WHERE event_date BETWEEN ... GROUP BY 1;

-- Problem D: same daily rollup 200x/day    → MATERIALIZED VIEW
SELECT event_date, COUNT(*) FROM events GROUP BY event_date;
```

**Point driven home:** These are **complementary**, not competing. A single large table might use SOS for lookups *and* clustering for range scans *and* an MV for rollups — each targeting a different query shape.

---

## Mental Model Recap

| Feature | You run… | You see… | Key takeaway |
|---------|----------|----------|--------------|
| QAS | `ALTER WAREHOUSE ... ENABLE_QUERY_ACCELERATION` | acceleration node, faster scan | Serverless boost for bursty scans |
| SOS | `ALTER TABLE ADD SEARCH OPTIMIZATION` | partitions scanned → a handful | Only for selective lookups |
| Clustering | `ALTER TABLE CLUSTER BY (...)` | `average_depth` drops | Big tables, consistent filter key |
| Materialized View | `CREATE MATERIALIZED VIEW` | auto query rewrite, precomputed | Repeated aggregates, stable data |

> ⚠️ **Verify before exam/production:** exact function names (`SYSTEM$ESTIMATE_QUERY_ACCELERATION`, `SYSTEM$CLUSTERING_INFORMATION`, `SYSTEM$ESTIMATE_SEARCH_OPTIMIZATION_COSTS`), view names, and MV restrictions change over time. Confirm against current Snowflake docs.
