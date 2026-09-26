# Subdomain 4.1: Evaluate Query Performance — End-to-End Walkthroughs

Companion to `concepts.md`. Each tool is shown **end-to-end**: run something → inspect it → **what you actually see** (profile stats, insight banners, history rows) → what the numbers mean and how to fix.

> Convention:
> - 🔴 = symptom of a problem
> - 🟢 = healthy / after fix
> - Output blocks show the **actual statistics or result set**.

---

## Scenario Setup

```sql
USE ROLE SYSADMIN;
USE WAREHOUSE analyst_wh;
USE SCHEMA sales_db.public;
-- orders: 500M rows, ordered by order_date (well-clustered on date)
-- customers: 2M rows
```

---

## 1. Query Profile — Reading a Slow Query

### A poorly pruned query
```sql
SELECT * FROM orders
WHERE TO_DATE(order_ts) = '2026-09-01';   -- function wraps the column
```
Open **Query Profile** in Snowsight. What you see in the statistics panel:
```
Profile — TableScan (ORDERS)
  Partitions scanned:  48,201 / 48,201   🔴  (100% — no pruning!)
  Bytes scanned:       412 GB
  % of total time:     91%
```

**Interpretation:** Wrapping `order_ts` in `TO_DATE()` **defeats pruning** — Snowflake can't use partition min/max on the raw column, so it scans everything.

### The fix — filter the raw column
```sql
SELECT * FROM orders
WHERE order_ts >= '2026-09-01' AND order_ts < '2026-09-02';
```
🟢 Profile now:
```
Partitions scanned:  132 / 48,201        (0.27% — pruned!)
Bytes scanned:       1.1 GB
% of total time:     40%
```

**Point driven home:** The single most important profile stat is often **partitions scanned vs. total**. Same result, 400x less data read — just by not wrapping the filtered column in a function.

---

## 2. Query Insights — Named Problem Detection

### Spilling (query too large to fit in memory)
```sql
SELECT customer_id, LISTAGG(product, ',')
FROM orders GROUP BY customer_id
ORDER BY COUNT(*) DESC;
```
Snowsight **Query Insights** banner:
```
🔴 Insight: "This query spilled to remote storage"
   1.8 GB spilled to local, 640 MB spilled to remote storage.
   Consider using a larger warehouse or reducing the data processed.
```
Confirm in the profile statistics:
```
Bytes spilled to local storage:   1.8 GB
Bytes spilled to remote storage:  640 MB   🔴  (remote spill = severe)
```
**Fix:** size up the warehouse (S → L) so the working set fits in memory, or reduce data before the sort/aggregate.

### Row explosion (bad join)
```sql
SELECT o.*, c.*
FROM orders o JOIN customers c ON o.region = c.region;   -- non-unique key
```
Insight banner:
```
🔴 Insight: "Row explosion detected"
   A join produced significantly more rows than its inputs
   (input 500M, output 118B). Check your join keys.
```
Profile shows the join operator output rows >> input rows.
**Fix:** join on a **unique key** (`o.customer_id = c.customer_id`), not a low-cardinality column like `region`.

**Point driven home:** Insights name the *category* (spilling / row explosion / pruning / queuing); the profile confirms it with hard numbers.

---

## 3. EXPLAIN — Check the Plan Without Running

```sql
EXPLAIN USING TEXT
SELECT * FROM orders WHERE order_ts >= '2026-09-01' AND order_ts < '2026-09-02';
```
🟢 What you see (planned, no execution/cost):
```
GlobalStats:
  partitionsTotal=48201
  partitionsAssigned=132        <- estimated pruning BEFORE you run it
  bytesAssigned=1181116006
Operations:
  1:0  TableScan  ORDERS  order_ts, ...  {partitionsAssigned:132}
  1:1  Filter     ORDERS.ORDER_TS >= ...
  1:2  Result
```

**Point driven home:** `EXPLAIN` shows `partitionsAssigned` **before** running — a cheap way to verify a filter will prune well without paying to execute.

---

## 4. Query History — Find the Expensive Queries

### Recent slow queries (historical, account-wide)
```sql
SELECT query_id, user_name, warehouse_name,
       total_elapsed_time/1000 AS secs,
       partitions_scanned, partitions_total,
       bytes_spilled_to_remote_storage AS remote_spill,
       queued_overload_time/1000 AS queued_secs
FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
WHERE start_time > DATEADD('day', -1, CURRENT_TIMESTAMP())
ORDER BY total_elapsed_time DESC
LIMIT 5;
```
```
+----------+-----------+----------------+------+--------------------+------------------+--------------+-------------+
| QUERY_ID | USER_NAME | WAREHOUSE_NAME | SECS | PARTITIONS_SCANNED | PARTITIONS_TOTAL | REMOTE_SPILL | QUEUED_SECS |
|----------+-----------+----------------+------+--------------------+------------------+--------------+-------------|
| 01a...   | JDOE      | ANALYST_WH     | 182  |      48201         |     48201        |  640 MB      |    0        | 🔴 no pruning + spill
| 01b...   | ETL       | ETL_WH         | 95   |       132          |     48201        |   0          |   42        | 🔴 42s queued
+----------+-----------+----------------+------+--------------------+------------------+--------------+-------------+
```
**Reading it:** Row 1 scanned 100% of partitions and spilled → pruning + memory problem. Row 2 pruned fine but sat **42s queued** → warehouse concurrency problem.

### Cost attribution — which queries burn credits
```sql
SELECT query_id, user_name, credits_attributed_compute
FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_ATTRIBUTION_HISTORY
WHERE start_time > DATEADD('day', -7, CURRENT_TIMESTAMP())
ORDER BY credits_attributed_compute DESC LIMIT 5;
```
```
+----------+-----------+----------------------------+
| QUERY_ID | USER_NAME | CREDITS_ATTRIBUTED_COMPUTE |
|----------+-----------+----------------------------|
| 01a...   | JDOE      |          12.4              |  <- the expensive one to fix first
| 01c...   | BI_SVC    |           3.1              |
+----------+-----------+----------------------------+
```

### Real-time variant (no latency, shorter retention)
```sql
SELECT * FROM TABLE(INFORMATION_SCHEMA.QUERY_HISTORY_BY_USER(
  USER_NAME => 'JDOE', RESULT_LIMIT => 10));
```

**Point driven home:** `ACCOUNT_USAGE.QUERY_HISTORY` = trends over a year (with latency); `QUERY_ATTRIBUTION_HISTORY` = which queries cost the most; `INFORMATION_SCHEMA` functions = right-now.

---

## 5. Warehouse Workload — Diagnose Queuing

```sql
SELECT start_time,
       avg_running,        -- queries executing
       avg_queued_load     -- queries waiting for a slot
FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_LOAD_HISTORY
WHERE warehouse_name = 'ETL_WH'
  AND start_time > DATEADD('hour', -6, CURRENT_TIMESTAMP())
ORDER BY start_time;
```
```
+---------------------+-------------+-----------------+
| START_TIME          | AVG_RUNNING | AVG_QUEUED_LOAD |
|---------------------+-------------+-----------------|
| 2026-09-23 14:00    |    8.0      |     0.0         | 🟢 healthy
| 2026-09-23 15:00    |    8.0      |     6.4         | 🔴 queries waiting
+---------------------+-------------+-----------------+
```

**Interpretation:** At 15:00, `avg_queued_load = 6.4` means ~6 queries were consistently **waiting**. The warehouse is saturated.

**Fix — enable multi-cluster to absorb concurrency:**
```sql
ALTER WAREHOUSE etl_wh SET
  MIN_CLUSTER_COUNT = 1
  MAX_CLUSTER_COUNT = 3
  SCALING_POLICY = 'STANDARD';
```
After the change, `avg_queued_load` should drop toward 0 as extra clusters spin up under load.

**Point driven home:** Queuing is a **warehouse** problem, not a query problem — the fix is **scale-out (multi-cluster)** for concurrency, distinct from **scale-up (bigger size)** for a single heavy query's memory.

---

## Mental Model Recap

| Symptom | Where you see it | Root cause | Fix |
|---------|------------------|-----------|-----|
| Partitions scanned ≈ total | Profile / QUERY_HISTORY | Poor/inefficient pruning | Filter raw column; cluster key |
| Bytes spilled to remote | Insights / Profile | Too big for memory | Size **up** warehouse; reduce data |
| Join output >> input rows | Insights / Profile | Row explosion | Join on unique key |
| High queued_overload_time | QUERY_HISTORY / WAREHOUSE_LOAD_HISTORY | Warehouse saturated | Scale **out** (multi-cluster) |
| Which query costs most? | QUERY_ATTRIBUTION_HISTORY | — | Optimize top consumers first |
| Verify plan cheaply | `EXPLAIN` | — | Check partitionsAssigned pre-run |

> ⚠️ **Verify before exam/production:** exact column names (`queued_overload_time`, `credits_attributed_compute`, `avg_queued_load`), `EXPLAIN` output format, and view latencies change over time. Confirm against current Snowflake docs.
