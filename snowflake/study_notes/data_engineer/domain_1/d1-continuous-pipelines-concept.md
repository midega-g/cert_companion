# Domain 1: Data Movement, continuous pipelines (SnowPro Advanced: Data Engineer, DEA-C02)

Weight: **28%**. Domain 1 notes are split across 8 files: [d1-load-data-concept.md](d1-load-data-concept.md) (1.1: load data); [d1-ingest-data-formats-concept.md](d1-ingest-data-formats-concept.md) (1.2: ingest data of various formats); [d1-troubleshoot-ingestion-concept.md](d1-troubleshoot-ingestion-concept.md) (1.3: troubleshoot data ingestion); [d1-streams-and-tasks-concept.md](d1-streams-and-tasks-concept.md) (1.4.1 to 1.4.12: streams and tasks); this file, 1.4.13 to 1.4.26: dynamic tables, Snowpipe and developer tools; [d1-connectors-concept.md](d1-connectors-concept.md) (1.5: connectors); [d1-data-sharing-concept.md](d1-data-sharing-concept.md) (1.6: data sharing and consumption); [d1-tables-and-data-operations-concept.md](d1-tables-and-data-operations-concept.md) (1.7: tables and data operations). A section is added only after it is approved. The contents table below lists only the sections in this file.

## Contents

| Section | Topic | Status |
|---------|-------|--------|
| 1.4 | [Design, build and troubleshoot continuous data pipelines: dynamic tables, Snowpipe and developer tools (1.4.13 to 1.4.26)](#14-design-build-and-troubleshoot-continuous-data-pipelines-dynamic-tables-snowpipe-and-developer-tools) | Approved |

---

## 1.4 Design, build and troubleshoot continuous data pipelines: dynamic tables, Snowpipe and developer tools

This section is split across two files. This file covers dynamic tables, materialized views, Snowpipe (auto-ingest versus REST API), Snowpipe Streaming versus the Kafka connector, UDFs, the SQL API, Openflow, notebooks and Snowflake Scripting (1.4.13 to 1.4.26). Streams and tasks (1.4.1 to 1.4.12) are in [d1-streams-and-tasks-concept.md](d1-streams-and-tasks-concept.md). Stages in pipelines are covered in 1.2.

**Sections in 1.4 (continuous pipelines)**

- [1.4.13 Dynamic tables: definition and creation](#1413-dynamic-tables-definition-and-creation)
- [1.4.14 Dynamic tables: target lag](#1414-dynamic-tables-target-lag)
- [1.4.15 Dynamic tables: refresh modes](#1415-dynamic-tables-refresh-modes)
- [1.4.16 Dynamic tables: supported queries and UDFs](#1416-dynamic-tables-supported-queries-and-udfs)
- [1.4.17 Dynamic tables: suspend, resume, refresh, monitor, cost](#1417-dynamic-tables-suspend-resume-refresh-monitor-cost)
- [1.4.18 Materialized views](#1418-materialized-views)
- [1.4.19 Choosing between dynamic tables, streams and tasks, and materialized views](#1419-choosing-between-dynamic-tables-streams-and-tasks-and-materialized-views)
- [1.4.20 Snowpipe: auto-ingest compared with the REST API](#1420-snowpipe-auto-ingest-compared-with-the-rest-api)
- [1.4.21 Snowpipe Streaming and the Kafka connector](#1421-snowpipe-streaming-and-the-kafka-connector)
- [1.4.22 UDFs and stored procedures](#1422-udfs-and-stored-procedures)
- [1.4.23 SQL API](#1423-sql-api)
- [1.4.24 Openflow](#1424-openflow)
- [1.4.25 Notebooks and Snowflake Scripting in pipelines](#1425-notebooks-and-snowflake-scripting-in-pipelines)
- [1.4.26 Quick-reference for continuous pipelines](#1426-quick-reference-for-continuous-pipelines)
- [1.4 Continuous pipelines: open items and flags](#14-continuous-pipelines-open-items-and-flags)

[Back to contents](#contents)

### 1.4.13 Dynamic tables: definition and creation

A dynamic table (DT) materializes the result of a `SELECT` and keeps it current. You give the query and a target lag. Snowflake tracks the base tables, refreshes in dependency order, and applies each refresh **atomically**, so readers never see a partial refresh.

```sql
CREATE [ OR REPLACE ] [ TRANSIENT ] DYNAMIC TABLE [ IF NOT EXISTS ] dt_orders
  TARGET_LAG = { '<num> { seconds | minutes | hours | days }' | DOWNSTREAM }   -- required with the default scheduler
  WAREHOUSE = transform_wh                                                    -- required
  [ INITIALIZATION_WAREHOUSE = big_wh ]
  [ REFRESH_MODE = { AUTO | FULL | INCREMENTAL | ADAPTIVE | CUSTOM_INCREMENTAL } ]   -- default AUTO
  [ INITIALIZE = { ON_CREATE | ON_SCHEDULE } ]                                -- default ON_CREATE
  [ SCHEDULER = { ENABLE | DISABLE } ]
  [ CLUSTER BY (...) ] [ DATA_RETENTION_TIME_IN_DAYS = n ] [ COPY GRANTS ]
AS SELECT ...;
```

| Item | Detail |
|------|--------|
| Privileges to create | `CREATE DYNAMIC TABLE` on the schema, `USAGE` on the warehouse, and the right to read the base objects |
| Who refreshes | The **owner role** (the role that ran `CREATE`) runs background refreshes |
| `INITIALIZE = ON_CREATE` | Synchronous first refresh at creation. If it fails, creation fails |
| `INITIALIZE = ON_SCHEDULE` | No data until the first scheduled refresh. Querying earlier returns "Dynamic Table is not initialized. Please run a manual refresh or wait for a scheduled refresh before querying." **Can't be altered**, only replaced with `CREATE OR REPLACE` |
| `INITIALIZATION_WAREHOUSE` | Used for initializations and reinitializations. Without it, the `WAREHOUSE` handles everything |
| Change tracking | Must be enabled on all base objects. The create page says this and links to a section I did not read, so who enables it is not covered here |
| `CREATE OR REPLACE` | Equivalent to drop and create. The old table is not dropped until the new one exists (including the initial refresh with `ON_CREATE`) |
| `CREATE OR ALTER DYNAMIC TABLE` | The definition is the **full target state**: any property you omit goes to its default (except `CHANGE_TRACKING` and `ROW_TIMESTAMP`, which are kept). It triggers **no refresh** on an existing table, but a **new** table with `INITIALIZE = ON_CREATE` is refreshed. It is **not atomic**: a failure can leave partial changes ("Partial updates may have been applied"). Re-run it to fix forward |
| Not possible with `CREATE OR ALTER` | Swap, rename, clone, suspend, resume, changing `TRANSIENT`, adding tags or policies. Columns can only be added **at the end**. Renaming trailing columns forces a full reinitialization |
| Clone | Cloned dynamic tables (also in a cloned database or schema) start **suspended** |
| `ORDER BY` in the definition | Accepted, no effect. Order the query on the DT instead. No `ORDER BY` in a view over a DT |
| Pre-clustering | Incremental or adaptive DTs pre-cluster only at creation and reinitialization (by `CLUSTER BY`, else a derived primary key, else a row ID). Full-refresh DTs are **not** pre-clustered by the clustering key. Use a top-level `ORDER BY` |
| Pipeline | DTs that read other DTs form a pipeline. Snowflake infers the graph from the queries and refreshes upstream first at one consistent snapshot timestamp |
| Primary keys | Optional, but `PRIMARY KEY ... RELY` on base tables improves incremental refresh |
| `DYNAMIC_TABLE_REFRESH_BOUNDARY()` | In the query, marks an upstream DT as a **soft dependency**. It is treated as a separate pipeline, so cascading refreshes and snapshot isolation stop at the boundary |

A DT can be the source of a stream (see 1.4.3).

[Back to contents](#contents)

### 1.4.14 Dynamic tables: target lag

Target lag is a **staleness goal, not a refresh interval**. `'10 minutes'` means the data should be at most 10 minutes behind the base tables. It does not mean "refresh every 10 minutes".

- **Minimum is 60 seconds.** Lower values fail validation. If a DT depends on another DT, its lag must be **greater than or equal to** the upstream DT's lag. A shorter downstream lag is an error.
- Actual lag can exceed the target (warehouse size, data volume, query complexity, pipeline depth). Don't assume the target always holds.
- If a refresh is still running when the next would start, Snowflake **waits**. It does not start a second concurrent refresh of the same DT. If refreshes always take longer than the lag, staleness grows.
- If an upstream table did not change, downstream refreshes can be skipped.
- Lag is measured against the **root base tables** of the pipeline, not the direct upstream DT.
- Change it with `ALTER DYNAMIC TABLE dt SET TARGET_LAG = '5 minutes'`. This does not trigger reinitialization.

**`TARGET_LAG = DOWNSTREAM`**: the DT has no schedule of its own. It refreshes only when a downstream DT needs it, using the **shortest** lag among its consumers.

| Upstream | Downstream | Result |
|----------|------------|--------|
| `DOWNSTREAM` | `'10 minutes'` | **Recommended.** Upstream refreshes on demand |
| `'5 minutes'` | `'10 minutes'` | Downstream refreshes within 10 minutes using upstream data at most 5 minutes old |
| `'10 minutes'` | `DOWNSTREAM` | **Avoid.** The downstream DT has no consumer and never refreshes |
| `DOWNSTREAM` | `DOWNSTREAM` | Nothing refreshes automatically. Use a manual refresh |
| `'1 hour'` | `'10 minutes'` | **Invalid.** Error |

- A `DOWNSTREAM` DT with no downstream consumers **never refreshes automatically, and Snowflake gives no warning**.
- Consumers that reference the DT through `DYNAMIC_TABLE_REFRESH_BOUNDARY()` are soft dependencies and **don't count** as downstream consumers for scheduling.

[Back to contents](#contents)

### 1.4.15 Dynamic tables: refresh modes

The refresh mode is set **at creation**. `ALTER` can't change it. Use `CREATE OR REPLACE` (drops, recreates and reinitializes the table and its downstream tables) or `CREATE OR ALTER` (some transitions reinitialize).

| Mode | Behavior | Use when |
|------|----------|----------|
| `INCREMENTAL` | Processes only rows changed since the last refresh and merges them | The definition uses only incrementally supported constructs and **under about 5%** of base data changes per refresh. Creation **fails** if a construct is unsupported |
| `FULL` | Re-runs the whole query and replaces the output | Unsupported constructs (for example `INTERSECT`, `EXCEPT`, `PERCENTILE_CONT`), high change volume, or predictable cost |
| `ADAPTIVE` | Incremental by default. **Reinitializes automatically** when Snowflake judges an incremental refresh would cost more than a rebuild, then goes back to incremental | The doc's preferred mode for all incrementalizable workloads, especially with occasional bulk loads such as `INSERT OVERWRITE` |
| `AUTO` (default) | Evaluates the definition **once at creation** and resolves to `ADAPTIVE` or `FULL`. The result is locked in | Prototyping only. Set an explicit mode in production |
| `CUSTOM_INCREMENTAL` | You write the refresh logic in a `REFRESH USING` clause (one `MERGE` or `INSERT` statement). Bypasses standard query analysis. Needs an explicit column list. `CHANGES()` inside can't use time bounds | Logic that the standard modes can't express. `AUTO` resolves to it if `REFRESH USING` is present |

- **AUTO resolved to INCREMENTAL in older releases.** Existing DTs that resolved to `INCREMENTAL` keep it. New `AUTO` tables resolve to `ADAPTIVE`. To get incremental without adaptive reinitialization, set `REFRESH_MODE = INCREMENTAL` explicitly.
- **AUTO can fall back to FULL.** After creation it never switches. If an upstream change later makes incremental impossible, refreshes **fail** instead of falling back.
- Verify the resolved mode: `SHOW DYNAMIC TABLES` columns `refresh_mode` and `refresh_mode_reason` (`NULL` for ADAPTIVE or INCREMENTAL, or the reason for FULL, for example "Unsupported query operator type: SetOperation[EXCEPT]").
- **ADAPTIVE reinitialization** typically happens after `INSERT OVERWRITE` on a base table, or bulk deletes and updates touching a large share of tracked rows. It typically **does not** happen for definitions with only projections, filters or sorts, or with expensive operators (Cortex AI functions, UDFs, external functions). Seen in `DYNAMIC_TABLE_REFRESH_HISTORY` as `REFRESH_ACTION = 'REINITIALIZE'` with a `REINIT_REASON`. A **frozen region** reduces the impact. `INITIALIZATION_WAREHOUSE` can use a bigger warehouse just for reinitializations.
- ADAPTIVE and INCREMENTAL have the same construct requirements. Both can sit upstream or downstream of each other. Either can sit downstream of a **FULL** DT only if that upstream DT has a system-derived unique key or a frozen region.
- Snowflake **never** changes the mode based on change volume. The 5% figure is a guideline.
- Full refresh is the better start for: truncate-and-replace loads, small dimension tables replaced wholesale, queries stacking several blocking operators (`GROUP BY`, `DISTINCT`, window functions), and high-churn tables with heavy deletes. Compare average refresh time in `DYNAMIC_TABLE_REFRESH_HISTORY` to check whether incremental helps.
- Exact percentiles, set difference and intersection need all rows, so they can't be incremental.

[Back to contents](#contents)

### 1.4.16 Dynamic tables: supported queries and UDFs

| Construct | Incremental | Full |
|-----------|-------------|------|
| `WITH` (CTE) | Yes if the CTE is incremental-safe. **`WITH RECURSIVE` no** | Yes |
| `CONNECT BY` | **No** | Yes |
| Joins: inner, cross | Yes, any number of tables, all tracked | Yes |
| Outer joins | Yes with **equality** predicates only (self-joins allowed) | Yes |
| `LATERAL` | **No**, except `LATERAL FLATTEN` (not the `SEQ` column) | Yes |
| `UNION ALL`, `UNION` | Yes | Yes |
| `MINUS`, `EXCEPT`, `INTERSECT` | **No** | Yes |
| `GROUP BY` | Yes. `ROLLUP`, `CUBE`, `GROUPING SETS` **no** | Yes |
| `LIMIT`, `FETCH`, `TOP n` | **No** | Yes |
| Window functions | Yes, except `RANK`, `DENSE_RANK`, `PERCENT_RANK` with sliding frames, and `ANY_VALUE` | Yes |
| Subqueries outside `FROM` (for example `WHERE EXISTS`) | **Not supported in either mode** | Not supported |
| `CURRENT_TIMESTAMP`, `CURRENT_DATE`, `CURRENT_TIME` in `WHERE`, `HAVING`, `QUALIFY` | Yes | Yes |
| Scalar UDF, `IMMUTABLE` | Yes | Yes |
| Scalar UDF, `VOLATILE` | Yes, **in the `SELECT` list only** (not `WHERE`, `GROUP BY`, `HAVING`, `QUALIFY`) | Yes |
| UDTF | **Always forces full refresh**. Lateral joins only | Yes |
| Cortex AI functions | `SELECT` list only | Yes |
| Stored procedures, external functions | **Not supported** in the definition | Not supported |
| Snowpark | Not supported | Not supported |

- **Replacing an `IMMUTABLE` UDF that a DT uses makes later incremental refreshes fail.** Recreate the DT.
- Data types: everything except **structured** types (structured `OBJECT`, structured `ARRAY`, `MAP`). Geospatial types work only with full refresh. Semi-structured `VARIANT`, `OBJECT`, `ARRAY` are fine.
- If a definition has a construct that isn't supported incrementally, **`AUTO`** picks full. An explicit `INCREMENTAL` or `ADAPTIVE` makes creation fail.
- The supported-queries page lists newer additions with dates (for example `UNION`, `MIN_BY`/`MAX_BY`, `VOLATILE` UDFs, `VALUES`). These changed over time, so older notes may disagree.

[Back to contents](#contents)

### 1.4.17 Dynamic tables: suspend, resume, refresh, monitor, cost

**Privileges**: suspend, resume, alter warehouse, target lag or `SCHEDULER`, and manual refresh need `OWNERSHIP` or `OPERATE`. Drop and undrop need `OWNERSHIP`.

**Suspend and resume**

| Behavior | Detail |
|----------|--------|
| `ALTER DYNAMIC TABLE dt SUSPEND` | Stops scheduled refreshes. Data stays queryable. Manual `REFRESH` still works. Only storage cost continues |
| Cascade | Suspending a DT also **suspends downstream DTs**. They can't be resumed individually until upstream is resumed |
| Resume cascade | Resuming also resumes downstream DTs suspended by cascade (`UPSTREAM_USER_SUSPENDED`, `UPSTREAM_SUSPENDED_DUE_TO_ERRORS`). A downstream DT that a user suspended directly (`USER_SUSPENDED`) stays suspended |
| **Auto-suspend** | After **5 consecutive scheduled refresh failures**. Manual refresh failures don't count. Any success resets the count. No auto-resume. Run `RESUME` after fixing |
| Reason codes | `USER_SUSPENDED`, `UPSTREAM_USER_SUSPENDED`, `SUSPENDED_DUE_TO_ERRORS`, `UPSTREAM_SUSPENDED_DUE_TO_ERRORS` (in `SCHEDULING_STATE` of `DYNAMIC_TABLE_GRAPH_HISTORY`) |
| Long suspension | If suspended longer than the base tables' `DATA_RETENTION_TIME_IN_DAYS` (default 1), change-tracking data expires. An incremental DT then fails on resume. **The only recovery is to drop and recreate it** |
| State names | `SHOW DYNAMIC TABLES` says `RUNNING`. `DYNAMIC_TABLE_GRAPH_HISTORY` says `ACTIVE`. Same state |

**`SUSPEND` versus `SCHEDULER = DISABLE`**

| | `SUSPEND` | `SET SCHEDULER = DISABLE` |
|---|-----------|---------------------------|
| Meaning | Temporary stop, configuration kept | Permanently detach from scheduling |
| `TARGET_LAG` | Kept | Reported as `NULL`. Set a new `TARGET_LAG` to re-enable |
| Manual refresh | Cascades to upstream and downstream DTs normally | Does **not** cascade. An isolation boundary for external orchestrators such as dbt or Airflow |

**Manual refresh**: `ALTER DYNAMIC TABLE dt REFRESH`. Avoid frequent manual refreshes on DTs with scheduled downstream consumers, because they can make Snowflake skip scheduled checks.
- `ALTER DYNAMIC TABLE a, b REFRESH;` refreshes several DTs at **one data timestamp**. A shared upstream refreshes once. Each uses its own warehouse. Needs `OPERATE` on every listed DT and the upstream DTs. It is **not atomic**: successes stay refreshed, and the statement errors if any ends `FAILED`, `UPSTREAM_FAILED` or `CANCELLED`. It can't run in an explicit transaction. Listed DTs refresh even if `SCHEDULER = DISABLE`.

**Monitor**

| Source | Use | Retention |
|--------|-----|-----------|
| `SHOW DYNAMIC TABLES` | `refresh_mode`, `refresh_mode_reason`, `scheduling_state`, `target_lag` | Current state |
| `INFORMATION_SCHEMA.DYNAMIC_TABLES()` | Fleet health: `target_lag_sec`, `time_within_target_lag_ratio`, `maximum_lag_sec`, last refresh state. **A ratio below 0.90** means the DT misses its target most of the time | 7 days |
| `DYNAMIC_TABLE_REFRESH_HISTORY()` | One row per refresh: state, error, duration, `refresh_trigger`, `refresh_action` (`NO_DATA`, `REINITIALIZE` and others) | **7 days** |
| Account Usage `DYNAMIC_TABLE_REFRESH_HISTORY` view | Trends | **365 days** |
| `DYNAMIC_TABLE_GRAPH_HISTORY()` | Dependency graph, scheduling state and target lag over time | 7 days |
| Event table | Alerts on refresh failures. Filter `resource_attributes:"snow.executable.type" = 'DYNAMIC_TABLE'`. The event table uses `UPSTREAM_FAILURE`, the history function uses `UPSTREAM_FAILED` | Per event table |

**Cost**: three parts.
- **Warehouse compute** for each refresh.
- **Cloud Services** for change detection, compilation and scheduling. It runs on **every refresh cycle, even with no data change**. It is billed only when the day's Cloud Services credits exceed **10%** of that day's warehouse credits. Many DTs, short lags and deep pipelines raise it.
- **Storage** for the table and its Time Travel.
- A short lag on a DT with rare upstream changes causes many `NO_DATA` refreshes. Raise the lag to cut Cloud Services cost.
- A full refresh chosen by `AUTO` can raise warehouse cost unexpectedly. Check `refresh_mode`.

[Back to contents](#contents)

### 1.4.18 Materialized views

A materialized view (MV) is a precomputed, stored result of a query, **maintained automatically** by a Snowflake background service. It requires **Enterprise Edition or higher**. Its purpose is **read acceleration**, not building a pipeline.

**When to use**: results are small relative to the base table, the query is expensive (aggregates, semi-structured parsing, external tables), the base data changes rarely, and the MV is read much more often than the base table changes. Use a regular view when results change often, are read rarely, or are cheap to compute.

**Behavior**
- Data is **always current**. If maintenance lags, Snowflake skips stale micro-partitions of the MV and reads those parts from the base table. A lagging MV is slower, not wrong.
- The optimizer can **rewrite queries on the base table** to use the MV (range, `OR`, `AND` and aggregate subsumption). A user needs no privilege on the MV for a rewritten query. The MV shows in `EXPLAIN` and Query Profile. The optimizer may still choose the base table (for example when the table is clustered and prunes well).
- Creation runs a CTAS-like load and can take a long time.
- Maintenance: inserts cause a **refresh**, deletes cause a **compaction**. `SHOW MATERIALIZED VIEWS` shows `REFRESHED_ON`, `COMPACTED_ON` and `BEHIND_BY`.
- If maintenance hits a user data error (for example division by zero), the MV becomes **invalid**. Querying it fails with the reason. Fix the data, then `ALTER MATERIALIZED VIEW mv RESUME`.
- `ALTER MATERIALIZED VIEW mv SUSPEND` stops maintenance, and **you can't query it** until `RESUME`.

**Limits when creating** (current limitations)
- **One table only.** No joins, including self-joins. It can't query another MV, a regular view, a **hybrid table**, a **dynamic table** or a UDTF.
- Not allowed: **UDFs** (including external functions), window functions, `HAVING`, `ORDER BY`, `LIMIT`, `GROUPING SETS`, `ROLLUP`, `CUBE`, `MINUS`, `EXCEPT`, `INTERSECT`, nested subqueries, and `GROUP BY` keys not in the select list.
- Aggregates allowed: `APPROX_COUNT_DISTINCT`, `AVG` (not in `PIVOT`), `BITAND_AGG`, `BITOR_AGG`, `BITXOR_AGG`, `COUNT`, `COUNT_IF`, `MAX`, `MIN`, `STDDEV`, `STDDEV_SAMP`, `STDDEV_POP`, `SUM`, `VARIANCE`, `VAR_SAMP`, `VARIANCE_POP`, `VAR_POP`. No nesting of aggregates (put a regular view on top of the MV). No `DISTINCT` with aggregates. No `OVER` clause.
- Functions must be **deterministic**. `CURRENT_TIMESTAMP` and `CURRENT_TIME` are not permitted. Don't depend on session parameters such as `TIMESTAMP_TYPE_MAPPING`. Cast to a fixed type, for example `to_timestamp(n)::TIMESTAMP_NTZ`.
- Column names can't start with `SYSTEM$` or `METADATA$`, contain `$SYS_FACADE$`, or be `SYS_MV_SOURCE_PARTITION`. Alias them.
- Don't select the `SEQ` column of `FLATTEN`. Can't create an MV with Time Travel.
- Avoid `SELECT *`. Added base-table columns don't appear in the MV.
- Use fully qualified base table names, with the same qualifier at every reference.
- With `CLUSTER BY` you must give the column list.
- Privileges: `CREATE MATERIALIZED VIEW` on the schema and `SELECT` on the base table. Reading the MV needs `SELECT` on the MV only. MVs can be `SECURE`. Check `IS_SECURE` in `SHOW MATERIALIZED VIEWS`.

**Limits when using**
- No `COPY`, `DELETE`, `INSERT`, `MERGE`, `UPDATE`, or `TRUNCATE` on an MV.
- No direct `CREATE MATERIALIZED VIEW ... CLONE`. Cloning a schema or database clones the MV. If the base table is cloned in the same operation, the clone points to the cloned table. Otherwise it points to the original.
- No Time Travel **queries** on an MV (`AT`), but historical data is kept for cloning, and you pay for its storage per `DATA_RETENTION_TIME_IN_DAYS`.
- **Resource monitors don't control MV maintenance credits.**
- A stream can't be created on an MV (1.4.3).

**Base table changes**

| Change | Effect on the MV |
|--------|------------------|
| Add a column | Not propagated, MV not suspended |
| **Change or drop a column** (even one the MV doesn't use) | All MVs on the table are **suspended and cannot be resumed**. Recreate with `CREATE OR REPLACE MATERIALIZED VIEW ... COPY GRANTS` |
| Rename or swap the table, or drop or swap its schema or database | MV suspended, usually must be recreated |
| Drop the table | MV suspended, not dropped. Recreate the table first, then `CREATE OR REPLACE MATERIALIZED VIEW ... COPY GRANTS` |

**Cost**: storage for the stored result plus **serverless** maintenance compute billed per second. Cost grows with the number of MVs per table, the share of micro-partitions that change (including reclustering of the base table), and the number of **clustered** MVs. A clustered MV on an independent column can rewrite many more partitions than the base table changes. There is **no tool to estimate** maintenance cost.
- Check it with `MATERIALIZED_VIEW_REFRESH_HISTORY` (table function and Account Usage view) or Snowsight (Cost management, Materialized View service type).
- Suspending only defers cost. The longer maintenance is deferred, the more work is waiting.
- Batch DML on the base table (`INSERT`, `UPDATE`, `MERGE`, and periodic deletes) to lower maintenance cost. Filter rows and columns in the MV. Cluster the MV rather than the base table when the base table is rarely queried directly. Start with a few MVs and watch cost.

[Back to contents](#contents)

### 1.4.19 Choosing between dynamic tables, streams and tasks, and materialized views

| Scenario | Dynamic tables | Streams and tasks | Materialized views |
|----------|----------------|-------------------|--------------------|
| SQL pipeline with joins or aggregations | **Preferred** | Possible | No (single table) |
| Multi-step declarative pipeline (bronze, silver, gold) | **Preferred** | Possible | No |
| Incremental processing of changes | **Preferred** (declarative) | **Preferred** (procedural) | No |
| Single-table query acceleration | Possible | Possible | **Preferred** |
| Procedural logic (stored procedures, `IF`, loops) | No | **Preferred** | No |
| `MERGE` or complex upsert | No | **Preferred** | No |
| External function calls or API integration | No | **Preferred** | No |
| Always-current data, no lag | No (minimum 60 seconds) | Possible (not zero lag) | **Preferred** |
| Transparent query rewrite | No | No | **Preferred** |
| Custom scheduling or strict orchestration | Possible (manual trigger only, no CRON or cascade) | **Preferred** | No |
| UDFs, UDTFs, Snowpark | Possible (scalar UDFs and UDTFs with explicit column lists, no Snowpark) | **Preferred** | No |

- A DT replaces the stream, task and `MERGE` combination with one `SELECT`. The decision guide recommends DTs for new multi-table SQL pipelines.
- DTs **don't support** freshness under 60 seconds or guaranteed refresh timing, stored procedures or external functions in the definition, or UDTFs outside lateral joins.

[Back to contents](#contents)

### 1.4.20 Snowpipe: auto-ingest compared with the REST API

A pipe holds one `COPY INTO` statement. Snowpipe learns about new files in one of two ways. Everything after that (compute, billing, load metadata, error handling) is the same. Pipe troubleshooting is in 1.3.4 to 1.3.6. Loading basics are in 1.1.

| | Auto-ingest (automated loading) | Snowpipe REST API |
|---|---------------------------------|-------------------|
| How Snowpipe learns of files | Cloud storage event notification | Your app calls `insertFiles` |
| Pipe definition | `AUTO_INGEST = TRUE` | `AUTO_INGEST = FALSE` (default) |
| Code to write | None | Stage the file, call the API, check results |
| Stages | External stages on S3, GCS, Azure (Blob, ADLS Gen2, GPv2). Internal stages: **preview, AWS accounts only** | Named internal stages, table stages, external stages, **including S3-compatible storage** |
| Setup | Event notifications at the cloud provider. GCS and Azure also need a **notification integration** | A service user with key-pair auth (or workload identity federation) and a role |
| Pick it when | Files land in S3, GCS or Azure and you can configure notifications | Storage can't send events, files are in an internal stage on a non-AWS cloud, or **your app decides when files are ready** |
| Not available | S3-compatible storage, Microsoft Fabric OneLake, cross government/commercial region | n/a |

If the data is rows or events rather than files, use Snowpipe Streaming (1.4.21). For a database or SaaS source, use an Openflow connector (1.4.24). For large one-time or scheduled loads, use bulk `COPY INTO`.

**Auto-ingest per cloud**

| | S3 | GCS | Azure |
|---|----|-----|-------|
| Event | `s3:ObjectCreated:*` | `OBJECT_FINALIZE` | `Microsoft.Storage.BlobCreated` (operations that finish writing a file) |
| Message service | SQS, optionally with SNS, or EventBridge with SNS | Pub/Sub topic and pull subscription | Event Grid and Azure Queue Storage |
| Who creates the queue | **Snowflake** (ARN in `notification_channel` of `DESCRIBE PIPE`) | You | You |
| Connection | Bucket event points at the pipe's SQS queue. With SNS, set `AWS_SNS_TOPIC` | Notification integration, `INTEGRATION` in the pipe | Notification integration, `INTEGRATION` in the pipe |
| Access you grant | SNS access policy (for SNS or EventBridge) | Pub/Sub Subscriber on the subscription, Monitoring Viewer on the project | Storage Queue Data Contributor on the queue |

- Your storage doesn't need to be on the same cloud or region as your account. Cross-region or cross-cloud reads can incur egress fees.
- Notifications carry file **paths**, not data.
- **Give each pipe its own location.** Overlapping pipe paths load the same file twice, and into the same table that means duplicates. End stage URLs and pipe paths with `/`, because without it `orders` also matches `orders_archive/`.
- **Filter events at the source.** Use `PATTERN` only when provider filtering isn't precise enough. Snowpipe still receives notifications for files `PATTERN` excludes.
- Notification sharing: on S3 Snowflake usually reuses one SQS queue per AWS region for the account's pipes, so one bucket notification can serve all pipes on that bucket. On GCS and Azure, several pipes can share one notification integration. Create only **one integration per subscription or queue**. A second integration on the same queue fails.
- A new pipe loads only files that arrive **after** notifications are configured. Setup guides load files staged in the **last 7 days**. For older files see 1.3.6 and "Manage Snowpipe".
- **Paused pipe**: notifications are held **14 days**. After that the pipe is stale and Snowflake can't guarantee loading of older notifications.
- Monitor: `SYSTEM$PIPE_STATUS` fields `notificationChannelName`, `lastReceivedMessageTimestamp`, `lastForwardedMessageTimestamp`, `numOutstandingMessagesOnChannel`, `channelErrorMessage` (see 1.3.4).
- Private connectivity: S3, SNS and SQS traffic stays on the Amazon network but doesn't flow through your VPC. Azure can use private connectivity for the storage queue.

**REST API**

| Endpoint | Method | What it does | Privilege |
|----------|--------|--------------|-----------|
| `insertFiles` | `POST` | Queue **up to 5,000** staged files | `OPERATE` on the pipe |
| `insertReport` | `GET` | Files loaded or failed in the **last 10 minutes** (up to the 10,000 most recent) | `MONITOR` on the pipe or `MONITOR EXECUTION` on the account |
| `loadHistoryScan` | `GET` | Files in a time range, **within the last 14 days**, up to 10,000 per call. Rate limited, use narrow ranges | Same as `insertReport` |

URL: `https://<account>.snowflakecomputing.com/v1/data/pipes/<DB.SCHEMA.PIPE>/<endpoint>?requestId=<uuid>`. All callers also need `USAGE` on the pipe's database and schema.
- A `200` on `insertFiles` means **queued**, not loaded. Check with `insertReport`, `loadHistoryScan` or `COPY_HISTORY`. Poll `insertReport` every few minutes and pass the previous `nextBeginMark` as `beginMark`. If `completeResult` is `false`, results were missed, so use `loadHistoryScan`.
- Statuses: `LOADED`, `LOAD_IN_PROGRESS`, `PARTIALLY_LOADED`, `LOAD_FAILED`. `COPY_HISTORY` shows `Loaded`, `Load in progress`, `Partially loaded`, `Load failed`.
- `COPY_HISTORY` function covers 14 days. The Account Usage view covers 365 days (latency usually up to 2 hours, up to 2 days for a table with few recent loads).
- Auth: JWT signed with a key pair (`Authorization: Bearer <jwt>`) or workload identity federation (`Bearer WIF.<token>`). No sessions. The Snowflake Ingest SDKs (Java, Python) build requests and tokens. Requests run with the user's **default role** (or `PUBLIC` if none). Use a dedicated **service user** (`TYPE = SERVICE`) per application.
- The **pipe owner**, not the caller, needs the load privileges (`USAGE` or `READ` on the stage, `INSERT` on the table).
- Retry timeouts, `429` and `5xx`. Retries are safe because Snowpipe skips files it already received. Retrying does nothing for a request over 5,000 files or an unparseable body. A path over 1,024 bytes returns `400`.
- Resubmitting a file does **not** reload it, even if you corrected it. Add `showSkippedFiles=true` to see skipped paths.

**Shared Snowpipe facts**
- **Load metadata**: each pipe remembers files for **14 days** (bulk loads keep 64 days on the table). A staged file with the same path and name is ignored in that window, even if changed or previously failed. After expiry it loads again and can duplicate data. Truncating the table does not clear it. Neither method sees the other's history, except `ALTER PIPE ... REFRESH`, which checks both.
- File size: about **100 to 250 MB compressed**. If data accumulates slowly, create a file about once per minute. Smaller files more often don't guarantee lower latency.
- Order and latency are **not guaranteed**. "Typically within a minute."
- The `COPY INTO` in a pipe can't use `FILES`, `VALIDATION_MODE`, `FORCE`, `LOAD_UNCERTAIN_FILES`, `ON_ERROR = ABORT_STATEMENT`, `PURGE`, `RETURN_FAILED_ONLY` or `SIZE_LIMIT`. A pipe can't load from **user stages or temporary stages**. Changing a pipe means recreating it, which drops its load metadata.
- Transformations: simple `SELECT` (reorder, omit, cast, `METADATA$` columns). No joins, aggregations or filters. `MATCH_BY_COLUMN_NAME` can't combine with a `SELECT` transformation.
- Default `ON_ERROR = SKIP_FILE` (bulk default is `ABORT_STATEMENT`). Snowpipe splits or combines a file's rows into transactions by size, while a bulk `COPY` is one transaction.
- Don't use `CURRENT_TIMESTAMP` or `SYSDATE` to record load time (values can be hours earlier than the commit). Use `ROW_TIMESTAMP = TRUE` on the table (see 1.3).
- Privileges: create a pipe needs `CREATE PIPE` on the schema, `USAGE` on database and schema, `USAGE` (external) or `READ` (internal) on the stage, `USAGE` on a named file format, `INSERT` on the table. Pause, resume and refresh need `OPERATE` on the pipe.
- **Billing**: a fixed number of credits **per GB**, no warehouse time, no per-file fee. Text files (CSV, JSON, XML) are billed on **uncompressed** size. Binary files (Avro, ORC, Parquet) on **size in storage**. Example from the page: 200 GB gzip CSV (1,000 GB uncompressed) plus 100 GB Parquet is 1,100 billed GB, which at 0.0037 credits per GB is 4.07 credits per day. Check `PIPE_USAGE_HISTORY` (Account Usage view, 365 days, up to 3 hours behind, columns `CREDITS_USED` and `BYTES_BILLED`). The table function covers 14 days and is deprecated in favor of the view. Snowsight shows the service as `PIPE`. The model moved from compute time plus a per-1,000-files fee to credits per GB on Aug 1, 2025 for Business Critical and VPS and on Dec 8, 2025 for Standard and Enterprise.

[Back to contents](#contents)

### 1.4.21 Snowpipe Streaming and the Kafka connector

| | Snowpipe | Snowpipe Streaming (high-performance) | Kafka connector v4 |
|---|----------|--------------------------------------|--------------------|
| Source | Files in a stage | Rows from the SDK or REST API (no files) | Kafka topics |
| Starts when | Event notification or REST call | Continuously, as rows are sent | Continuously (built on Snowpipe Streaming) |
| Latency | Typically within a minute of notice | As low as **5 seconds** | **5 to 10 seconds** |
| Throughput | n/a | Up to **20 GB/s per table** | Up to **10 GB/s per table** |
| Compute | Serverless | Serverless | Serverless ingest, connector runs in **your Kafka Connect cluster** |
| Billing | Credits per GB (text uncompressed, binary observed size) | Credits per **uncompressed GB** ingested | Same as Snowpipe Streaming |

Use Snowpipe when the pipeline already produces files and minutes are acceptable. Use Snowpipe Streaming when rows arrive from applications, devices or services and you need low latency.

**Snowpipe Streaming (high-performance architecture)**
- Rows go into a **channel** that carries them through a **PIPE object** to the target table. The pipe defines in-flight transformations (`COPY`-style syntax), column mapping, **pre-clustering** and schema validation. A **default pipe** simplifies setup. Targets: standard tables and Snowflake-managed **Iceberg** tables (v2 and v3, including partitioned).
- Connect with the **Java SDK** (Java 11+), **Python SDK** (3.9+), **Node.js SDK** (20+), the **REST API** (lightweight, IoT, edge), or the Kafka connector. SDKs buffer and batch automatically. Prefer an SDK over direct REST. REST clients send newline-delimited JSON. The SDK uses UTC.
- **Auth**: RSA key pair (JWT), OAuth, personal access token (OAuth and PAT need SDK 1.4.0 or later).
- Also supports schema evolution, error logging for rejected rows, and event table telemetry.

| Channel type | Elastic Channels | Named Channels |
|--------------|------------------|----------------|
| Choose when | No ordering or exactly-once needed. The recommended start for most new apps | You need per-channel ordering or exactly-once from producer to table |
| Channel handling | One implicit channel per pipe (`ELASTIC`). Snowflake manages scaling. Many producers append concurrently | Your app opens and reuses channels by name, typically one per source partition |
| Delivery | **At-least-once.** A retry after an ambiguous failure can duplicate. No ordering | **Exactly-once and ordered within a channel** using **offset tokens**. Replay from the last committed offset |
| Progress tracking | Per-append durable acknowledgement (append tokens) | Committed offset tokens |
| Use cases | IoT, telemetry, logs where duplicates are tolerable | CDC, billing, inventory, **Kafka partitions** |

- An acknowledgement means the data is **durably buffered**, not yet queryable. Neither mode makes unsent in-memory producer data crash-durable.
- **Limits**: `ON_ERROR` supports **only `CONTINUE`**. Turn on error logging on the table to capture failed rows. Up to **2,000 active Named Channels per pipe** by default. **50,000 pipes per account** and **10 pipes per table**. A Named Channel defaults to **20 MB/s**, **10 requests per second** and a **4 MB** REST payload (hard cap, so compress with Gzip or ZSTD). A throughput spike can briefly raise latency while the service scales.
- Time functions (`CURRENT_TIMESTAMP` and similar, including column defaults) are evaluated when the pipe's copy statement is **compiled**, not per row. Use row timestamps to record commit time.
- **Billing**: credits per uncompressed GB of input bytes received (data values only, not JSON keys). Find it in `ACCOUNT_USAGE.METERING_HISTORY` with `service_type = 'SNOWPIPE_STREAMING'`, joined to `PIPES`. The **classic** architecture billed on serverless compute and active client connections, so the model changed.

**Kafka connector** (details in 1.5)
- A sink connector that runs in a **Kafka Connect cluster**, reads topics, and writes to Snowflake tables. One topic usually maps to one table. Packages: **Confluent** (zip, Confluent Hub) and **OSS Apache Kafka**.
- **v4** is built on the high-performance Snowpipe Streaming architecture: PIPE objects, server-side schema validation, error tables, in-flight transformations and pre-clustering, with exactly-once, ordered delivery. v4 is not yet a fully managed Confluent Cloud connector. Install it as a custom plugin.
- **v3 and earlier** choose a backend with `snowflake.ingestion.method`: `SNOWPIPE` (default) or `SNOWPIPE_STREAMING` (needs connector 2.0.0 or later). Snowflake recommends v4 for new work, with no immediate change needed for existing workloads.
- Default table schema (v3, or v4 with `snowflake.enable.schematization=false`. v4 defaults to schematized columns, see 1.5.4): `RECORD_CONTENT` (VARIANT, the message) and `RECORD_METADATA` (VARIANT: topic, partition, offset, timestamps, key). A table you create can have more columns, but they must allow `NULL`. Without a mapping the connector creates a table per topic. Lowercase topic names become uppercase, and illegal characters become `_`.
- v3 streaming buffer properties: `buffer.flush.time` (default 10 s, minimum 1), `buffer.count.records` (default 10,000), `buffer.size.bytes` (default 20 MB), `snowflake.streaming.max.client.lag` (1 to 600 s).
- The Kafka connector only **loads** data into Snowflake.

[Back to contents](#contents)

### 1.4.22 UDFs and stored procedures

**UDF kinds**

| Kind | Returns |
|------|---------|
| Scalar UDF | One value per input row |
| UDAF (aggregate) | One value over many rows (Python) |
| UDTF | A table per input row |
| Vectorized UDF or UDTF | Takes batches as pandas DataFrames (Python) |

Handler languages for UDFs: **Java, JavaScript, Python, Scala, SQL**. Create them in SQL, with the **Snowpark** API, or with the CLI. Snowflake Scripting also works for SQL UDFs.

**`CREATE FUNCTION` options**
- `SECURE`: makes it a secure UDF (secure UDFs are covered in [Domain 5, 5.1.8](../domain_5/d5-udfs-concept.md#518-secure-udfs)). `TEMP`: lasts for the session.
- `CALLED ON NULL INPUT` (default) calls the UDF with nulls. `RETURNS NULL ON NULL INPUT` or `STRICT` returns `NULL` without calling it. **`STRICT` isn't supported for SQL UDFs.** They always use `CALLED ON NULL INPUT`, so handle nulls yourself.
- `VOLATILE` (**default**) may return different values for the same input. `IMMUTABLE` promises the same result for the same inputs. **Snowflake doesn't check this.** A wrong `IMMUTABLE` gives undefined behavior. Aggregate functions can't be `IMMUTABLE`.
- `NOT NULL` isn't enforced for SQL UDFs.
- Volatility matters for dynamic tables (1.4.16). UDFs are not allowed in MVs (1.4.18).

*Examples follow the documented syntax and were not run in Snowflake.*

**Examples**

```sql
-- SQL scalar UDF. The handler is in-line and LANGUAGE defaults to SQL.
CREATE OR REPLACE FUNCTION area_of_circle(radius FLOAT)
  RETURNS FLOAT
AS
$$
  pi() * radius * radius
$$;

SELECT area_of_circle(2.0);   -- 12.566370614359172

-- SQL UDFs always use CALLED ON NULL INPUT, so handle NULL in the body.
CREATE OR REPLACE FUNCTION safe_ratio(a NUMBER, b NUMBER)
  RETURNS NUMBER
AS
$$
  IFF(a IS NULL OR b IS NULL OR b = 0, NULL, a / b)
$$;

-- Python UDF with the create-time options. Null handling and volatility
-- come after LANGUAGE and before RUNTIME_VERSION.
CREATE OR REPLACE SECURE FUNCTION add_one(i NUMBER)
  RETURNS NUMBER
  LANGUAGE PYTHON
  RETURNS NULL ON NULL INPUT      -- same as STRICT. Not allowed for SQL UDFs
  IMMUTABLE                       -- a promise. Snowflake doesn't check it
  RUNTIME_VERSION = '3.12'
  HANDLER = 'add_one_py'
AS
$$
def add_one_py(i):
    return i + 1
$$;

SELECT add_one(NULL);             -- NULL, and the handler is not called
```

**Stored procedure versus UDF**

| | Stored procedure | UDF |
|---|------------------|-----|
| Purpose | Run SQL, often DDL or DML or admin work | Compute and return a value |
| Return | Optional (implicitly `NULL`). `RETURNS` is still required in `CREATE` | Always returns a value |
| Use in SQL | `CALL proc(...)` as its own statement. Tabular results via `SELECT * FROM TABLE(proc(...))` | Anywhere an expression is allowed, per row or group |
| Per statement | One procedure per `CALL` | Many UDFs in one statement |
| Languages | Java, JavaScript, Python, Scala, Snowflake Scripting | Java, JavaScript, Python, Scala, SQL |
| Use value in SQL | Not directly. Capture inside a Scripting block, or use `RESULT_SCAN` | Directly |

- Procedures run with **owner's rights by default**, or **caller's rights** if declared at creation. A caller's rights procedure can read the caller's session and uses the caller's privileges. Switch with `ALTER PROCEDURE`. A procedure can't run with both.
- Pick a procedure for DML and DDL (cleanup, `UPDATE`) and a UDF for per-row calculation.
- UDF depth for transformation (secure UDFs, Snowpark UDFs) is covered in [Domain 5, section 5.1](../domain_5/d5-udfs-concept.md#51-define-user-defined-functions-udfs-and-outline-how-to-use-them) of the study guide. This section covers only the pipeline angle.

[Back to contents](#contents)

### 1.4.23 SQL API

The SQL API is a REST API (`/api/v2/statements`) for running SQL from custom apps. It handles queries and most DDL and DML. Operations: submit, check status, cancel, fetch results concurrently.

| Item | Detail |
|------|--------|
| Submit | `POST /api/v2/statements`. Body: `statement`, `timeout`, `database`, `schema`, `warehouse`, `role`, `bindings` |
| Omitted context | Falls back to the user's `DEFAULT_WAREHOUSE`, `DEFAULT_NAMESPACE`, `DEFAULT_ROLE` |
| Names | `warehouse`, `database`, `schema`, `role` are **case-sensitive** and must match `SHOW` output (uppercase for unquoted identifiers) |
| Timeout | `timeout` field in seconds, else `STATEMENT_TIMEOUT_IN_SECONDS` |
| Bind variables | `?` placeholders with a `bindings` object (`FIXED`, `REAL`, `TEXT`, `BINARY`, `BOOLEAN`, `DATE`, `TIME`, `TIMESTAMP_*`). **Values are strings.** `DATE` is epoch milliseconds, time and timestamps are epoch nanoseconds. **Not supported in multi-statement requests** |
| Multiple statements | Separate with `;`. Each gets its own handle in `statementHandles` |
| Async | `async=true`. Not guaranteed synchronous without it, so code must handle async |
| Status | `202` means not finished (or async). Poll `GET /api/v2/statements/{statementHandle}`. `422` is a statement error. `429` is too many requests, so **retry with backoff**. Cancel with `POST /api/v2/statements/{handle}/cancel` |
| Results | Returned in **partitions**. Snowflake sets their count and size. Fetch more with `?partition=N`. `resultSetMetaData.partitionInfo` lists them |
| Safe resubmit | Send a UUID as `requestId` and add `retry=true` on resubmission, so an already-successful statement isn't run twice |
| `AUTOCOMMIT` | Must be `TRUE` for the statement or request, whatever the user or account setting |
| Network | The endpoint is covered by **network policies** |
| Billing | Fetching some results uses cloud services |

**Not supported**: `PUT` and `GET`. Supported **only in multi-statement requests**: `BEGIN`, `COMMIT`, `ROLLBACK`, `USE`, `ALTER SESSION`, session variables and temporary tables or stages. Python and Java/Scala procedures that return a `resultset` in Arrow format fail, even when called indirectly through an outer SQL procedure.

Authentication in the examples is a JWT from key-pair authentication. The authentication page was not read.

The SQL API is separate from the **Snowpipe REST API** (`/v1/data/pipes/...`), which only queues staged files.

[Back to contents](#contents)

### 1.4.24 Openflow

Openflow is a Snowflake integration service built on **Apache NiFi**. It moves data between any source and destination, in batch or streaming mode, for structured and unstructured data. Snowpipe's own docs point to Openflow when the source is a **database or SaaS application** rather than files.

| Item | Detail |
|------|--------|
| Deployment types | **Snowflake Deployments** (on Snowpark Container Services) and **BYOC** (Bring Your Own Cloud: the data plane runs in your cloud, Snowflake manages the control plane) |
| Generations | New deployments are **gen 2** (SQL-first management of deployments, runtimes and connectors). Gen 2 connector configuration is in public preview |
| Use cases | Unstructured sources (Google Drive, Box) for AI use, **CDC** from database tables, Apache Kafka events, SaaS platforms, custom flows with NiFi processors and controller services |
| Auth | **Snowflake Managed Token** is the default and recommended method (`SNOWFLAKE_MANAGED` authentication strategy). Short-lived, auto-refreshed, no key pairs to store. BYOC can use key pairs instead |
| Privileges | `ACCOUNTADMIN` grants the privileges needed to create deployments and runtimes |
| Security | TLS in transit, Snowflake secrets (BYOC also AWS Secrets Manager and HashiCorp Vault), PrivateLink (BYOC inbound) or outbound private connectivity (Snowflake deployments), Tri-Secret Secure for writes |
| Availability | Not enabled by default in trial accounts. Not available in the People's Republic of China |

[Back to contents](#contents)

### 1.4.25 Notebooks and Snowflake Scripting in pipelines

**Notebooks**
- A notebook is an interactive cell-based environment (Python, SQL, Markdown) in Snowsight. The original notebooks are now called **Legacy Notebooks**. **Notebooks in Workspaces** is the next generation. New accounts created after April 2026 can't create Legacy Notebooks.
- Runtimes: **Warehouse Runtime** (kernel on the notebook warehouse) and **Container Runtime** (kernel on a compute pool node). SQL and Snowpark queries always run on the warehouse.
- **Scheduling a notebook creates a task.** The task is owned by the notebook owner role and uses the notebook warehouse. It runs the notebook non-interactively, cell by cell. Defaults to auto-suspend after **10 failures**. The warehouse stays up until **15 minutes after** the task finishes.
- Privileges to schedule: account `EXECUTE TASK`, `USAGE` on the database, and `USAGE` plus `CREATE TASK` on the schema.
- Pass arguments as `key1=value1 key2=value2 --option2` and read them with `sys.argv`.
- `EXECUTE NOTEBOOK nb('arg1', ...)` runs a notebook outside the editor, from a worksheet, stored procedure, task or an external orchestrator. It needs `OWNERSHIP` on the notebook and a `QUERY_WAREHOUSE` set with `ALTER NOTEBOOK`. Arguments are **strings only** (other types become `NULL`). Python cells run on the compute pool for the runtime, while SQL and Snowpark queries run on the warehouse.
- **A task with `EXECUTE AS USER` can't run `EXECUTE NOTEBOOK`.** Creation succeeds without an error and the **run fails**.
- Study guide wording: "use Notebooks to run pipelines of stored procedures for data ingestion tasks". The pages I read show notebooks running as scheduled tasks and via `EXECUTE NOTEBOOK`. None showed a notebook calling stored procedures, though SQL cells run SQL.

**Snowflake Scripting**
- A procedural extension to SQL. Use it in stored procedures, in SQL UDFs, in anonymous blocks, and as the body of a task.
- Block structure: `DECLARE` (optional: variables, cursors, `RESULTSET`s, exceptions), `BEGIN ... END` (required), `EXCEPTION` (optional).
- `BEGIN` also starts a transaction, so use `BEGIN TRANSACTION` for transactions to avoid confusion.
- In Snowflake CLI, the Classic Console and the Python connector (`execute_string`, `execute_stream`), wrap a block in `EXECUTE IMMEDIATE $$ ... $$`.
- Constructs: variables, `IF` and `CASE`, loops (`FOR`, `WHILE`, `REPEAT`, `LOOP`), cursors, `RESULTSET`s, exceptions, `SQLID` for the last query ID and DML row counts.
- **Exceptions**: declare with `my_ex EXCEPTION (-20002, 'message')`, raise with `RAISE`. Built-ins: `STATEMENT_ERROR` and `EXPRESSION_ERROR`. An unhandled exception goes to the enclosing block and then to the client as an error. Handlers are `EXIT` (run the handler, leave the block) or `CONTINUE` (continue after the failing statement). `SQLCODE` and `SQLERRM` give the code and message.
- Objects created inside a block remain after it ends.

[Back to contents](#contents)

### 1.4.26 Quick-reference for continuous pipelines

| Scenario | Answer |
|----------|--------|
| Declarative multi-step SQL pipeline | Dynamic tables, intermediates on `TARGET_LAG = DOWNSTREAM` |
| Minimum dynamic table lag | 60 seconds |
| Downstream DT fresher than upstream | Invalid. Downstream lag must be at least the upstream lag |
| Upstream DT is `DOWNSTREAM` and nothing reads it | Never refreshes, no warning |
| Query uses `EXCEPT`, `LIMIT` or `CONNECT BY` | Not incremental. Set `REFRESH_MODE = FULL` |
| Occasional `INSERT OVERWRITE` on the source | `ADAPTIVE` |
| Verify what `AUTO` chose | `SHOW DYNAMIC TABLES`, `refresh_mode`, `refresh_mode_reason` |
| Change refresh mode | `CREATE OR REPLACE` or `CREATE OR ALTER`, never `ALTER` |
| DT stopped refreshing after errors | Auto-suspended after 5 consecutive scheduled failures. Fix, then `RESUME` |
| DT suspended longer than source retention | Recreate it |
| Let dbt or Airflow own refresh | `SCHEDULER = DISABLE` |
| Cloud Services cost on an idle DT | Lengthen the lag |
| Speed up repeated aggregate on one table, always current | Materialized view (Enterprise) |
| Join or window function in the query | Not an MV. Use a DT or a view |
| MV on a table whose column was dropped | Recreate with `COPY GRANTS` |
| MV maintenance cost control | Fewer MVs, batch base-table DML. Resource monitors don't apply |
| Files land in S3, GCS or Azure | Snowpipe auto-ingest |
| Storage can't send events, S3-compatible storage, or app decides when | Snowpipe REST API |
| `insertFiles` returned 200 | Queued, not loaded. Check `insertReport` |
| Rows or events, seconds of latency | Snowpipe Streaming |
| Needs ordering and exactly-once | Named Channels with offset tokens |
| Telemetry where duplicates are fine | Elastic Channels |
| Kafka topics, low latency | Kafka connector v4 (Snowpipe Streaming architecture) |
| Database or SaaS source | Openflow connector |
| Per-row calculation used in `SELECT` | UDF |
| DML or admin routine | Stored procedure (owner's rights by default) |
| Run SQL from an app over HTTPS | SQL API, `POST /api/v2/statements` |
| Statement still running in the SQL API | `202`, poll with the handle |
| Run a notebook on a schedule | Snowsight schedule creates a task. Or `EXECUTE NOTEBOOK` in your own task |

[Back to contents](#contents)

### 1.4 Continuous pipelines: open items and flags

- **Refresh-mode wording conflicts.** The refresh-modes page says that when `AUTO` resolves to FULL the `CREATE` result message says why. The cost page has a heading "AUTO mode selects full refresh without a warning", and the comparison table says it "silently" resolves. I recommend checking `SHOW DYNAMIC TABLES` either way.
- **`AUTO` changed.** Current pages say new `AUTO` tables resolve to ADAPTIVE or FULL. Older tables resolved to INCREMENTAL or FULL. A practice question written against older material may expect INCREMENTAL.
- **ADAPTIVE example typo.** The text mentions `large_init_wh`, the SQL uses `transform_wh_xl`.
- **"No schema changes after creation."** The `CREATE DYNAMIC TABLE` usage notes say this, but `CREATE OR ALTER` supports adding, dropping and renaming trailing columns. Likely means `ALTER` can't change columns. Not explained on the pages.
- **`SCHEDULER = ENABLE` and `TARGET_LAG`.** The `CREATE DYNAMIC TABLE` text says "Required when `SCHEDULER = ENABLE`" right after the `DOWNSTREAM` description. It most likely means `TARGET_LAG` is required with the scheduler on. The page doesn't say, so I did not state a rule.
- **Not read**: dynamic table `modify`, `data-consistency`, `frozen-regions`, `refresh-optimization`, `privileges`, `best-practices` and `error-codes` pages, and the `ALTER DYNAMIC TABLE` reference. Change-tracking rules for DTs are therefore not covered.
- **Materialized views.** `CREATE MATERIALIZED VIEW` has an `INTERACTIVE` keyword that I did not read about. The MV page lists "cannot query a non-materialized view" and also "only a single table". Both are stated as limits.
- **Snowpipe REST.** The `insertFiles` size field and the `loadHistoryScan` parameters are only partly covered. I did not fetch the REST API reference page.
- **Snowpipe cost rate.** The 0.0037 credits per GB figure is the page's example from a Dec 2025 release note. Check the consumption table for the current rate.
- **Snowpipe Streaming.** Classic architecture pages (overview, billing, best practices) and the PIPE object, access control, error table and event table telemetry pages were not read. The Kafka v3 details come from the classic-streaming Kafka page.
- **Kafka.** Throughput differs by page: 20 GB/s per table for Snowpipe Streaming, 10 GB/s per table for connector v4. They describe different products. Full connector setup belongs to 1.5.
- **SQL API.** The authentication page, multi-statement page and reference were not read. Rate or size limits are not given on the pages read.
- **Openflow.** The overview says the platform deploys "in customers' own VPCs in both AWS and SPCS", while the availability notes list Snowflake Deployments on AWS, Azure and GCP and BYOC on AWS only. Gen 1 versus gen 2 differences were not read.
- **Notebooks.** `EXECUTE NOTEBOOK` access control mentions `QUERY_WAREHOUSE`, while its usage notes mention `RUNTIME` and `WAREHOUSE` parameters. The page is inconsistent. The `notebooks-tasks` page returned nothing.
- **UDFs and Scripting depth.** UDF and Scripting topics also appear in Domain 5 of the study guide, so deeper coverage (Snowpark UDFs, secure UDF details) is in [Domain 5, 5.1](../domain_5/d5-udfs-concept.md#51-define-user-defined-functions-udfs-and-outline-how-to-use-them). Scripting cursors and loops are left for Domain 5, 5.3.
- **Unfetched pages**: `tasks-events`, `tasks-errors`, task graph object (also open in [d1-streams-and-tasks-concept.md](d1-streams-and-tasks-concept.md)).
