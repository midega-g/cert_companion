# Subdomain 4.3: Snowflake Caching — End-to-End Walkthroughs

Companion to `concepts.md`. Each cache layer is shown **end-to-end**: run a query → observe the effect → **what you actually see** (profile stats, query history flags, timings) that proves which cache served it.

> Convention:
> - 🟢 = cache hit (fast / free)
> - 🔴 = cache miss (full work)
> - Output blocks show the **actual profile note or history value**.

---

## Scenario Setup

```sql
USE ROLE SYSADMIN;
USE WAREHOUSE analyst_wh;
USE SCHEMA sales_db.public;
-- orders: 500M rows
```

---

## 1. Metadata Cache — End to End (no warehouse needed)

### Suspend the warehouse first — to prove no compute is used
```sql
ALTER WAREHOUSE analyst_wh SUSPEND;
```

### Metadata-only query
```sql
SELECT COUNT(*) FROM orders;
```
🟢 Returns **instantly even with the warehouse suspended**:
```
+-----------+
| COUNT(*)  |
|-----------|
| 500000000 |
+-----------+
```
Profile confirms it:
```
Query Profile: METADATA-BASED RESULT
  (no TableScan, no warehouse compute)
```

### MIN/MAX — metadata for supported types
```sql
SELECT MIN(order_date), MAX(order_date) FROM orders;   -- DATE: served from metadata
```
🟢 Also instant, no warehouse.

### But an expression forces a scan
```sql
SELECT MAX(amount * 1.1) FROM orders;   -- expression → cannot use metadata
```
🔴
```
Error / behavior: warehouse must be resumed; this does a real scan.
```

**Point driven home:** `COUNT(*)` and `MIN`/`MAX` on supported types are answered from **micro-partition metadata** — no warehouse, no credits. Wrap the column in an expression and the metadata shortcut is lost.

---

## 2. Query Result Cache — End to End

### Step 1: First run (cold) — real execution
```sql
ALTER WAREHOUSE analyst_wh RESUME;
SELECT region, SUM(amount) FROM orders GROUP BY region;   -- run 1
```
🔴 Runs on the warehouse, ~9s. In Query History:
```
| QUERY_ID | EXECUTION_TIME | BYTES_SCANNED | ... |
| 01a...   |     9,120 ms   |   42 GB       |     |
```

### Step 2: Identical re-run — result cache hit
```sql
SELECT region, SUM(amount) FROM orders GROUP BY region;   -- run 2 (identical)
```
🟢 Returns in ~50ms. Query History shows the tell-tale sign:
```
| QUERY_ID | EXECUTION_TIME | BYTES_SCANNED | PERCENTAGE_SCANNED_FROM_CACHE |
| 01b...   |      48 ms     |    0 B        |            —                  |
```
And in the profile:
```
Query Profile: QUERY RESULT REUSE   <- served from result cache, 0 compute
```

### Step 3: Change data → cache invalidated
```sql
INSERT INTO orders VALUES (999999, 'EMEA', 100, CURRENT_DATE());
SELECT region, SUM(amount) FROM orders GROUP BY region;   -- run 3
```
🔴 Full execution again (~9s) — the INSERT invalidated the cached result.

### Step 4: Prove it by disabling the cache
```sql
ALTER SESSION SET USE_CACHED_RESULT = FALSE;
SELECT region, SUM(amount) FROM orders GROUP BY region;   -- always re-executes now
ALTER SESSION SET USE_CACHED_RESULT = TRUE;
```

**Point driven home:** A result-cache hit shows `QUERY RESULT REUSE` with **0 bytes scanned and no warehouse compute**. Any DML on the referenced table invalidates it. `USE_CACHED_RESULT = FALSE` forces real execution — essential when benchmarking.

---

## 3. Warehouse (Data) Cache — End to End

### Step 1: Cold cache (fresh/resumed warehouse)
```sql
ALTER WAREHOUSE analyst_wh SUSPEND;   -- clear the local cache
ALTER WAREHOUSE analyst_wh RESUME;    -- starts cold
ALTER SESSION SET USE_CACHED_RESULT = FALSE;  -- isolate the DATA cache from RESULT cache

SELECT customer, SUM(amount) FROM orders
WHERE order_date > '2026-01-01' GROUP BY customer;   -- run 1 (cold)
```
🔴 Profile:
```
TableScan (ORDERS)
  Partitions scanned: 12,000
  Percentage scanned from cache: 0%     🔴  (cold — all from remote storage)
  Duration: 14s
```

### Step 2: Warm cache (same warehouse, similar query)
```sql
SELECT customer, AVG(amount) FROM orders
WHERE order_date > '2026-01-01' GROUP BY customer;   -- run 2 (same data, warm)
```
🟢 Profile:
```
TableScan (ORDERS)
  Percentage scanned from cache: 94%    🟢  (data now on local SSD)
  Duration: 4s
```

### Step 3: Suspend clears it
```sql
ALTER WAREHOUSE analyst_wh SUSPEND;
ALTER WAREHOUSE analyst_wh RESUME;
-- re-run run 2 → back to "Percentage scanned from cache: 0%" (cold again)
```

**Point driven home:** The **"Percentage scanned from cache"** stat in the profile is the warehouse data cache in action — 0% cold, high% warm. **Suspending wipes it**, so aggressive `AUTO_SUSPEND` trades cache warmth for idle-credit savings.

---

## 4. Seeing All Three Interact — One Sequence

```sql
-- (a) metadata: instant, warehouse can be suspended
SELECT COUNT(*) FROM orders;                       -> METADATA-BASED RESULT

-- (b) first analytic query: warehouse cache cold, real work
SELECT region, SUM(amount) FROM orders GROUP BY region;   -> 9s, 0% from cache

-- (c) identical repeat: result cache
SELECT region, SUM(amount) FROM orders GROUP BY region;   -> 48ms, QUERY RESULT REUSE

-- (d) different query, same data: warehouse (data) cache
SELECT region, AVG(amount) FROM orders GROUP BY region;   -> faster, high % from cache
```

**Point driven home:** Snowflake checks caches **in order** — metadata → result → warehouse data → remote. Each layer that hits saves progressively less but the outcome is the same: less work.

---

## Mental Model Recap

| You observe… | Cache responsible | Proof in profile/history |
|--------------|-------------------|--------------------------|
| `COUNT(*)`/`MIN`/`MAX` instant, WH suspended | **Metadata** | "METADATA-BASED RESULT", no compute |
| Identical query instant, 0 bytes scanned | **Result** | "QUERY RESULT REUSE", `USE_CACHED_RESULT` |
| 2nd run faster, drops after suspend | **Warehouse (data)** | "Percentage scanned from cache" % |

**Benchmarking rule:** to test the **data cache**, disable the **result cache** (`USE_CACHED_RESULT=FALSE`) first — otherwise the result cache masks it.

> ⚠️ **Verify before exam/production:** exact profile labels ("QUERY RESULT REUSE", "Percentage scanned from cache"), result-cache retention (24h → up to 31 days), and which data types allow metadata-only MIN/MAX change over time. Confirm against current Snowflake docs.
