# Domain 3: Storage and Data Protection, analyzing micro-partitions and clustering (SnowPro Advanced: Data Engineer, DEA-C02)

Weight: **14%**. Domain 3 notes are split by section: this file covers 3.2, use system functions to analyze micro-partitions. Sections 3.1 (data recovery) and 3.3 (Time Travel and cloning for development environments) are added only after they are approved. Time Travel and Fail-safe appear here only where they affect clustering cost.

Related notes: [2.1 query troubleshooting](../domain_2/d2-query-troubleshooting-concept.md) explains how to see poor pruning in the Query Profile. This note explains how to measure and fix it. Domain 1 covers clustering only in passing: [cloned tables start with Automatic Clustering suspended](../domain_1/d1-data-sharing-concept.md), [`CLUSTER_AT_INGEST_TIME` for Snowpipe Streaming](../domain_1/d1-load-data-concept.md), and [clustering a materialized view](../domain_1/d1-continuous-pipelines-concept.md).

## Contents

| Section | Topic | Status |
|---------|-------|--------|
| 3.2 | [Use system functions to analyze micro-partitions](#32-use-system-functions-to-analyze-micro-partitions) | Draft |

---

## 3.2 Use system functions to analyze micro-partitions

The study guide lists two skills: **clustering depth** and **cluster keys**. The guide's list of resources for Domain 3 also names `SYSTEM$CLUSTERING_DEPTH` and `SYSTEM$CLUSTERING_INFORMATION`. The bullet "Automatic Clustering features and optimizations" sits next to 3.1 and 3.2 in the guide's two-column layout, so it is not clear which section owns it. It is covered here in 3.2.5 and 3.2.6.

**Sections in 3.2**

- [3.2.1 Micro-partitions and pruning](#321-micro-partitions-and-pruning)
- [3.2.2 Clustering depth and overlap](#322-clustering-depth-and-overlap)
- [3.2.3 The system functions](#323-the-system-functions)
- [3.2.4 Clustering keys](#324-clustering-keys)
- [3.2.5 Automatic Clustering](#325-automatic-clustering)
- [3.2.6 Cost of clustering](#326-cost-of-clustering)
- [3.2.7 Decision flow: should this table be clustered?](#327-decision-flow-should-this-table-be-clustered)
- [3.2 open items and flags](#32-open-items-and-flags)

### 3.2.1 Micro-partitions and pruning

| Fact | Detail |
|------|--------|
| What a micro-partition is | A contiguous unit of storage. Every Snowflake table is divided into micro-partitions automatically |
| Size | 50 MB to 500 MB of uncompressed data. The stored size is smaller because data is compressed |
| Layout | Columnar. Each column is stored and compressed separately inside the micro-partition |
| Metadata kept per micro-partition | The range of values (min and max) for each column, the number of distinct values, and other properties used for optimization |
| How partitions are formed | From the order in which data is inserted or loaded. Nobody defines partitions up front |
| Overlap | Micro-partitions can overlap in their range of values |
| Hybrid tables | Clustering keys cannot be defined, because hybrid table data is always ordered by primary key |

**Pruning** is how a query skips micro-partitions. Snowflake compares the filter in the query with the min and max values stored for each micro-partition and skips the partitions that cannot match. It then reads only the needed columns of the remaining partitions. A query that selects 10% of a range should ideally scan about 10% of the micro-partitions. The closer the scanned fraction is to the selected fraction, the better the pruning.

Not every predicate can prune. Snowflake does not prune on a predicate that contains a subquery, even if the subquery returns a constant.

Rows sorted along the filter column end up in few partitions, so pruning works well. Rows in random order put every value range in every partition, so almost nothing can be skipped. That is the situation clustering fixes.

How to see pruning in a query is covered in [2.1.4](../domain_2/d2-query-troubleshooting-concept.md#214-telemetry-columns-in-query_history) (partitions scanned vs total) and [2.1.5](../domain_2/d2-query-troubleshooting-concept.md#215-query-profile).

[Back to contents](#contents)

### 3.2.2 Clustering depth and overlap

Snowflake keeps clustering metadata for the micro-partitions of every table:

- the total number of micro-partitions
- the number of micro-partitions whose values overlap each other, for a chosen set of columns
- the depth of those overlaps

| Term | Meaning |
|------|---------|
| Overlap | Two micro-partitions overlap on a column when their min-to-max value ranges for that column intersect. A query that filters inside the shared range cannot skip either one |
| Clustering depth | The average depth (1 or greater) of the overlapping micro-partitions for the chosen columns. A smaller number means a better clustered table |
| Empty table | A table with no micro-partitions has a clustering depth of `0` |
| Constant state | A micro-partition whose value range overlaps no other, so reclustering cannot improve it. Constant partitions are left out when depth and overlap are computed for future maintenance |

Plain reading: a depth of 1 means no range overlaps, so a lookup touches one partition. A depth of 64 means that, on average, 64 partitions can hold a given value, so a lookup may have to read all of them. The depth and overlap are always computed for specific columns. The same table can be well clustered on one column and badly clustered on another.

Clustering depth is not an absolute measure. Snowflake states that query performance is the best indicator:

- If queries on a table perform as needed, the table is likely well clustered.
- If query performance degrades over time, the table is likely no longer well clustered and may benefit from clustering.

Uses of clustering depth:

- Monitor the clustering health of a large table over time, as DML changes it.
- Decide whether a large table would benefit from an explicit clustering key.

In a large real table, reaching a constant state for every partition is neither likely nor required to improve query performance.

[Back to contents](#contents)

### 3.2.3 The system functions

| Function | Returns | Arguments | Notes |
|----------|---------|-----------|-------|
| `SYSTEM$CLUSTERING_INFORMATION` | A JSON string (VARCHAR) with depth, overlaps, histogram, constant partitions, version, notes and errors | `'<table>'`, then optionally either `'(<expr>, ...)'` or a number of errors, not both | The full report. Includes the same average depth that `SYSTEM$CLUSTERING_DEPTH` returns |
| `SYSTEM$CLUSTERING_DEPTH` | One number: the average depth | `'<table>'`, optionally `'(<col>, ...)'`, optionally `'<predicate>'` | Smaller is better. Always 1 or more for a populated table |
| `SYSTEM$CLUSTERING_RATIO` | A number from 0 to 100. Higher means better clustered | Same as `SYSTEM$CLUSTERING_DEPTH` | **Deprecated.** Use depth or information instead |
| `SYSTEM$ESTIMATE_AUTOMATIC_CLUSTERING_COSTS` | A JSON string with the estimated initial and maintenance cost | `'<table>'`, optionally `'(<expr>, ...)'` | Best-effort estimate. See [3.2.6](#326-cost-of-clustering) |

All arguments are strings in single quotes. Column lists go inside parentheses even for one column: `'(c1)'`.

**Which columns the functions use**

- A table **with a clustering key**: the column argument is optional. If omitted, the clustering key is used.
- A table **without a clustering key**: the column argument is required, and omitting it returns an error.
- In both cases you may pass any columns. This lets you test a candidate key before you define it.

**The predicate argument of `SYSTEM$CLUSTERING_DEPTH`** limits the calculation to the rows that match, for example `'C2 = 25'`. It is written without the `WHERE` keyword. A string inside the predicate needs its own single quotes escaped by doubling them: `'col1 = 100 and col2 = ''A'''`.

```sql
-- depth using the table's clustering key
SELECT SYSTEM$CLUSTERING_DEPTH('TPCH_ORDERS');

-- depth for chosen columns
SELECT SYSTEM$CLUSTERING_DEPTH('TPCH_ORDERS', '(C2, C9)');

-- depth for one slice of the data
SELECT SYSTEM$CLUSTERING_DEPTH('TPCH_ORDERS', '(C2, C9)', 'C2 = 25');

-- full report for two columns
SELECT SYSTEM$CLUSTERING_INFORMATION('test2', '(col1, col3)');

-- the 5 most recent clustering errors
SELECT SYSTEM$CLUSTERING_INFORMATION('t1', 5);
```

**Fields returned by `SYSTEM$CLUSTERING_INFORMATION`**

| Field | Meaning | Good or bad |
|-------|---------|-------------|
| `cluster_by_keys` | The columns the report was computed for. Shown as `LINEAR(COL1, COL3)` | Can be any columns |
| `version` | `CLASSIC` (Clustering Classic) or `OPTIMA` (Optima Clustering) | See [3.2.5](#325-automatic-clustering) |
| `notes` | Suggestions, for example a warning that the clustering column has extremely high cardinality. May be empty | Read it before changing a key |
| `total_partition_count` | Total micro-partitions in the table | Context for the other numbers |
| `total_constant_partition_count` | Partitions in a constant state. They will not benefit from reclustering | A higher number means more partitions can be pruned |
| `average_overlaps` | Average number of micro-partitions overlapping each micro-partition | A high number means a poorly clustered table |
| `average_depth` | Average overlap depth. Same value as `SYSTEM$CLUSTERING_DEPTH` | A high number means a poorly clustered table |
| `partition_depth_histogram` | How many partitions fall at each depth. Buckets run `0` to `16` in steps of 1, then double: `32`, `64`, `128` and so on | Most partitions in the low buckets means a well clustered table |
| `clustering_errors` | An array of recent errors (timestamp and message) that explain why Automatic Clustering could not recluster. The 10 most recent are returned by default | Look here when depth does not improve |

Reading the histogram: each key is a depth bucket and each value is the number of micro-partitions at that depth. The Snowflake example has 698 of 1,156 partitions in the `128` bucket, zero constant partitions, an average depth of about 64, and a clustering error saying the clustering service was disabled. Snowflake reads that as a table that is not well clustered.

**Limits and behavior**

- For a table with more than 2 million micro-partitions, the results of `SYSTEM$CLUSTERING_INFORMATION` and `SYSTEM$CLUSTERING_DEPTH` are based on a subset of the partitions. In `SYSTEM$CLUSTERING_INFORMATION`, `total_partition_count` then reports 2 million.
- For tables that use Optima Clustering, `total_constant_partition_count` and `partition_depth_histogram` are not available.
- Use `SHOW TABLES` or the `TABLES` view to see the key and whether Automatic Clustering is on. The columns are `CLUSTER_BY` and `AUTOMATIC_CLUSTERING` in `SHOW TABLES`, and `CLUSTERING_KEY` and `AUTO_CLUSTERING_ON` in the `TABLES` view.

[Back to contents](#contents)

### 3.2.4 Clustering keys

A **clustering key** is one or more columns, or expressions on columns, that tell Snowflake to co-locate similar rows in the same micro-partitions. A table with a key is a **clustered table**. Materialized views can be clustered with the same rules.

**When to define a key**

Indicators from Snowflake:

- Queries on the table run slower than expected or have degraded over time.
- The clustering depth of the table is large.

A table is a good candidate when all of these hold:

| Criterion | Detail |
|-----------|--------|
| Large | Many micro-partitions. Typically multiple terabytes of data |
| Queries can use it | Queries are selective (read a small percentage of rows) or sort the data, for example with `ORDER BY` |
| Shared key | A high percentage of queries filter or sort on the same few columns |
| Stable | A high ratio of queries to DML. Frequent changes make clustering more expensive. If a clustered table has a lot of DML, group the DML into large, infrequent batches |

Clustering is optimal when you need the fastest possible response regardless of cost, or when the better performance offsets the credits needed to cluster and maintain the table. Snowflake strongly recommends testing a representative set of queries first, to set a baseline.

**Defining, changing and dropping a key**

```sql
-- at creation
CREATE TABLE t1 (c1 DATE, c2 STRING, c3 NUMBER) CLUSTER BY (c1, c2);

-- with expressions and a path in a VARIANT column
CREATE TABLE t2 (c1 TIMESTAMP, c2 STRING, c3 NUMBER) CLUSTER BY (TO_DATE(c1), SUBSTRING(c2, 0, 10));
CREATE TABLE t3 (t TIMESTAMP, v VARIANT) CLUSTER BY (v:"Data":id::NUMBER);

-- add or change on an existing table
ALTER TABLE t1 CLUSTER BY (c1, c3);

-- drop
ALTER TABLE t1 DROP CLUSTERING KEY;
```

| Rule | Detail |
|------|--------|
| Allowed in a key | Base columns, expressions on base columns, and expressions on paths in VARIANT columns |
| Not allowed | A key directly on a `VARIANT`, `OBJECT`, `ARRAY` or `GEOGRAPHY` column. For a VARIANT, give the path and the target type, for example `v:"Data":id::NUMBER` |
| Changing the key | Does not affect existing rows until Snowflake reclusters the table |
| Populated table | Not every function is allowed in the key. `SHOW FUNCTIONS LIKE '<name>'` has a `valid_for_clustering` column |
| `CREATE TABLE ... CLONE` | The key is copied, but Automatic Clustering is **suspended** on the clone and must be resumed |
| `CREATE TABLE ... AS SELECT` | The key is **not** carried over. Define it after the table is created |
| `COPY INTO` from CSV into a clustered table | Fails at compile time if the key uses a function the `COPY` command does not support, for example `DATE_TRUNC` or `UPPER` (error `002300 (0A000)`). Drop the key, load, then add it again. JSON, Parquet, Avro and ORC sources are not affected |
| Text columns, Clustering Classic | Only the first 5 bytes of each column are used. If the first characters are identical, key on a substring that starts after them, for example `SUBSTRING(vc, 5, 5)` |
| Key length, Optima Clustering | Up to 1 KB across all key columns. Interactive tables have the same 1 KB limit |
| Hybrid tables | Clustering keys are not supported |
| Privileges | To add clustering you also need USAGE or OWNERSHIP on the schema and database that contain the table |

**Choosing key columns**

Snowflake recommends at most **3 or 4** columns or expressions in one key. More columns tend to raise cost more than benefit.

Priority order:

1. Columns most used in **selective filters**. For date-based fact tables, the date column. For event tables, event type if there are many different types.
2. Columns frequently used in **join predicates**, if there is room in the key.
3. Columns used in `ORDER BY` or `GROUP BY`. These help less than filter and join columns, so favor filter and join columns when they differ.

If queries usually filter on two dimensions, for example `application_id` and `user_status`, a key on both can improve performance.

**Cardinality** is the number of distinct values in a column. A good key has:

- enough distinct values for effective pruning, and
- few enough distinct values for Snowflake to group rows into the same micro-partitions.

| Case | Example | Result |
|------|---------|--------|
| Too low | `IS_NEW_CUSTOMER` with only Boolean values | Minimal pruning |
| Too high | A nanosecond timestamp, or a unique key | Expensive to maintain. The cost can exceed the benefit unless point lookups are the main use |
| Fix for high cardinality | Use an expression that preserves order and reduces distinct values: `TO_DATE(c_timestamp)`, or `TRUNC(123456789, -5)` | Min and max in each partition still prune |

**Column order in a multi-column key:** order from **lowest to highest cardinality**. A high-cardinality column placed before a low-cardinality one generally reduces the effectiveness of clustering on the latter.

[Back to contents](#contents)

### 3.2.5 Automatic Clustering

**Automatic Clustering** is the Snowflake service that reclusters clustered tables in the background. After DML (`INSERT`, `UPDATE`, `DELETE`, `MERGE`, `COPY`), a clustered table can become less clustered. Reclustering reorganizes the column data so related rows sit in the same micro-partitions. It does this by deleting the affected rows and re-inserting them, grouped by the clustering key.

| Property | Detail |
|----------|--------|
| Warehouse | None needed. Serverless, managed by Snowflake |
| Maintenance | You define the key. Snowflake monitors the table and reclusters only when the table would benefit |
| Timing | Defining a key does not start reclustering at once |
| DML | Not blocked while a table is reclustered |
| Enabled by | Defining a clustering key. No other step, except for clones |
| Status | `AUTO_CLUSTERING_ON` in the `TABLES` view or `SHOW TABLES`. `ON` or `OFF` |
| Suspend | `ALTER TABLE t1 SUSPEND RECLUSTER;` No automatic reclustering and no clustering credits while suspended |
| Resume | `ALTER TABLE t1 RESUME RECLUSTER;` Reclustering may start again if the table is no longer well clustered |
| Changing the key | Resumes Automatic Clustering. Writing `LINEAR` in `ALTER TABLE ... CLUSTER BY` counts as a change to the key even if the columns are the same |
| Drop the key | Stops all future reclustering on the table |
| Manual reclustering | Deprecated. Still allowed for some accounts, where Automatic Clustering may not be enabled yet |

**Two versions: Optima Clustering and Clustering Classic**

| | Clustering Classic | Optima Clustering |
|-|--------------------|-------------------|
| Description | The previous Automatic Clustering behavior | Snowflake's newer autonomous table optimization engine |
| Billing | Serverless compute hours | Volume of uncompressed data ingested |
| Text key length | First 5 bytes per column | Up to 1 KB across all key columns |
| Rollout | Continues for tables that are already clustered. They stay on Classic indefinitely | Per Snowflake, tables newly clustered on or after September 1, 2026 use it |
| Moving between them | Changing the key with `ALTER TABLE` does not move a table to Optima, and there is no migrate command | |

- To see which version a table uses, check the `version` field of `SYSTEM$CLUSTERING_INFORMATION`.
- To compare cost by version over time, group the `VERSION` column (`OPTIMA` or `CLASSIC`) of `ACCOUNT_USAGE.AUTOMATIC_CLUSTERING_HISTORY`.
- Under Optima Clustering, suspending to save money is generally not cost effective. Resuming applies a catch-up cost for data ingested while suspended. To stop paying for clustering permanently, drop the clustering key.

[Back to contents](#contents)

### 3.2.6 Cost of clustering

Clustering has a compute cost and, in some cases, a storage cost.

| Cost | Detail |
|------|--------|
| Compute | Serverless credits to cluster the table the first time and to keep it clustered as data changes. More changes mean higher maintenance cost |
| Storage | Reclustering writes **new** micro-partitions. The old ones are marked deleted but kept for Time Travel and Fail-safe, and purged only after both periods end (a minimum of 8 days, and up to 97 days with extended Time Travel on Enterprise Edition or higher). Reclustering can therefore raise Fail-safe storage. Snowflake says that in many cases there is no additional storage cost |
| One-time cost | Defining a key on an existing table, or changing the key, can trigger reclustering and credit charges |

**Optima Clustering cost:** `uncompressed GB ingested x billing rate per GB x overlap factor`. The overlap factor is between 0 and 1. It is the share of ingested data that needs active clustering.

| Workload | Overlap factor | Cost |
|----------|----------------|------|
| Append-only loads clustered by an ingestion timestamp, for example `TO_DATE(ingestion_time)` | Near 0 | Little or none |
| Updates that change clustering key values | Usually 1 | Full rate |
| Data that partly overlaps existing partitions | Between 0 and 1 | In between |

A key change under Optima Clustering has a one-time cost based on the existing table size. Because the overlap factor is applied as if the whole table were newly written, a small key change that rewrites little data costs little.

**Estimating before you commit:** `SYSTEM$ESTIMATE_AUTOMATIC_CLUSTERING_COSTS('<table>', '(<expr>, ...)')`.

- It estimates the cost of clustering a table for the first time, of changing its key, and, when possible, of maintaining it afterwards.
- The returned JSON has `warning`, `reportTime`, `clusteringKey`, `initial` (with `unit`, `value`, `comment`) and `maintenance`. An empty `maintenance` object means Snowflake could not estimate it, usually because the table needs more DML history.
- The estimates are best effort. Actual cost can vary by up to 100%, and in rare cases by several times.
- For Optima Clustering it estimates one-time costs only. It does not yet return a maintenance estimate. Maintenance cost is bounded by the per-GB billing rate.
- If the argument is omitted for a table that already has a key, it uses that key. For a table with no key, the argument is required.

**Viewing cost after the fact**

- Snowsight: Admin, then Cost management.
- `INFORMATION_SCHEMA.AUTOMATIC_CLUSTERING_HISTORY` table function.
- `ACCOUNT_USAGE.AUTOMATIC_CLUSTERING_HISTORY` view. It returns `START_TIME`, `END_TIME`, `CREDITS_USED`, `NUM_BYTES_RECLUSTERED`, `NUM_ROWS_RECLUSTERED`, the table, schema and database, and `VERSION`. Both versions appear under the Auto Clustering service type.

**Advice from Snowflake before enabling it widely:** start with one or two tables and observe the credit charges as DML runs. That gives a baseline for the cost of keeping a table clustered.

[Back to contents](#contents)

### 3.2.7 Decision flow: should this table be clustered?

| Step | Check | Tool |
|------|-------|------|
| 1 | Is a query slow, or has it become slower over time? | [Query Profile and `QUERY_HISTORY`](../domain_2/d2-query-troubleshooting-concept.md#215-query-profile) |
| 2 | Does it scan almost all partitions? | Partitions scanned vs Partitions total |
| 3 | Is the table large, and do most queries filter or sort on the same few columns? | Query workload review |
| 4 | How well is the table clustered on those columns today? | `SYSTEM$CLUSTERING_DEPTH` or `SYSTEM$CLUSTERING_INFORMATION` with a column list. Works without a key |
| 5 | Is the candidate key good? | Cardinality, column order, at most 3 or 4 columns, expressions for high cardinality |
| 6 | What will it cost? | `SYSTEM$ESTIMATE_AUTOMATIC_CLUSTERING_COSTS` |
| 7 | Define the key | `ALTER TABLE ... CLUSTER BY (...)` |
| 8 | Watch it | Depth over time, `AUTOMATIC_CLUSTERING_HISTORY`, query times, and `clustering_errors` |

[Back to contents](#contents)

### 3.2 open items and flags

- **Pages fetched:** micro-partitions and data clustering, clustering keys and clustered tables, Automatic Clustering, `SYSTEM$CLUSTERING_INFORMATION`, `SYSTEM$CLUSTERING_DEPTH`, `SYSTEM$CLUSTERING_RATIO`, `SYSTEM$ESTIMATE_AUTOMATIC_CLUSTERING_COSTS` and the `AUTOMATIC_CLUSTERING_HISTORY` view.
- **Pages not fetched:** the Manual Reclustering page, the `AUTOMATIC_CLUSTERING_HISTORY` table function reference, `SYSTEM$EXPLAIN_PLAN_JSON`, the `TABLE_STORAGE_METRICS` view, and the search optimization and query acceleration pages. The last two are planned for 2.2. The study guide lists `SYSTEM$EXPLAIN_PLAN_JSON` and `TABLE_STORAGE_METRICS` as Domain 3 resources, so they may belong to 3.1 or 3.2.
- **Optima Clustering is recent.** The 1 September 2026 rollout date, the billing formula and the field restrictions come from the Snowflake pages as fetched. It is unknown whether the exam tests Optima Clustering or only Clustering Classic. Check the page again before the exam.
- **Section ownership.** The "Automatic Clustering features and optimizations" bullet may belong to 3.1. It is covered here either way.
- **Not run in Snowflake.** The SQL samples are adapted from Snowflake's examples and were not executed.
- **Explanations marked as mine.** The plain-language reading of overlap and depth ("a depth of 64 means about 64 partitions can hold a given value"), and the remark that sorted rows land in few partitions, are my explanations. Snowflake defines depth as the average depth of overlapping partitions and says smaller is better.
- **Depth thresholds.** Snowflake gives no cut-off for a "good" or "bad" depth, so none is stated here.
