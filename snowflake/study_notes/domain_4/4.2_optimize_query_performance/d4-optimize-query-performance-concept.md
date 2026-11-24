# Subdomain 4.2: Optimize Query Performance

Snowflake's architecture minimizes manual tuning, but several **optional features** let you optimize performance for specific workloads. This note covers the four levers: Query Acceleration Service, Search Optimization Service, Clustering, and Materialized Views — and **when each one applies**.

---

## Overview: Choosing the Right Optimization

| Feature | Best for | What it does | Cost model |
|---------|----------|--------------|------------|
| **Query Acceleration Service (QAS)** | Unpredictable, scan-heavy queries with outlier steps | Offloads parts of a scan to **serverless** compute | Serverless credits |
| **Search Optimization Service (SOS)** | Highly selective **point lookups** on large tables | Builds a **search access path** (per-column index-like structure) | Serverless (maintenance + storage) |
| **Clustering** | Very large tables filtered/joined on a specific column | Physically **co-locates** data by a clustering key → better pruning | Serverless (auto-clustering) |
| **Materialized Views** | Repeated expensive aggregations on stable data | **Precomputes & stores** results, auto-maintained | Storage + serverless maintenance |

**Mental model:**
- **Scan too much data unpredictably?** → QAS
- **Looking for a needle in a haystack (few rows)?** → SOS
- **Always filter/join a huge table on the same column?** → Clustering
- **Same expensive aggregation over and over?** → Materialized View

---

## 1. Query Acceleration Service (QAS)

**What it is:** A service that **offloads portions of eligible queries** (especially large scans and filtering) to **additional serverless compute**, running them in parallel outside your warehouse.

**How it helps:**
- Handles queries with **unpredictable or bursty** data volumes without permanently sizing up the warehouse.
- Especially useful for queries where a **small number of steps** (e.g., a huge scan) dominate — those steps are accelerated.

**How to use it:**
- Enable per warehouse: `ALTER WAREHOUSE ... SET ENABLE_QUERY_ACCELERATION = TRUE`.
- Set a scale factor cap: `QUERY_ACCELERATION_MAX_SCALE_FACTOR` (limits how much extra compute QAS can add relative to the warehouse).
- Check eligibility with `SYSTEM$ESTIMATE_QUERY_ACCELERATION` and the `QUERY_ACCELERATION_ELIGIBLE` view.

**Best for:** ad-hoc/BI workloads with occasional very large scans, where sizing up the whole warehouse would waste money on the common case.

---

## 2. Search Optimization Service (SOS)

**What it is:** A table-level feature that builds and maintains a **search access path** — an optimized data structure that makes **highly selective lookups** (equality and some range/`IN` predicates) fast on **large tables**.

**How it helps:**
- Dramatically speeds up **point lookups** (few rows out of billions) that would otherwise scan many partitions.
- Supports equality/IN predicates, and can cover **substring/regex**, **VARIANT** fields, and **geospatial** with appropriate configuration.

**How to use it:**
```sql
ALTER TABLE big_table ADD SEARCH OPTIMIZATION;
-- or target specific columns/methods:
ALTER TABLE big_table ADD SEARCH OPTIMIZATION ON EQUALITY(email), SUBSTRING(notes);
```
- Check with `SHOW TABLES` (search_optimization column) and `SYSTEM$ESTIMATE_SEARCH_OPTIMIZATION_COSTS`.

**Best for:** selective queries returning a **small fraction** of rows from a large table. Not helpful for queries that scan most of the table (use clustering/QAS instead).

**SOS vs. Clustering:** SOS targets **selective lookups** (find few rows); clustering improves **range scans/pruning** on a sort column. They can complement each other.

---

## 3. Clustering

**What it is:** Snowflake stores data in **micro-partitions**; a **clustering key** defines how rows are **physically co-located** so that queries filtering/joining on that key **prune** away irrelevant partitions.

**Key concepts:**
- **Natural clustering** — data is already somewhat ordered by load order (e.g., by date if loaded chronologically).
- **Clustering key** — an explicit key you define when natural clustering isn't enough:
  ```sql
  ALTER TABLE events CLUSTER BY (event_date, customer_id);
  ```
- **Automatic Clustering** — a **serverless** background service that **re-clusters** the table as data changes to maintain good clustering, with no manual reorganization.
- **Clustering depth / `SYSTEM$CLUSTERING_INFORMATION`** — metrics showing how well-clustered a table is (lower depth/overlap = better).

**When to cluster:**
- **Very large** tables (multi-TB) that are **frequently filtered or joined** on the same column(s), where pruning is currently poor.
- **Not** worth it for small tables or tables without a consistent filter column — clustering has ongoing serverless cost.

**Best practice:** choose a clustering key with **moderate cardinality** matching common filter/join predicates; avoid extremely high-cardinality keys (like a unique ID) or very low-cardinality keys.

---

## 4. Materialized Views

**What it is:** A view whose results are **precomputed and physically stored**, then **automatically kept up to date** by Snowflake as the base table changes.

**How it helps:**
- Queries hitting the MV read **precomputed results** instead of recomputing expensive aggregations/filters each time.
- Snowflake can **automatically rewrite** a query against the base table to use a matching MV (transparent acceleration).

**Characteristics & limits:**
- Maintained by a **serverless** background process (cost to keep fresh).
- **Restrictions:** a single base table only (no joins), limited aggregate functions, no `ORDER BY`, no `UNION`, etc.
- Best when the base data **changes less frequently** than the MV is queried (otherwise maintenance cost outweighs benefit).

**Materialized View vs. Dynamic Table:**
| | Materialized View | Dynamic Table |
|---|-------------------|---------------|
| Scope | Single table, limited SQL | Multi-table joins, richer SQL |
| Refresh | Automatic, continuous | `TARGET_LAG`-driven |
| Query rewrite | Yes (auto-substitution) | No (query the table directly) |

**Best for:** frequently-run, expensive aggregations/projections over a **single**, relatively **stable** large table.

---

## SQL Performance Tips (general)

- **Filter early and selectively** on clustered/pruned columns; avoid wrapping filter columns in functions (defeats pruning).
- **Select only needed columns** (Snowflake is columnar — fewer columns = less scanned).
- **Right-size warehouses**; use result cache for repeated identical queries.
- **Avoid row explosion** — join on unique keys.
- Use the **profile** to confirm the optimization actually reduced partitions scanned / spilling.

---

## Quick Reference Summary

| Feature | Enable with | Serverless? | Best for |
|---------|-------------|-------------|----------|
| **QAS** | `ALTER WAREHOUSE SET ENABLE_QUERY_ACCELERATION=TRUE` | Yes | Bursty large scans |
| **SOS** | `ALTER TABLE ADD SEARCH OPTIMIZATION` | Yes | Selective point lookups |
| **Clustering** | `ALTER TABLE CLUSTER BY (...)` | Yes (auto-clustering) | Huge tables filtered on a key |
| **Materialized View** | `CREATE MATERIALIZED VIEW` | Yes | Repeated aggregations, stable data |

**Decision cues:**
- Few rows from a big table → **SOS**
- Range/filter on a sort column, big table → **Clustering**
- Occasional giant scan, don't want to size up → **QAS**
- Same costly aggregate repeatedly → **Materialized View**

---

## Reference Links (from Snowflake docs)

- Optimizing Performance in Snowflake (SQL performance tips)
- Using the Query Acceleration Service
- Search Optimization Service
- What is Data Clustering? / Clustering Keys & Clustered Tables / Automatic Clustering
- Working with Materialized Views
