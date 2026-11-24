# Subdomain 4.3: Snowflake Caching

Snowflake uses **three layers of caching** to avoid redundant work and speed up queries. Understanding *what each layer caches*, *where it lives*, and *when it's used* is the key to this objective.

---

## Overview: The Three Cache Layers

| Cache | Lives in | Caches | Lifespan | Serves |
|-------|----------|--------|----------|--------|
| **Metadata cache** | Cloud Services layer | Table/micro-partition statistics (row counts, min/max, distinct, etc.) | Persistent (maintained continuously) | Metadata-only queries + pruning |
| **Query result cache** | Cloud Services layer | The **final result set** of a query | 24 hours (resets to 24h on reuse, up to 31 days) | Identical repeated queries |
| **Warehouse (data) cache** | The virtual warehouse's local SSD | Raw **micro-partition data** read from storage | While the warehouse is running (lost on suspend) | Queries scanning the same data |

**Order Snowflake checks them:**
```
1. Metadata cache   — can I answer from statistics alone? (no compute)
2. Result cache     — has this exact query been run recently? (no compute)
3. Warehouse cache  — is the needed data already on local SSD? (compute, less I/O)
4. Remote storage   — otherwise read from cloud storage (compute + full I/O)
```

---

## 1. Metadata Cache

**What it is:** Snowflake continuously maintains **metadata/statistics** about every table and micro-partition in the **Cloud Services layer** — independent of any warehouse.

**What it stores (micro-partition metadata):**
- Row count of the table and per-partition.
- **MIN/MAX** values, number of **distinct** values, **NULL** counts per column per micro-partition.

**How it helps performance:**
- **Metadata-only queries** — some queries are answered **without a running warehouse** (no compute credits), e.g.:
  - `SELECT COUNT(*) FROM t`
  - `SELECT MIN(col), MAX(col) FROM t` (for supported data types)
  - `SHOW`, `DESCRIBE`, and many `INFORMATION_SCHEMA` lookups.
- **Pruning** — the MIN/MAX metadata lets Snowflake **skip micro-partitions** that can't match a filter, drastically reducing data scanned.

**Important nuance:**
- `MIN`/`MAX` are answered **from metadata only for certain data types**. For some types (or when expressions are involved), Snowflake must actually scan data — so a warehouse is required and it isn't "free."

---

## 2. Query Result Cache

**What it is:** Snowflake stores the **exact result set** of every query for **24 hours** in the Cloud Services layer. A matching repeat query returns the cached result **instantly, with no warehouse compute**.

**Conditions for a result-cache hit:**
1. The **new query syntactically matches** a previous query (whitespace/case aside).
2. The **underlying data has not changed** (no DML on the referenced tables since).
3. The query **does not use non-deterministic functions** (e.g., `CURRENT_TIMESTAMP()`, `RANDOM()`) in a way that would change results.
4. The **role has the necessary privileges** on the objects.
5. Result caching is **enabled** (`USE_CACHED_RESULT = TRUE`, the default).

**Lifespan:**
- Base retention **24 hours**; each reuse **resets the 24-hour clock**, extending up to a maximum of **31 days**, after which the result is purged.

**Key trait:** A result-cache hit needs **no running warehouse at all** — zero compute credits.

**Disable for testing:**
```sql
ALTER SESSION SET USE_CACHED_RESULT = FALSE;   -- force real execution
```

---

## 3. Warehouse (Data / Local Disk) Cache

**What it is:** Each running virtual warehouse caches the **raw micro-partition data** it reads from remote storage onto its **local SSD**. Subsequent queries on the **same data** read from fast local disk instead of remote storage.

**How it helps:**
- Reduces **remote I/O** — the slowest part of scanning.
- Repeated/similar queries on the same table run faster after the first "warms" the cache.

**Lifespan & behavior:**
- Tied to the **warehouse being running**. **Suspending the warehouse clears the cache**; resuming starts cold.
- **Larger warehouses** have **more local cache** (more/larger nodes).
- Resizing or the warehouse being reprovisioned can also reset it.

**Optimization tips:**
- **Don't set AUTO_SUSPEND too aggressively** if you rely on cache warmth — suspending loses the cache. Balance cache reuse vs. idle credit cost.
- Route **similar workloads to the same warehouse** so they share a warm cache.
- Partial cache: a query may get **some** partitions from cache and read the rest from remote storage (shown in the profile as "percentage scanned from cache").

---

## Comparing the Caches

| | Metadata | Result | Warehouse (data) |
|---|----------|--------|------------------|
| **Needs a running warehouse?** | No | No | Yes |
| **Consumes compute credits?** | No | No | Yes (but less I/O) |
| **Invalidated by** | DML (metadata updates) | Any DML on referenced tables | Warehouse suspend/resize |
| **Where** | Cloud Services | Cloud Services | Warehouse local SSD |
| **Speeds up** | COUNT/MIN/MAX, pruning | Identical repeated queries | Re-scanning same data |

---

## Quick Reference Summary

- **Metadata cache** → answers `COUNT(*)`, `MIN`/`MAX` (some types), and powers pruning; **no warehouse needed**.
- **Result cache** → identical query + unchanged data = instant result, **no compute**; 24h (up to 31 days with reuse).
- **Warehouse cache** → warm local SSD copy of scanned data; **lost on suspend**; bigger warehouse = more cache.

**Exam cues:**
- "Same query returns instantly with no warehouse" → **result cache**.
- "COUNT(*) with no running warehouse" → **metadata cache**.
- "Second run faster, but slows down after the warehouse was suspended" → **warehouse (data) cache**.

---

## Reference Links (from Snowflake docs)

- Optimizing the warehouse cache
- Using Persisted Query Results (query result cache)
- MIN and MAX functions only use metadata-based results for some data types
- Micro-partitions — Metadata
