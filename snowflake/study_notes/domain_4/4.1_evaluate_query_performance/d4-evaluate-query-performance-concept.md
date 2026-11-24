# Subdomain 4.1: Evaluate Query Performance

Knowing how to access and interpret a **query profile** helps you find where a query spends time and how to make it more efficient. This note covers the built-in tools for analyzing performance: Query Profile, Query Insights, Query History, and warehouse workload views.

---

## Overview: The Performance Toolkit

| Tool | Answers | Where |
|------|---------|-------|
| **Query Profile** | *Why* is this one query slow? (step-by-step execution) | Snowsight, per query |
| **Query Insights** | *What common problem* is hurting this query? | Snowsight, per query |
| **Query History** | *Which* queries ran, by whom, how long? | Snowsight + `QUERY_HISTORY` views |
| **Warehouse workload** | Is the *warehouse* overloaded/queuing? | `WAREHOUSE_LOAD_HISTORY`, metering |
| **EXPLAIN** | *Planned* execution without running | SQL `EXPLAIN` |

---

## 1. Query Profile

**What it is:** A **visual, step-by-step breakdown** of how a query executed — the operator tree, time spent in each step, rows processed, and data read.

**Key elements to read:**
- **Operator tree** — nodes like `TableScan`, `Join`, `Aggregate`, `Sort`, `Filter`, showing the flow of execution.
- **Percentage of execution time per node** — find the **most expensive operator** (your optimization target).
- **Statistics panel:**
  - **Partitions scanned vs. total** — the pruning indicator (fewer scanned = better).
  - **Bytes spilled to local/remote storage** — memory pressure (query too large for memory).
  - **Rows** flowing between operators — spot **row explosion** (output rows >> input rows).

### Common problems visible in the profile
| Symptom in profile | Likely cause |
|--------------------|--------------|
| Most partitions scanned | **Poor pruning** (no selective filter / unclustered data) |
| Bytes spilled to remote storage | **Query too large to fit in memory** (needs bigger warehouse or less data) |
| Join outputs far more rows than inputs | **Row explosion** (bad/missing join key → many-to-many) |
| High time in `Sort`/`Aggregate` | Expensive operations on large data |
| `TableScan` dominates | Reading too much data; improve filters |

---

## 2. Query Insights

**What it is:** Snowsight surfaces **automatic insights** on a query, flagging **recognized inefficiency patterns** with plain-language explanations.

**Patterns Query Insights can flag:**
- **Queries too large to fit in memory** — spilling; consider a larger warehouse or reducing data scanned.
- **Inefficient pruning** — a filter exists but doesn't reduce partitions scanned (e.g., filtering on an unclustered column, or a function wrapping the column defeats pruning).
- **Row explosion** — joins producing far more rows than expected (missing/ambiguous join keys).
- **Queries that spent time queued** — the warehouse was busy; consider multi-cluster or reducing concurrency.
- **Unselective filters / no pruning** — full scans.

**Best practice:** Insights point you to the *category* of problem; the **profile** shows the *exact* operator to fix.

### Supporting concepts
- **Query pruning** — Snowflake skips micro-partitions whose min/max metadata can't match the filter. Good pruning = few partitions scanned.
- **Inefficient pruning** — the query *could* prune but doesn't (e.g., `WHERE TO_DATE(ts) = ...` prevents pruning on `ts`).
- **Reducing queues** — spread load, use multi-cluster warehouses, or right-size to cut queued time.
- **`EXPLAIN`** — shows the **planned** operator tree and estimated partitions **without executing** the query — cheap way to sanity-check pruning before running.

---

## 3. Query History

**What it is:** A record of executed queries with rich metadata — duration, status, bytes scanned, warehouse, user, and more.

### Where to find it
| Source | Scope | Latency | Retention |
|--------|-------|---------|-----------|
| **Snowsight → Query History** | Interactive UI | near real-time | ~14 days in UI |
| **`INFORMATION_SCHEMA.QUERY_HISTORY*`** table functions | Session/account, real-time | real-time | ~7 days |
| **`ACCOUNT_USAGE.QUERY_HISTORY`** view | Account-wide | ~45 min latency | **1 year** |

### Key views/functions
- **`ACCOUNT_USAGE.QUERY_HISTORY`** — historical query metadata (execution_time, bytes_scanned, partitions_scanned/total, queued time, spilling).
- **`ACCOUNT_USAGE.QUERY_ATTRIBUTION_HISTORY`** — attributes **credit cost to individual queries** (which queries cost the most compute).
- **`INFORMATION_SCHEMA.QUERY_HISTORY`, `QUERY_HISTORY_BY_USER/WAREHOUSE/SESSION`** — real-time, shorter retention, filtered variants.

**Key columns for performance:**
- `total_elapsed_time`, `execution_time`, `compilation_time`, `queued_provisioning_time`, `queued_overload_time`
- `bytes_scanned`, `partitions_scanned` / `partitions_total`
- `bytes_spilled_to_local_storage`, `bytes_spilled_to_remote_storage`

---

## 4. Warehouse Workload

**What it is:** Views showing how busy a **warehouse** is — useful when the problem is **concurrency/queuing**, not a single query.

### Key views
- **`ACCOUNT_USAGE.WAREHOUSE_LOAD_HISTORY`** — average running vs. **queued** query load over time. High `avg_queued_load` = warehouse is a bottleneck.
- **`ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY`** — credits consumed per warehouse (ties performance to cost).

### Virtual warehouse best practices
- **Right-size** for the workload; bigger warehouses process more data in parallel and reduce spilling.
- **Multi-cluster warehouses** to handle **concurrency** (queuing), scaling out clusters as demand rises.
- Separate warehouses by **workload type** (ETL vs. BI vs. ad-hoc) to avoid contention.
- Use **AUTO_SUSPEND/AUTO_RESUME** to control cost without hurting responsiveness.
- Leverage **result cache** — identical queries return instantly at no compute cost.

---

## Diagnostic Flow (putting it together)

```
1. Query slow?  → open QUERY PROFILE
2. Read INSIGHTS banner → identifies the problem category
3. In profile, find the operator with highest % time
4. Check statistics:
     - partitions scanned ≈ total?   → pruning problem
     - bytes spilled to remote?       → too big for memory (size up)
     - rows exploding at a join?       → row explosion (fix join key)
     - large queued_overload_time?     → warehouse concurrency (multi-cluster)
5. Confirm plan with EXPLAIN; check WAREHOUSE_LOAD_HISTORY if queuing
```

---

## Quick Reference Summary

| Topic | Tool/view | Tells you |
|-------|-----------|-----------|
| **Query Profile** | Snowsight profile | Per-operator time, partitions, spilling, rows |
| **Query Insights** | Snowsight insights | Named problem (memory, pruning, row explosion, queuing) |
| **EXPLAIN** | `EXPLAIN <query>` | Planned tree without running |
| **Query History (real-time)** | `INFORMATION_SCHEMA.QUERY_HISTORY*` | Recent queries (~7 days) |
| **Query History (historical)** | `ACCOUNT_USAGE.QUERY_HISTORY` | 1 year, ~45 min latency |
| **Cost per query** | `QUERY_ATTRIBUTION_HISTORY` | Credits attributed per query |
| **Warehouse load** | `WAREHOUSE_LOAD_HISTORY` | Running vs. queued load |
| **Warehouse cost** | `WAREHOUSE_METERING_HISTORY` | Credits per warehouse |

---

## Reference Links (from Snowflake docs)

- Review Query Profile
- Using query insights to improve performance / Queries Too Large to Fit in Memory / Query pruning / Inefficient pruning / How to recognize row explosion / Reducing queues / Using EXPLAIN
- Monitor query activity with Query History
- ACCOUNT_USAGE: QUERY_HISTORY / QUERY_ATTRIBUTION_HISTORY
- INFORMATION_SCHEMA: QUERY_HISTORY, QUERY_HISTORY_BY_*
- ACCOUNT_USAGE: WAREHOUSE_LOAD_HISTORY / WAREHOUSE_METERING_HISTORY / Exploring execution times / Virtual warehouse best practices
