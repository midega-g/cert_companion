# Domain 2: Performance Optimization, query troubleshooting (SnowPro Advanced: Data Engineer, DEA-C02)

Weight: **19%**. Domain 2 notes are split by section: this file, 2.1: troubleshoot underperforming queries. Section 2.2 (configure for optimal performance) and 2.3 (monitor continuous data pipelines) are added only after they are approved. Several 2.3 topics (task history, dynamic table refresh history, `COPY_HISTORY`, pipe status) are already in the Domain 1 notes, linked from 2.1.8.

## Contents

| Section | Topic | Status |
|---------|-------|--------|
| 2.1 | [Troubleshoot underperforming queries](#21-troubleshoot-underperforming-queries) | Draft |

---

## 2.1 Troubleshoot underperforming queries

The study guide lists four skills: identify underperforming queries, outline the telemetry around the operation, identify the root cause, and increase efficiency.

**Sections in 2.1**

- [2.1.1 The troubleshooting loop](#211-the-troubleshooting-loop)
- [2.1.2 Identify queries: where to look](#212-identify-queries-where-to-look)
- [2.1.3 Query hash](#213-query-hash)
- [2.1.4 Telemetry columns in QUERY_HISTORY](#214-telemetry-columns-in-query_history)
- [2.1.5 Query Profile](#215-query-profile)
- [2.1.6 Common root causes and fixes](#216-common-root-causes-and-fixes)
- [2.1.7 Query Insights](#217-query-insights)
- [2.1.8 Warehouse-level fixes](#218-warehouse-level-fixes)
- [2.1.9 Quick reference: which tool answers which question](#219-quick-reference-which-tool-answers-which-question)
- [2.1 open items and flags](#21-open-items-and-flags)

### 2.1.1 The troubleshooting loop

| Step | Question | Tools |
|------|----------|-------|
| Identify | Which queries are slow, or slow in total? | Query History in Snowsight, `ACCOUNT_USAGE.QUERY_HISTORY`, the `QUERY_HISTORY` table functions, query hash |
| Telemetry | Where did the time go? | Time columns in `QUERY_HISTORY`, Query Profile, `GET_QUERY_OPERATOR_STATS`, `WAREHOUSE_LOAD_HISTORY` |
| Root cause | Why? | Query Profile patterns (exploding join, spilling, poor pruning, `UNION`), Query Insights, queue time |
| Increase efficiency | What changes the result? | Rewrite the SQL, change data layout (clustering), resize or add warehouses, query acceleration, caching |

Test a change by re-running the query and comparing its execution time.

[Back to contents](#contents)

### 2.1.2 Identify queries: where to look

| Source | History | Latency | Who can use it |
|--------|---------|---------|----------------|
| Snowsight **Query History** (Monitoring » Query History) | Last **14 days** | Near real time (optional Auto Refresh every 10 s) | Your own queries always. Others by role (below) |
| Snowsight **Grouped Queries** | Last **14 days** | Up to **180 minutes** | ACCOUNTADMIN, `IMPORTED PRIVILEGES` on SNOWFLAKE, or the `GOVERNANCE_VIEWER` database role |
| `SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY` view | **365 days** | Up to **45 minutes** | ACCOUNTADMIN by default. Other roles need access to the shared SNOWFLAKE database |
| `INFORMATION_SCHEMA.QUERY_HISTORY` and `_BY_SESSION`, `_BY_USER`, `_BY_WAREHOUSE` table functions | Last **7 days** | Updated faster than ACCOUNT_USAGE | Your own queries. Others if your role has MONITOR or OPERATE on the warehouse |

Key facts:
- Snowsight filters: status (failed, queued, long-running), user, time period (up to 14 days), SQL text, query ID, warehouse, statement type, duration, session ID, **query tag**, parameterized query hash, client-generated statements, queries executed by user tasks, and replication refresh history.
- A role with MONITOR or OPERATE on a warehouse sees other users' queries on that warehouse. ACCOUNTADMIN sees all. `GOVERNANCE_VIEWER` alone does not show **Individual Queries** by other users in Snowsight. It needs ACCOUNTADMIN, `IMPORTED PRIVILEGES`, or MONITOR on users or warehouses.
- User details for queries older than seven days are missing in Query History, because sessions are kept for that long.
- Syntax and parsing errors show `<redacted>` for the SQL text unless `ENABLE_UNREDACTED_QUERY_SYNTAX_ERROR` is set and your role allows it.
- Table function arguments: `END_TIME_RANGE_START`, `END_TIME_RANGE_END` (inside the last 7 days, otherwise an error), `RESULT_LIMIT` (**1 to 10000, default 100**), and `INCLUDE_CLIENT_GENERATED_STATEMENT` (default `FALSE`). The time range and `RESULT_LIMIT` are applied **before** your `WHERE` clause. To filter over a larger set, raise `RESULT_LIMIT`.
- Use the table function (or Snowsight) right after running a query, because ACCOUNT_USAGE lags.
- **Hybrid tables:** short queries that only touch hybrid tables are not recorded in `QUERY_HISTORY`. Use `AGGREGATE_QUERY_HISTORY` and the Grouped Queries view for those workloads, and don't benchmark latency percentiles from `QUERY_HISTORY`.
- Native App queries are redacted in Query History and in the profile.

```sql
-- Longest-running queries on a warehouse in the last day
SELECT query_id, query_text, total_elapsed_time/1000 AS seconds,
       partitions_scanned, partitions_total
FROM snowflake.account_usage.query_history
WHERE warehouse_name = 'MY_WAREHOUSE'
  AND start_time > DATEADD(day, -1, CURRENT_TIMESTAMP())
  AND total_elapsed_time > 0
  AND error_code IS NULL
  AND partitions_scanned IS NOT NULL
ORDER BY total_elapsed_time DESC
LIMIT 50;

-- Same dimension without ACCOUNT_USAGE access, last 7 days only
SELECT query_id, total_elapsed_time
FROM TABLE(INFORMATION_SCHEMA.QUERY_HISTORY_BY_WAREHOUSE(
  WAREHOUSE_NAME => 'MY_WAREHOUSE', RESULT_LIMIT => 1000))
ORDER BY total_elapsed_time DESC;
```

[Back to contents](#contents)

### 2.1.3 Query hash

The hash lets you group repeated statements, which a per-query view hides: a query that is cheap on each run can be expensive in total.

| Column | Same value when | Notes |
|--------|-----------------|-------|
| `query_hash` | The canonicalized text is identical. Case of identifiers, white space and comments are ignored | Different literals give different hashes |
| `query_parameterized_hash` | Only **literals** differ, in a predicate using `=`, `!=`, `>=` or `<=` | Same `query_hash` implies same `query_parameterized_hash`, not the reverse |

- Available in `ACCOUNT_USAGE` views (`QUERY_HISTORY`, `QUERY_ACCELERATION_ELIGIBLE`, `TASK_HISTORY`, **1 year**) and in the `QUERY_HISTORY` and `TASK_HISTORY` table functions (**7 days**).
- The hashing logic can change over time. `query_hash_version` and `query_parameterized_hash_version` tell you which version produced a value. Filter on both when comparing across periods.
- Use `query_hash` to find the queries worth optimizing first, and `query_parameterized_hash` to track one query shape over time (for example after changing a clustering key). Snowsight's Grouped Queries view is built on the parameterized hash.

```sql
SELECT query_hash, COUNT(*), SUM(total_elapsed_time), ANY_VALUE(query_id)
FROM snowflake.account_usage.query_history
WHERE warehouse_name = 'MY_WAREHOUSE'
  AND DATE_TRUNC('day', start_time) >= CURRENT_DATE() - 7
GROUP BY query_hash
ORDER BY SUM(total_elapsed_time) DESC
LIMIT 100;
```

#### What a query hash is

A query hash is a fingerprint of the **query text**. Snowflake first normalizes (canonicalizes) the SQL text, then computes a fixed-length hash value from it (for example a 32-character hex string). Queries with the same normalized text get the same hash, no matter how many times, when or by whom they ran. It is a different thing from the other identifiers in `QUERY_HISTORY`:

| Identifier | Identifies | Same value across two runs of the same SQL? |
|------------|------------|---------------------------------------------|
| `query_id` | One single execution | No. Every run gets a new ID |
| `query_hash` | The normalized text of the statement | Yes |
| `query_parameterized_hash` | The text after literals in certain predicates are replaced by parameters | Yes, even when the literal values differ |

The hash is based on text only. It does not look at the data, the execution plan or the result. Two statements that return the same rows but are written differently get different hashes.

**What the normalization ignores, for both hashes:** the case of identifiers, session variables and stage names; white space; and comments. Bind variables used with `IDENTIFIER()` are an exception: different bind values produce different hashes.

**What the parameterized hash additionally ignores:** literal values in a predicate that uses `=`, `!=`, `>=` or `<=`. A literal used any other way (for example in a `LIKE` pattern, `IN` list or `BETWEEN`, which are not in the documented list) is not parameterized.

Worked comparison. Take `table1` with a `name` column:

| # | SQL | `query_hash` vs #1 | `query_parameterized_hash` vs #1 |
|---|-----|--------------------|----------------------------------|
| 1 | `SELECT * FROM table1 WHERE table1.name = 'TIM'` | (reference) | (reference) |
| 2 | `SELECT * FROM TABLE1 WHERE TABLE1.NAME = 'TIM'  -- nightly job` | Same (identifier case and comment ignored) | Same |
| 3 | `SELECT * FROM table1 WHERE table1.name = 'AIHUA'` | **Different** (literal differs) | **Same** (literal in an `=` predicate) |
| 4 | `SELECT name FROM table1 WHERE table1.name = 'TIM'` | Different (different text) | Different |

Rules that follow from this:
- Same `query_hash` means same `query_parameterized_hash`. The reverse is false (row 3).
- `query_hash` finds **exact repeats**: the same dashboard query or the same task statement run many times. Use it to rank "which statement costs the most in total".
- `query_parameterized_hash` finds **the same query shape with different inputs**, typical of an application that builds `WHERE customer_id = <value>` for each request. Use it to track one shape over time, for example before and after changing a clustering key. A dashboard filtered by a different customer on each load would show many `query_hash` values but one parameterized hash.
- The hash is only comparable within the same hashing logic version (see the version columns above).

Source: Snowflake page "Using the Query Hash to Identify Patterns and Trends in Queries".

[Back to contents](#contents)

### 2.1.4 Telemetry columns in QUERY_HISTORY

All times are in milliseconds.

| Column | Meaning | Points to |
|--------|---------|-----------|
| `total_elapsed_time` | End-to-end time | Start here |
| `compilation_time` | Time compiling the query | Large for very complex SQL |
| `execution_time` | Time executing on the warehouse | Look in the profile |
| `queued_provisioning_time` | Waiting for compute to provision after warehouse creation, resume or resize | Cold start, not load |
| `queued_repair_time` | Waiting for compute to be repaired | Platform side |
| `queued_overload_time` | Waiting because the warehouse was overloaded by the current workload | **Queuing**: add clusters or warehouses, or resize |
| `transaction_blocked_time` | Blocked by a concurrent DML | Lock contention, not warehouse size |
| `partitions_scanned` vs `partitions_total` | Pruning efficiency | Poor pruning, clustering |
| `bytes_spilled_to_local_storage`, `bytes_spilled_to_remote_storage` | Memory pressure | **Spilling** |
| `percentage_scanned_from_cache` | Share read from the warehouse cache | Cold or reused cache |
| `query_retry_time`, `query_retry_cause` | Time lost to retries for actionable causes (for example out of memory) | Change warehouse settings |
| `query_load_percent` | Approximate share of the warehouse's active compute this query used | |
| `query_tag` | Value of the `QUERY_TAG` session parameter | Attribute queries to a job or pipeline |

```sql
-- Worst spillers in the last 45 days
SELECT query_id, SUBSTR(query_text, 1, 50) AS partial_query_text, user_name, warehouse_name,
       bytes_spilled_to_local_storage, bytes_spilled_to_remote_storage
FROM snowflake.account_usage.query_history
WHERE (bytes_spilled_to_local_storage > 0 OR bytes_spilled_to_remote_storage > 0)
  AND start_time::date > DATEADD('days', -45, CURRENT_DATE)
ORDER BY bytes_spilled_to_remote_storage, bytes_spilled_to_local_storage DESC
LIMIT 10;
```

#### Partitions scanned and partitions total

Snowflake stores table data in **micro-partitions**: contiguous storage units holding 50 MB to 500 MB of uncompressed data. For each micro-partition Snowflake keeps metadata, including the **range of values (minimum and maximum) for each column**. At run time the optimizer compares your filter against that metadata and skips micro-partitions that cannot contain matching rows. Skipping them is called **pruning**.

| Statistic | Meaning |
|-----------|---------|
| `partitions_total` (Query Profile: *Partitions total*) | Micro-partitions making up the scanned table |
| `partitions_scanned` (Query Profile: *Partitions scanned*) | Micro-partitions actually read after pruning |

Read them as a ratio, and compare it with how selective the filter is:
- A filter that selects about 10% of the values in a range should ideally scan about 10% of the micro-partitions. The closer the scanned share is to the share of data actually needed, the better the pruning.
- **Good:** 200 of 10,000 scanned (2%) for a filter that keeps about 2% of the rows.
- **Poor:** 9,800 of 10,000 scanned, and a **Filter** operator above the **TableScan** then discards most of the rows. The engine read nearly everything and threw most of it away. The usual cause is that the storage order of the table is not correlated with the filter column, so each micro-partition's min/max range is wide and overlaps with the filter value. Fix by changing the data organization (clustering key, Domain 3, 3.2) or by making the filter selective.
- **Scanned close to total is normal when there is no filter** or the filter keeps most of the data. Pruning can only help a query that filters out a significant amount of data.
- In `QUERY_HISTORY` the two columns are per query. The Query Profile shows them for each **TableScan**, so a query with several scans gets one pair per scan.
- Queries that do not read a table (for example metadata-only results or result reuse) have no scan statistics, which is why the sample query on the Snowflake page filters on `partitions_scanned IS NOT NULL`.

Source: "Micro-partitions and data clustering" and the Query Profile page, "Inefficient pruning".

#### Spilling: local and remote

Each warehouse server has memory, local disk and access to cloud storage. Operators such as large joins, aggregations and sorts keep intermediate results in memory. When an operation needs more memory than the warehouse has, the engine **spills** the overflow:

| Level | Where the data goes | Profile and column | Cost |
|-------|---------------------|--------------------|------|
| Memory | Warehouse server memory | (no spill) | Fastest |
| **Local spilling** | Local disk of the warehouse servers | *Bytes spilled to local storage*, `bytes_spilled_to_local_storage` | Performance degrades drastically versus memory |
| **Remote spilling** | Remote cloud-provider storage, used when local disk is also insufficient | *Bytes spilled to remote storage*, `bytes_spilled_to_remote_storage` | Worse than local |

Notes:
- The order is fixed: memory, then local disk, then remote storage. Remote spill is a sign that local disk was also exhausted, so remote spilling is the one to fix first. Query Insights raises a warehouse insight specifically for **remote** spilling.
- Snowflake's example of a spilling operation is duplicate elimination on a huge data set. Any operator that must hold large intermediate results is a candidate.
- To find **which operator** spilled, open the Query Profile and check the Statistics pane for the whole query, then look at the nodes that dominate the time (Most Expensive Nodes). Spilling shows up as time in the **Local Disk IO** and **Remote Disk IO** categories of the Profile Overview.
- Fixes: use a **larger warehouse** (more memory and local disk for the operation) and/or **process the data in smaller batches**.
- With the query acceleration service enabled, a small nonzero remote spill is normal and not a problem (see 2.1.8).
- Diagnostic queries on `ACCOUNT_USAGE` need access to the shared SNOWFLAKE database. By default only ACCOUNTADMIN has it.

Source: "Resolving memory spillage".

[Back to contents](#contents)

### 2.1.5 Query Profile

Open it from Query History: select the query, then the **Query Profile** tab.

- **Availability.** The query must have finished. No profile or details if it is still running, your role lacks privileges, it ran more than **14 days** ago, it failed to run, or (best effort) detail was not retained. Native App queries collapse to one empty node.
- **Execution plan.** Operator nodes show the operator type, ID, the percentage of query time and a preview of the details. Arrows show rowsets flowing between operators. Steps appear only if the query ran in steps.
- **Information panes:** Profile Overview, Query Insights, Statistics, Most Expensive Nodes, Attributes.

| Pane | What it tells you |
|------|-------------------|
| Profile Overview | Where time went: **Processing** (CPU), **Local Disk IO**, **Remote Disk IO**, **Network Communication**, **Synchronization**, **Initialization**, Hybrid Table Requests Throttling |
| Statistics: IO | Bytes scanned, percentage scanned from cache, bytes written, external bytes scanned |
| Statistics: Pruning | **Partitions scanned** and **Partitions total** |
| Statistics: Spilling | Bytes spilled to local storage, bytes spilled to remote storage |
| Most Expensive Nodes | Every node using 1% or more of the time, sorted descending |
| Attributes | Operator-specific details (join type and condition, grouping keys, sort keys, filter condition, access predicates) |

Operator types worth recognizing:

| Group | Operators |
|-------|-----------|
| Data access | TableScan, IndexScan (hybrid tables), ExternalScan (stage), InternalObject, ValuesClause, Generator |
| Processing | Filter, Join, JoinFilter, Aggregate, GroupingSets, WindowFunction, Sort, SortWithLimit, Flatten, UnionAll, ExternalFunction |
| DML | Insert, Delete, Update, Merge, Unload |
| Metadata | DDL and transaction commands, Table Creation Command, **Query Result Reuse**, **Metadata-based Result** (for example `SELECT COUNT(*)`, not run on a warehouse) |

#### What a node is

The Query Profile draws the execution plan as a graph of **operator nodes**. One node is one operator (a scan, a join, a sort and so on) that receives rows from the nodes below it and passes rows up. The arrows between nodes are the **rowsets** that flow from one operator to the next. A node is **not** a compute server in the warehouse.

Each node shows:
- the **operator type** (TableScan, Join and so on);
- an **operator ID**, which identifies the node within the query and is what `GET_QUERY_OPERATOR_STATS` returns as `operator_id`;
- the **percentage of the total query time** spent in it (or of the step's time, when the query ran in several steps);
- a short preview of its details (a table name, a join condition).

Selecting a node fills the **Attributes** pane (operator-specific details) and the Statistics for that node. A node's time is split into the same categories as the overview: Processing, Local Disk IO, Remote Disk IO, Network Communication, Synchronization and Initialization. The **Most Expensive Nodes** pane lists the nodes that took **1% or more** of the time, largest first, so start there.

#### Data access and generation operators

These operators are the leaves of the plan: they bring rows into the query.

| Operator | What it is | Typical source in SQL | Attributes shown | What to check |
|----------|------------|-----------------------|------------------|---------------|
| **TableScan** | Reads a single table | `FROM table` | Full table name, table alias, columns scanned, extracted VARIANT paths, access predicates (hybrid tables also show scan mode `ROW_BASED` or `COLUMN_BASED`) | *Partitions scanned* vs *total*, and which columns are read. Access predicates are the conditions pushed into the scan |
| **IndexScan** | Reads a **secondary index** on a hybrid table | A selective predicate on an indexed column of a hybrid table | Full table name, columns, scan mode, access predicates, full index name | Hybrid tables only |
| **ValuesClause** | Produces a list of literal rows | `VALUES (1, 'a'), (2, 'b')` | Number of values, the values | Usually trivial |
| **Generator** | Produces rows with no input table | `TABLE(GENERATOR(ROWCOUNT => n))` or `TIMELIMIT` | `rowCount`, `timeLimit` | Row counts used in tests and calendar tables |
| **ExternalScan** | Reads data held in a **stage** | Querying a stage directly, and the read side of `COPY INTO` | Stage name, stage type (for example table stage) | Appears in load queries. Staged files have no micro-partition pruning statistics |
| **InternalObject** | Reads an internal data object | Information Schema tables, or the result of a previous query | Object name or type | Not a user table |

#### Data processing operators

These sit in the middle and top of the plan and transform rows.

| Operator | What it does | Typical source in SQL | Attributes shown | What to check |
|----------|--------------|-----------------------|------------------|---------------|
| **Filter** | Keeps rows that satisfy a condition | `WHERE`, `HAVING`, `QUALIFY` | Filter condition | A Filter sitting directly above a TableScan that drops most rows means pruning did not remove them first |
| **Join** | Combines two inputs on a condition | `JOIN ... ON`, comma joins | Join type (INNER, LEFT OUTER and so on), **equality join condition**, **additional join condition** | Output rows far above input rows is an exploding join. Non-equality predicates appear under *Additional Join Condition* and can be much slower |
| **JoinFilter** | Removes rows early that cannot match a join further up the plan | Added by the optimizer, not written in SQL | Original join ID (the join it serves) | It reduces the data fed to a join. It is an optimization, not a problem |
| **Aggregate** | Groups rows and computes aggregate functions | `GROUP BY`, aggregate functions, `SELECT DISTINCT`, and the duplicate removal of `UNION` | Grouping keys, aggregate functions | An Aggregate above a UnionAll means `UNION` instead of `UNION ALL` |
| **GroupingSets** | Aggregation over several grouping combinations | `GROUPING SETS`, `ROLLUP`, `CUBE` | Grouping key sets, aggregate functions | Multiplies the groups that must be held |
| **WindowFunction** | Computes window functions | `... OVER (PARTITION BY ... ORDER BY ...)` | Window functions computed | Often paired with a Sort |
| **Sort** | Orders the input | `ORDER BY` without a limit | Sort keys | Sorting a large set is a spill candidate |
| **SortWithLimit** | Orders and returns only part of the sorted input | `ORDER BY ... LIMIT ... OFFSET ...` | Sort keys, number of rows, offset | Cheaper than a full Sort because only the requested part is kept |
| **Flatten** | Expands VARIANT data along a path | `LATERAL FLATTEN(...)` | The input expression | Can multiply row counts when arrays are large |
| **UnionAll** | Concatenates two inputs | `UNION ALL`, and the first half of `UNION` | None | |
| **ExternalFunction** | Calls an external function | A call to an external function | | Network time, see the External Functions statistics |

Two pairs are easy to confuse:
- **Filter vs JoinFilter.** Filter implements a condition you wrote. JoinFilter is added by the optimizer to discard rows that the join will reject anyway.
- **Aggregate vs GroupingSets.** Aggregate covers plain `GROUP BY` and `DISTINCT`. GroupingSets covers `GROUPING SETS`, `ROLLUP` and `CUBE`.

DML operators (**Insert**, **Delete**, **Update**, **Merge**, **Unload**) and metadata operators appear in the same profile for statements that write data. See the table above.

Source: "Monitor query activity with Query History", section "Attributes".

**Programmatic access:** `GET_QUERY_OPERATOR_STATS(<query_id>)` returns the same operator statistics for a completed query from the **past 14 days**. Combine it with `LAST_QUERY_ID()`.

```sql
SET lid = LAST_QUERY_ID();

-- Rows out / rows in for each join. A large multiple suggests an exploding join.
SELECT operator_id, operator_attributes,
       operator_statistics:output_rows / operator_statistics:input_rows AS row_multiple
FROM TABLE(GET_QUERY_OPERATOR_STATS($lid))
WHERE operator_type = 'Join'
ORDER BY step_id, operator_id;
```

[Back to contents](#contents)

### 2.1.6 Common root causes and fixes

| Symptom in the profile or history | Cause | Fix |
|-----------------------------------|-------|-----|
| A **Join** produces far more rows than it consumes (often orders of magnitude), and uses a lot of time | **Exploding join**: no join condition (Cartesian product), or a condition where rows match many rows on the other side | Add or correct the join condition. A `WHERE` clause in a subquery can reduce rows |
| **UnionAll** operator with an extra **Aggregate** on top | `UNION` used where `UNION ALL` is enough (duplicate elimination) | Use `UNION ALL` |
| Join has an *Additional Join Condition* (non-equality predicate) | Non-equality join predicates are much slower | Avoid or simplify them |
| Bytes spilled to local, then remote storage | Intermediate results exceed warehouse memory (for example duplicate elimination on a huge set). Remote spilling is worse | **Larger warehouse** (more memory and local disk), and/or **process data in smaller batches** |
| *Partitions scanned* is close to *Partitions total*, with a **Filter** above the **TableScan** removing many rows | **Inefficient pruning**: the storage order is not correlated with the filter columns | Different data organization, such as a clustering key (see Domain 3, 3.2) |
| `queued_overload_time` is high, or the Warehouse Activity chart shows **Queued load** | Too many concurrent queries for the warehouse | Reduce queues (2.1.8) |
| `transaction_blocked_time` is high | Concurrent DML on the same data | Look at the competing transactions, not only the warehouse |
| Full scan with `LIKE '%text'` | Leading wildcard defeats pruning | Remove the leading wildcard, or enable search optimization |

Pruning is only useful if the query actually filters out a significant amount of data.

#### Wildcards: `%word`, `%word%`, `word%`, and LIKE vs ILIKE

In a `LIKE` pattern, `%` matches **any sequence of zero or more characters** and `_` matches **exactly one character**. A pattern must match the **entire** string. To find a word anywhere inside a string you must put `%` on both sides.

| Pattern | Meaning | Matches | Does not match | Leading wildcard? |
|---------|---------|---------|----------------|-------------------|
| `word` (no wildcard) | The whole value equals `word` | `word` | `words`, `sword` | No |
| `word%` | **Starts with** `word` | `word`, `words`, `wordpress` | `sword` | No |
| `%word` | **Ends with** `word` | `word`, `sword` | `words` | **Yes** |
| `%word%` | **Contains** `word` | `word`, `words`, `sword`, `swords` | `wor` | **Yes** |
| `w_rd` | `w`, any one character, `rd` | `word`, `ward` | `wrd`, `woord` | No |

Why the difference matters for performance:
- The Query Insights topic `QUERY_INSIGHT_LIKE_WITH_LEADING_WILDCARD` fires when the filter **starts with a wildcard** (`%word` and `%word%`). Snowflake says such a pattern can result in scanning a large amount of data.
- Remedy: specify a pattern that does **not** start with a wildcard, if possible. If you need a leading wildcard, consider enabling **search optimization**, which supports `LIKE` and `ILIKE`.
- `word%` has no leading wildcard, so it is not flagged by this insight.
- Why (my explanation, not quoted from Snowflake): pruning compares the filter with each micro-partition's minimum and maximum values. A prefix such as `word%` limits the match to values that start in one alphabetical range, so partitions whose range lies outside it can be skipped. A leading `%` allows a match anywhere in the string, so the range says nothing and every partition has to be read.

**LIKE vs ILIKE**

| | `LIKE` | `ILIKE` |
|---|--------|---------|
| Case | **Case-sensitive** | **Case-insensitive** |
| Syntax | `<subject> [NOT] LIKE <pattern> [ESCAPE <escape>]` or `LIKE(subject, pattern [, escape])` | Same, with `ILIKE` |
| Wildcards | `%` and `_` | `%` and `_` |
| Search optimization | Can be improved | Can be improved |
| `NULL` | Returns `NULL` if the subject or the pattern is `NULL`. `NULL` does not match `NULL` | Same |

| Expression | `LIKE` | `ILIKE` |
|------------|--------|---------|
| `'Snowflake' LIKE 'snow%'` | FALSE | TRUE |
| `'Snowflake' LIKE 'Snow%'` | TRUE | TRUE |
| `'Snowflake' LIKE '%FLAKE'` | FALSE | TRUE |

- `RLIKE` is the third relative. It uses POSIX extended regular expressions instead of the SQL pattern syntax. `LIKE ANY` and `LIKE ALL` match one pattern list.
- There is no default escape character. To match a literal `%` or `_`, name an escape character with `ESCAPE`, for example `'SOMETHING%' LIKE '%\\%%' ESCAPE '\\'`.
- The `LIKE` and `ILIKE` reference pages do not state a speed difference between them. Don't assume one.
- Collation: only the `upper`, `lower` and `trim` specifications (and combinations of those) are supported.

Sources: "[ NOT ] LIKE", "[ NOT ] ILIKE", and Query Insights, "LIKE filter with leading wildcard".

[Back to contents](#contents)

### 2.1.7 Query Insights

Insights are messages in the profile's **Query Insights** pane, with a suggested next step. The same data is in `SNOWFLAKE.ACCOUNT_USAGE.QUERY_INSIGHTS` (topic in `INSIGHT_TOPIC`). Nodes with an insight are highlighted.

| Topic | Insight | Suggested action |
|-------|---------|------------------|
| `TABLE_SCAN` | No filter on table scan | Add a `WHERE` clause |
| `TABLE_SCAN` | Filter not applicable (removes no rows) or not selective | Make the condition more selective |
| `TABLE_SCAN` | `LIKE` with leading wildcard | Avoid it, or enable search optimization |
| `TABLE_SCAN` | Filter uses clustering key, benefited from search optimization, benefited from Snowflake Optima | Informational: the feature helped |
| `TABLE_SCAN` or `JOIN` | Query benefited from Optima Planning (learned plan applied) | Informational |
| `JOIN` | Could benefit from Optima Planning (ran on a warehouse type that doesn't support it) | Run on a Snowflake generation 2 standard warehouse or an Adaptive Warehouse |
| `JOIN` | Join with no join condition (cross join) | Add join conditions |
| `JOIN` | Join with inefficient join condition (complex condition evaluated after the join) | Simplify the condition |
| `JOIN` | Exploding join, nested or not | Fix the join conditions, filter the subquery |
| `AGGREGATION` | Unnecessary `DISTINCT` or `GROUP BY` (same row count without it) | Remove it |
| `UNION` | Unnecessary `UNION [DISTINCT]` (inputs are disjoint) | Use `UNION ALL` |
| `WAREHOUSE` | Remote spilling | Larger warehouse, or smaller batches |
| `WAREHOUSE` | Queued too long (`QUERY_INSIGHT_QUEUED_OVERLOAD`) | Larger warehouse, or a warehouse with fewer concurrent queries |

**No insights are produced** for: queries whose plan takes multiple steps, queries involving secure objects, hybrid table queries, Native App queries, `EXPLAIN` queries, queries that reuse results, and queries on interactive tables. The "filter not selective" insight is not produced for queries accelerated by the query acceleration service. Insights apply only to SQL queries against databases processed by warehouses.

[Back to contents](#contents)

### 2.1.8 Warehouse-level fixes

Snowflake lists six warehouse strategies. Test each by re-running the query. Size, query acceleration and caching are covered in 2.2, which is not written yet.

| Strategy | Use when |
|----------|----------|
| Reduce queues | Queries wait before starting |
| Resolve memory spillage | Bytes spilled to local or remote storage |
| Increase warehouse size | The query is large and needs more compute and memory |
| Try query acceleration | Offload eligible portions of a query to serverless compute |
| Optimize the warehouse cache | Repeated reads of the same data |
| Limit concurrently running queries | Too many queries compete for resources |

**Reducing queues**
- Find them: the **Queued load** series in the Snowsight Warehouse Activity chart, or `ACCOUNT_USAGE.WAREHOUSE_LOAD_HISTORY` (`avg_running`, `avg_queued_load`; latency up to **3 hours**), or the queued time columns in `QUERY_HISTORY`.
- A regular warehouse: **create additional warehouses** and move queries (especially the ones causing spikes).
- **Convert to a multi-cluster warehouse** so it adds clusters when demand spikes. Multi-cluster needs **Enterprise Edition or higher**.
- Already multi-cluster: raise the **maximum number of clusters**.
- Cost: a multi-cluster warehouse in Auto-scale mode can use the **Economy** scaling policy, which keeps running clusters fully loaded before starting another. That conserves credits but **can leave queries queued** and slower.

**Spilling and query acceleration:** with the query acceleration service enabled, Snowflake writes a small amount of data to remote storage for each eligible query, even if the service isn't used for it. A nonzero `bytes_spilled_to_remote_storage` is then not a concern.

**Pipeline performance** (tasks, dynamic tables, Snowpipe) uses its own history views. See `TASK_HISTORY` in [d1-streams-and-tasks-concept.md](../domain_1/d1-streams-and-tasks-concept.md), `DYNAMIC_TABLE_REFRESH_HISTORY` in [d1-continuous-pipelines-concept.md](../domain_1/d1-continuous-pipelines-concept.md), and `COPY_HISTORY` and `SYSTEM$PIPE_STATUS` in [d1-troubleshoot-ingestion-concept.md](../domain_1/d1-troubleshoot-ingestion-concept.md). Longest-running tasks come from `ACCOUNT_USAGE.TASK_HISTORY` where `state = 'SUCCEEDED'`, ordered by the difference between `completed_time` and `query_start_time`.

[Back to contents](#contents)

### 2.1.9 Quick reference: which tool answers which question

| Question | Use |
|----------|-----|
| Which queries ran longest this week, across the account? | `ACCOUNT_USAGE.QUERY_HISTORY` ordered by `total_elapsed_time` |
| What did my own query do five minutes ago? | Snowsight Query History, or the `INFORMATION_SCHEMA.QUERY_HISTORY` table function |
| Which query shape costs the most in total? | `GROUP BY query_hash`, or Grouped Queries in Snowsight |
| Did this query shape get slower over the month? | `query_parameterized_hash` by day |
| Are queries waiting for the warehouse? | `queued_overload_time`, `WAREHOUSE_LOAD_HISTORY`, Queued load in the Warehouse Activity chart |
| Which step of one query is slow? | Query Profile, Most Expensive Nodes |
| Is a join exploding? | Output rows vs input rows on the Join node, or `GET_QUERY_OPERATOR_STATS` |
| Is pruning working? | Partitions scanned vs Partitions total |
| Is memory the problem? | Spilling statistics, `bytes_spilled_*` |
| What should I change? | Query Insights, or the `QUERY_INSIGHTS` view |
| Per-query data after 14 days? | Not available in Snowsight or `GET_QUERY_OPERATOR_STATS`. `ACCOUNT_USAGE.QUERY_HISTORY` keeps the row for 365 days |

[Back to contents](#contents)

### 2.1 open items and flags

- **Pages not fetched:** the warehouse size, query acceleration, warehouse cache and max concurrency pages, the storage optimization page, the `AGGREGATE_QUERY_HISTORY` and `QUERY_INSIGHTS` view references, Snowflake Optima, and the community article on spilling. Those belong to 2.2 or are only named here.
- **Guide resources not read:** the "Performance Impact from Local and Remote Disk Spilling", "Visualizing Warehouse Performance" and "Virtual Warehouse Best Practices" blogs.
- **Exploding joins and the old page.** The common problems come from the Query Profile section of the Snowsight activity page. A separate "exploding joins" page does not exist at the URL I tried, so the explanation comes from that section only.
- **Snowsight vs. view retention.** Snowsight Query History covers 14 days, the table functions 7 days and the ACCOUNT_USAGE view 365 days. The Grouped Queries view latency (up to 180 minutes) is from the Snowsight page, not the view reference.
- **`GOVERNANCE_VIEWER` wording.** The page says the role alone allows direct SQL on ACCOUNT_USAGE views and Grouped Queries, but not Individual Queries by others in Snowsight. I did not test it.
- **Not run in Snowflake.** The SQL samples are adapted from Snowflake's examples and were not executed. The `QUERY_HISTORY_BY_WAREHOUSE` sample is mine and follows the documented syntax.
- **Query Profile insight depth.** The thresholds Snowflake uses to raise each insight are not documented on the pages I read.
- **Explanations marked as such.** The reason a leading `%` defeats pruning, and the remark that large joins, aggregations and sorts hold intermediate results, are explanations I added. Snowflake only says a leading wildcard can scan a large amount of data, and gives duplicate elimination as the spilling example.
- **Example hash table.** Rows 2 to 4 of the hash comparison apply the documented rules. I did not compute actual hash values in Snowflake.
- **Operator list.** The attribute lists come from the "most common operator types" list. The "typical source in SQL" and "what to check" columns are my mapping, except for UnionAll plus Aggregate, join row multiples, non-equality predicates and Filter above TableScan, which Snowflake states explicitly.
