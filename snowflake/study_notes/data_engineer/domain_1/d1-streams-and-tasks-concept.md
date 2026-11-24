# Domain 1: Data Movement, streams and tasks (SnowPro Advanced: Data Engineer, DEA-C02)

Weight: **28%**. Domain 1 notes are split across five files: [d1-data-loading-and-ingestion-concept.md](d1-data-loading-and-ingestion-concept.md) (1.1 to 1.3: loading and ingestion); this file, 1.4.1 to 1.4.12: streams and tasks; [d1-continuous-pipelines-concept.md](d1-continuous-pipelines-concept.md) (1.4.13 to 1.4.26: dynamic tables, Snowpipe and developer tools); [d1-connectors-concept.md](d1-connectors-concept.md) (1.5: connectors); [d1-sharing-and-tables-concept.md](d1-sharing-and-tables-concept.md) (1.6 to 1.7: sharing and tables). A section is added only after it is approved. The contents table below lists only the sections in this file.

## Contents

| Section | Topic | Status |
|---------|-------|--------|
| 1.4 | [Design, build and troubleshoot continuous data pipelines: streams and tasks (1.4.1 to 1.4.12)](#14-design-build-and-troubleshoot-continuous-data-pipelines-streams-and-tasks) | Approved |

---

## 1.4 Design, build and troubleshoot continuous data pipelines: streams and tasks

This section is split across two files. This file covers streams and tasks (1.4.1 to 1.4.12). Dynamic tables, materialized views, Snowpipe (auto-ingest versus REST API), Snowpipe Streaming versus the Kafka connector, UDFs, the SQL API, Openflow, notebooks and Snowflake Scripting (1.4.13 to 1.4.26) are in [d1-continuous-pipelines-concept.md](d1-continuous-pipelines-concept.md). Stages in pipelines are covered in 1.2 (directory tables with streams and triggered tasks are in 1.4.3 and 1.4.8).

**Sections in 1.4 (streams and tasks)**

- [1.4.1 How the pieces fit](#141-how-the-pieces-fit)
- [1.4.2 Streams: offset, columns and consumption](#142-streams-offset-columns-and-consumption)
- [1.4.3 Stream types and what they support](#143-stream-types-and-what-they-support)
- [1.4.4 CREATE STREAM syntax and privileges](#144-create-stream-syntax-and-privileges)
- [1.4.5 Stream staleness](#145-stream-staleness)
- [1.4.6 Streams on views, change tracking and CHANGES](#146-streams-on-views-change-tracking-and-changes)
- [1.4.7 Tasks: compute and schedule](#147-tasks-compute-and-schedule)
- [1.4.8 Triggered tasks](#148-triggered-tasks)
- [1.4.9 Task graphs](#149-task-graphs)
- [1.4.10 Task failures, retries, privileges and monitoring](#1410-task-failures-retries-privileges-and-monitoring)
- [1.4.11 Troubleshooting streams and tasks](#1411-troubleshooting-streams-and-tasks)
- [1.4.12 Quick-reference for streams and tasks](#1412-quick-reference-for-streams-and-tasks)
- [1.4 Streams and tasks: open items and flags](#14-streams-and-tasks-open-items-and-flags)

### 1.4.1 How the pieces fit

- A **stream** records the row-level changes (CDC) to a source object between two points in time. A **task** runs a SQL statement or stored procedure on a schedule or on a trigger.
- Together: a task reads a stream, transforms the new or changed rows, and skips the run when the stream is empty (`SYSTEM$STREAM_HAS_DATA` in `WHEN`).
- Other pieces of a continuous pipeline: continuous loading (Snowpipe, Snowpipe Streaming, Kafka connector) and continuous transformation (dynamic tables). Those are in [d1-continuous-pipelines-concept.md](d1-continuous-pipelines-concept.md).

[Back to contents](#contents)

### 1.4.2 Streams: offset, columns and consumption

A stream **stores no table data**, only an **offset** on the source object. It reads change records from the source's version history plus hidden change-tracking columns.

- Creating the first stream on a table adds hidden columns to it. They use a small amount of storage.
- A new table version is created on every committed transaction that contains DML.
- Querying a stream returns changes from the offset up to the **current** version (or the start of the current transaction).
- **The offset moves only when the stream is used in a DML statement** (`INSERT`, `MERGE`, `CTAS`, `COPY INTO <location>`), in autocommit or an explicit transaction. A plain `SELECT` doesn't move it, even inside an explicit transaction.
- Many queries can read the same change data without moving the offset.

**Ways to advance the offset without using the changes**
- `CREATE OR REPLACE STREAM`.
- `INSERT INTO temp_table SELECT * FROM stream WHERE 0 = 1` (or `CREATE TEMPORARY TABLE _unused AS SELECT * FROM my_stream WHERE 1=0`).

**Transactions**
- Streams use **repeatable read** isolation. Every statement in a transaction sees the same set of stream records. Tables use read committed.
- A stream queried in an explicit transaction is read as of the **transaction start**.
- A DML statement that reads a stream consumes **all** of its records if the transaction commits. If it rolls back, the offset stays.
- To make several statements see the same records, wrap them in `BEGIN ... COMMIT`. Using the stream in DML locks it.
- Changes committed to the source by other transactions in the meantime appear only after the first transaction commits.

**Metadata columns** (output also has the source columns)

| Column | Meaning |
|--------|---------|
| `METADATA$ACTION` | `INSERT` or `DELETE` |
| `METADATA$ISUPDATE` | `TRUE` if the row is part of an `UPDATE`. An update appears as a **`DELETE` plus `INSERT` pair**, both with `ISUPDATE = TRUE` |
| `METADATA$ROW_ID` | Unique, immutable row ID. May change if change tracking is disabled and re-enabled on the source |

- A stream shows the **net** difference between two offsets. A row inserted then updated before consumption appears as one `INSERT` with `ISUPDATE = FALSE`. A row inserted then deleted before consumption doesn't appear (standard stream).
- A stream uses the **current** table schema. An incompatible schema change between the offset and the next advance can make queries fail. After adding `NOT NULL` to a column, stream queries can fail if historical rows contain NULL.

**One consumer per stream.** If two tasks or scripts read the same stream, the first to commit takes the data. Create **one stream per consumer**. Streams are cheap because they store only an offset.

[Back to contents](#contents)

### 1.4.3 Stream types and what they support

| Type | Created with | Records | Source objects |
|------|--------------|---------|----------------|
| **Standard** (delta) | default | Inserts, updates, deletes, and truncates. Joins inserted and deleted rows to produce the net row-level delta | Standard tables, dynamic tables, Snowflake-managed Iceberg tables, externally managed V3 Iceberg tables, directory tables, views |
| **Append-only** | `APPEND_ONLY = TRUE` | **Inserts only**. Updates, deletes and truncates are not recorded | Standard tables, dynamic tables, Snowflake-managed Iceberg tables, views |
| **Insert-only** | `INSERT_ONLY = TRUE` | Inserts only. A file removed from cloud storage isn't recorded as a delete | External tables and externally managed Iceberg tables (**required** there). Delta Direct tables without partition columns |

- Append-only is **faster** than standard for ELT that only needs inserts. The source can be truncated right after consumption without adding cost to the next query.
- Standard streams **can't return change data for geospatial data**. Use append-only.
- Streams can be created on: standard tables (including shared), views (including secure), directory tables, dynamic tables, Iceberg tables (with limits), event tables, external tables.
- Not supported: streams on a **materialized view**, and on partitioned external tables.
- Iceberg limits: no standard or append-only streams on **V2 Iceberg tables using an external catalog** (insert-only works). No append-only on **V3** externally cataloged tables. Append-only streams on Snowflake-managed V2/V3 Iceberg tables can't be consumed if an external engine made the changes.
- The `APPEND_ONLY` option is documented only for standard tables and for views over standard tables. Creating an append-only stream in a target account on a **secondary (replicated)** object isn't supported.

[Back to contents](#contents)

### 1.4.4 CREATE STREAM syntax and privileges

```sql
CREATE [ OR REPLACE ] STREAM [ IF NOT EXISTS ] my_stream
  [ COPY GRANTS ]
  ON TABLE my_table                       -- or VIEW, EXTERNAL TABLE, STAGE, DYNAMIC TABLE, EVENT TABLE
  [ { AT | BEFORE } ( TIMESTAMP => ts | OFFSET => n | STATEMENT => id | STREAM => 'other_stream' ) ]
  [ APPEND_ONLY = TRUE | FALSE ]          -- default FALSE
  [ SHOW_INITIAL_ROWS = TRUE | FALSE ]    -- default FALSE
  [ COMMENT = '...' ];
```

| Option | Detail |
|--------|--------|
| `ON STAGE` | Stream on a **directory table** (the stage name, not the table) |
| `SHOW_INITIAL_ROWS = TRUE` | The first consumption returns the rows that existed at creation (with `ISUPDATE = FALSE`), then normal changes. Use it to **initialize** a downstream table |
| `AT / BEFORE` | Creates the stream at a past point using **Time Travel**. Fails if no change-tracking data exists then |
| `AT (STREAM => 'name')` | New stream starts at the **same offset** as another. With `OR REPLACE` it keeps the current offset when you recreate a stream |
| `COPY GRANTS` | Keeps privileges (except `OWNERSHIP`) on `OR REPLACE` or `CLONE` |
| `CLONE` | The clone inherits the source stream's current offset. If a database or schema containing a stream **and** its source table is cloned, unconsumed records in the stream clone are **inaccessible** |
| `CREATE OR ALTER STREAM` | Only a `COMMENT` change is supported |
| Streams have no Time Travel and no Fail-safe | A dropped stream can't be recovered |

**Privileges**
- Create: `CREATE STREAM` on the schema, plus `SELECT` on the source (stage: `USAGE` on external, `READ` on internal). Plus at least one privilege on the parent database and schema.
- **If change tracking isn't yet enabled on the table, only the table owner can create the first stream.** Creating it enables change tracking.
- Query a stream: `USAGE` on database and schema, `SELECT` on the stream, and `SELECT` on the source table or view.

**Billing**: no charge for the object. Costs are warehouse time to query it, and extra **storage** from the extended retention described next.

[Back to contents](#contents)

### 1.4.5 Stream staleness

A stream is **stale** when its offset is older than the source's Time Travel retention (plus extension). Stale streams can't be read, and unconsumed changes are lost. Fix: **recreate the stream** with `CREATE STREAM`.

- Snowflake **extends the data retention period** of the source when a stream hasn't been consumed, to the stream's offset, up to `MAX_DATA_EXTENSION_TIME_IN_DAYS` (default **14**), regardless of edition. If retention is already longer than that, no extension. Extension costs storage.
- Consume within the larger of `DATA_RETENTION_TIME_IN_DAYS` and `MAX_DATA_EXTENSION_TIME_IN_DAYS`:

| `DATA_RETENTION_TIME_IN_DAYS` | `MAX_DATA_EXTENSION_TIME_IN_DAYS` | Consume within |
|-------------------------------|-----------------------------------|----------------|
| 14 | 0 | 14 days |
| 1 | 14 | 14 days |
| 0 | 90 | 90 days |

- `SHOW STREAMS` or `DESCRIBE STREAM` show `STALE` and `STALE_AFTER`. After `STALE_AFTER` the stream can go stale at any moment. Reads may still work for a while but are not reliable. Consuming moves `STALE_AFTER` forward.
- Calling `SYSTEM$STREAM_HAS_DATA` prevents staleness **only if the stream is empty and the function returns `FALSE`**.
- A stream goes stale when the source is **recreated** (`CREATE OR REPLACE TABLE` drops its history), or when any underlying table of a source view is recreated or dropped.
- Renaming the source doesn't break the stream. Dropping the source and creating a new object with the same name does **not** relink the stream.
- On **shared** tables or views, a stream doesn't extend the provider's retention.
- Reclustering and some other writes produce no change data.

[Back to contents](#contents)

### 1.4.6 Streams on views, change tracking and CHANGES

**Change tracking**
- Needed for streams on views, and for `CHANGES` queries. Set `CHANGE_TRACKING = TRUE` on `CREATE` or `ALTER` of a **table or view**. It adds hidden columns.
- Only the **owner** can enable it. If the view and its underlying tables have different owners, each owner must enable it on its object. Otherwise the statement fails.
- Enabling it locks the table briefly, which can delay DML.
- Creating a stream on a view as the owner of the view enables change tracking on the view, and on the tables if the same role owns them.
- A **data provider must enable change tracking** on shared tables or secure views before consumers can create streams on them.

**Streams on views: requirements**
- Allowed in the view: projections, filters, **inner or cross joins**, `UNION ALL`. Nested views and `FROM` subqueries are fine if the expanded query qualifies.
- Not allowed: `GROUP BY`, `QUALIFY`, `LIMIT`, `DISTINCT`, correlated subqueries, subqueries outside `FROM`. Select-list functions must be system-defined scalar functions.
- Views over external tables or directory tables are not supported. Local and shared (including secure) views are supported.
- Join result: changes on the left table are joined with the current right table, changes on the right with the current left, and changes on both are joined with each other.
- `SYSTEM$STREAM_HAS_DATA` on a view stream compares the **underlying tables**, so false positives rise as the view gets more selective.

**CHANGES clause (read-only alternative)**
```sql
SELECT * FROM t
  CHANGES (INFORMATION => { DEFAULT | APPEND_ONLY })
  AT ( TIMESTAMP => ts | OFFSET => -n | STATEMENT => id | STREAM => 'name' ) | BEFORE ( STATEMENT => id )
  [ END ( TIMESTAMP => ts | OFFSET => -n | STATEMENT => id ) ];
```
- `DEFAULT` returns the net delta of inserts, updates and deletes. `APPEND_ONLY` returns inserted rows only and skips the join, so it's faster.
- `AT | BEFORE` is **required**. Without `END`, the interval ends now, and `END` is inclusive. `STREAM => 'name'` uses that stream's current offset as the start.
- **Not supported** on directory tables or external tables. For views, the same limits as streams on views apply.
- Queries change-tracking metadata between two points, **never advances an offset**, and needs a start point (`AT | BEFORE`). Needs change tracking enabled or a stream on the table. No data exists for the period before that.
- Use a stream for normal CDC pipelines. Use `CHANGES` when you need to manage the interval yourself.

[Back to contents](#contents)

### 1.4.7 Tasks: compute and schedule

A task runs **one** SQL statement, a call to a stored procedure, or a Snowflake Scripting block. Procedures can be SQL, JavaScript, Python, Java or Scala. Tasks are created **suspended**. Run `ALTER TASK ... RESUME` to start the schedule, or `EXECUTE TASK` for a single run.

**Compute models**

| | Serverless | User-managed warehouse |
|---|-----------|------------------------|
| Choose by | Omit `WAREHOUSE` | Set `WAREHOUSE = wh` |
| Sizing | Snowflake predicts from recent runs. Max size is **XXLARGE** | You size and share it |
| Bounds | `SERVERLESS_TASK_MIN_STATEMENT_SIZE` (default `XSMALL`), `SERVERLESS_TASK_MAX_STATEMENT_SIZE` (default `XXLARGE`) | n/a |
| First runs | `USER_TASK_MANAGED_INITIAL_WAREHOUSE_SIZE` (default **MEDIUM**). Ignored after a few successful runs. Setting it with `WAREHOUSE` is an error. Changing it after the first run has no effect | n/a |
| Billing | Actual compute used | Warehouse billing, 60-second minimum per resume |
| Best for | Stable, short tasks, under-used warehouses, tight schedule adherence. Snowflake adds resources if a run exceeds the interval | Busy warehouses with concurrent tasks, unpredictable loads, workloads larger than XXLARGE |
| Privilege | Account `EXECUTE MANAGED TASK` | `USAGE` on the warehouse |

- `TARGET_COMPLETION_INTERVAL = '120 MINUTE'` tells serverless compute to finish within that window. Range: 10 to 86400 seconds, 1 to 1440 minutes, or 1 to 24 hours. It is **ignored once the task is at maximum size**. **Required** for serverless **triggered** tasks.
- Serverless sizing history is kept across suspend and resume. It is removed only when the task is recreated with `CREATE OR REPLACE`.

**Schedules**
- `SCHEDULE = '60 MINUTES'` (interval, also `HOURS` or `SECONDS`) or `SCHEDULE = 'USING CRON <expr> <timezone>'`. Cron fields: minute, hour, day of month (1-31 or `L`), month, day of week (0-6, `SUN`-`SAT`, or `L`). A subset of standard cron.
- **Only a standalone or root task has a schedule.** Child tasks (`AFTER`) can't.
- No schedule and not triggered: the task runs only through `EXECUTE TASK`.
- **Only one run of a scheduled task at a time.** If a run overlaps the next scheduled time, that scheduled time is **skipped**.
- Task runs use the **owner's privileges** by default (system user). `EXECUTE AS USER` changes this.

**Timeouts**
- `USER_TASK_TIMEOUT_MS`: default **3,600,000** (1 hour), range 0 to 604,800,000 (7 days). `0` means the maximum is enforced.
- With `STATEMENT_TIMEOUT_IN_SECONDS` also set, the **lowest non-zero** value wins. With `STATEMENT_QUEUED_TIMEOUT_IN_SECONDS`, `USER_TASK_TIMEOUT_MS` wins.
- On a graph, a root-level value applies to the whole graph. A child or finalizer value applies to that task and **overrides** the root.

**Session parameters**: a task accepts any session parameter in its definition (`TIMESTAMP_INPUT_FORMAT = ...`). Account and user parameters are not supported. `AUTOCOMMIT = FALSE` and a `SEARCH_PATH` setting are not supported. If `AUTOCOMMIT` is `FALSE` at account level, set it to `TRUE` on the task or its DML fails.

**CREATE OR REPLACE TASK**: the new task is **suspended**, the next scheduled run of a standalone or root task is cancelled, and an ongoing run completes. Cancel a running one with `SYSTEM$USER_TASK_CANCEL_ONGOING_EXECUTIONS` (before replacing) or `SYSTEM$CANCEL_QUERY` (after).

**Versioning**: a task runs with the version current when it was last resumed or executed. Editing needs a suspend first. A run in progress finishes on its old version. History is in `TASK_VERSIONS` (Account Usage). A stored procedure's body isn't versioned with the task.

[Back to contents](#contents)

### 1.4.8 Triggered tasks

Run a task when a stream has data, with no polling. No compute is used until the event.

```sql
CREATE TASK my_triggered_task
  TARGET_COMPLETION_INTERVAL = '15 MINUTES'          -- serverless: required
  WHEN SYSTEM$STREAM_HAS_DATA('my_order_stream')     -- no SCHEDULE
  AS INSERT INTO customer_activity SELECT customer_id, order_total FROM my_order_stream;
```

- Define the stream with `WHEN`. **Don't set `SCHEDULE`.** For a user-managed one, add `WAREHOUSE`. For serverless, omit `WAREHOUSE` and set `TARGET_COMPLETION_INTERVAL`.
- Supported sources: tables, views, dynamic tables, Iceberg tables (managed and unmanaged), data shares, directory tables. A directory table must be **refreshed** (auto-refresh or `ALTER STAGE ... REFRESH`) before the task can see changes.
- **Not supported:** hybrid tables, and streams on external tables.
- Combine conditions: `OR` runs when either stream has data. `AND` runs only when both do.
- **Scheduled plus condition**: `SCHEDULE = '1 HOUR' WHEN SYSTEM$STREAM_HAS_DATA(...)` checks hourly and skips when empty.

**Behavior**
- When first resumed, it checks for changes since the last run. If none, it skips with no compute.
- While running, new changes wait. **Only one instance runs at a time**. After finishing, it checks again.
- Minimum interval between triggered runs: **30 seconds** by default. `USER_TASK_MINIMUM_TRIGGER_INTERVAL_IN_SECONDS` ranges from **10** to 604800.
- A **health check** runs if the task hasn't run for **12 hours**, to keep the stream from going stale. Timing isn't guaranteed. The task must still consume the stream before retention ends.
- For streams on **views**, a change to *any* table the view references triggers the task, regardless of joins, filters or aggregates.
- Monitoring: `SCHEDULE` shows `NULL` in `SHOW TASKS` and `DESC TASK`. `TASK_HISTORY` shows `SCHEDULED_FROM = TRIGGER`.

**Migrate scheduled to triggered**: `ALTER TASK t SUSPEND; ALTER TASK t UNSET SCHEDULE; ALTER TASK t MODIFY WHEN SYSTEM$STREAM_HAS_DATA('s'); ALTER TASK t RESUME;`
**Migrate user-managed triggered to serverless**: suspend, `UNSET WAREHOUSE`, set `TARGET_COMPLETION_INTERVAL`, resume.

**`SYSTEM$STREAM_HAS_DATA`**
- Syntax: `SYSTEM$STREAM_HAS_DATA('db.schema.stream')`. Quote case-sensitive names with double quotes inside the single quotes. Intended for the task `WHEN` clause.
- Avoids **false negatives** but can return **false positives** (rows inserted and deleted back to the original state). It compares table version metadata.
- **If it returns `TRUE`, consume the stream, even for a false positive.** Otherwise it keeps returning `TRUE`, the `WHEN` clause never skips, and the warehouse runs for nothing. For a false positive, run `CREATE TEMPORARY TABLE _unused AS SELECT * FROM my_stream WHERE 1=0;`.

[Back to contents](#contents)

### 1.4.9 Task graphs

A **task graph** (DAG) is a root task plus child tasks linked by `AFTER`, with no loops.

```sql
CREATE TASK task_root SCHEDULE = '1 MINUTE' AS SELECT 1;
CREATE TASK task_a AFTER task_root AS SELECT 1;
CREATE TASK task_b AFTER task_root AS SELECT 1;           -- runs in parallel with task_a
CREATE TASK task_c AFTER task_a, task_b AS SELECT 1;      -- waits for both
CREATE TASK task_finalizer FINALIZE = task_root AS SELECT 1;
```

| Rule | Detail |
|------|--------|
| Limits | **1000** tasks per graph (suspended or resumed). **100** parents and **100** children per task. **30,000** resumed tasks per account |
| Ownership | All tasks must have the **same owner**, in the **same database and schema** |
| Schedule | Only on the root. Children use `AFTER` |
| Parallelism | Children of one parent run in parallel. A task with several parents waits for all of them |
| Compute | Each task chooses serverless or a warehouse separately. Parallel tasks on one warehouse need it sized for the concurrency |
| Finalizer | One per root, runs after all tasks finish **or fail**, for cleanup or notifications. Can't have children. Not started if the root was skipped (for example, overlap) |
| Break dependencies | `ALTER TASK ... REMOVE AFTER`, `UNSET FINALIZE`. `DROP TASK` and **transferring ownership of one task** sever all its links |

**Running a graph**
- Test: resume each child task to include (and the finalizer), then `EXECUTE TASK root;`. Add `AWAIT` to wait for the whole graph. Suspended children are skipped.
- Production: resume every child and then the root, or `SELECT SYSTEM$TASK_DEPENDENTS_ENABLE('root')` to resume all at once.
- List tasks: `TASK_DEPENDENTS` table function.
- **Modify** a task: suspend the **root** first. Children keep their state, so on resume only the root needs `RESUME`, or call `SYSTEM$TASK_DEPENDENTS_ENABLE`. A run in progress finishes.
- **Skip a child**: suspend it. The graph runs as if it succeeded. A child with several parents runs if at least one parent is resumed and all resumed parents succeeded.
- The graph version is set when the root is resumed or executed. Changing any task needs the root suspended.

**Overlap**: `OVERLAP_POLICY` on the **root** (replaces the deprecated `ALLOW_OVERLAPPING_EXECUTION`, where `TRUE` maps to `ALLOW_CHILD_OVERLAP`):

| Value | Behavior |
|-------|----------|
| `NO_OVERLAP` (default) | Next root run starts only after the whole graph finishes. Runs may be skipped if the graph is slower than the schedule |
| `ALLOW_CHILD_OVERLAP` | A new graph run can start while children are still running. The root never overlaps |
| `ALLOW_ALL_OVERLAP` | Several full graph runs, including the root, at once |

**Passing data in a graph**
- `SYSTEM$SET_RETURN_VALUE('x')` in a task and `SYSTEM$GET_PREDECESSOR_RETURN_VALUE('TASK_NAME')` in a child. With several predecessors you must name one. Names are **case-sensitive** and unquoted names are stored uppercase, so use `'TASK_C'`.
- `CONFIG = '{"key": "value"}'` on the **root**, read by any task with `SYSTEM$GET_TASK_GRAPH_CONFIG('key')`. `EXECUTE TASK root USING CONFIG = '...'` overrides it for one run.
- A child `WHEN` can use `SYSTEM$GET_PREDECESSOR_RETURN_VALUE` and `SYSTEM$STREAM_HAS_DATA`. If a task's `WHEN` is false, the task is skipped and so are its successors (unless advanced branching is in use).

**Advanced branching** (public preview, available to all accounts)
- By default a child runs only if **all** predecessors succeed. A failed parent means children never appear in task history.
- Use `WHEN SYSTEM$PREDECESSORS_STATE('ALL_SUCCEEDED' | 'AT_LEAST_ONE_FAILED' | 'ALL_FAILED' | 'ALL_DONE' | 'NONE_FAILED_MIN_ONE_SUCCEEDED' ...)` or `SYSTEM$TASK_COMPLETION_STATE('task')` (`SUCCEEDED`, `FAILED`, `SKIPPED`) for fallback or error paths. A task waits for **all resumed** predecessors to finish before evaluating.
- A graph using either function runs **every task** (skipped ones show `SKIPPED`), so there are more history rows and a small cloud services charge for each `WHEN` evaluation.
- Retry starts from the **earliest failed tasks** and reevaluates successors across attempts.
- I only saw some of the condition names, not the full list.

[Back to contents](#contents)

### 1.4.10 Task failures, retries, privileges and monitoring

**Failure handling**

| Setting | Detail |
|---------|--------|
| `SUSPEND_TASK_AFTER_NUM_FAILURES` | Default **10**. `0` disables. Counts consecutive runs that **fail or time out** (not skipped, cancelled or system errors). On a graph, set it on the **root**. Can also be set on schema, database or account |
| `TASK_AUTO_RETRY_ATTEMPTS` | Default `0` (off), max **30**. On the root, a failed child retries the **whole graph** immediately. Each retry sends an error notification |
| `EXECUTE TASK ... RETRY LAST` | Reruns from the last failed task(s) in the latest graph run, as a new run with attempt number plus one |
| `EXECUTE TASK ... RETRY GRAPH RUN GROUP '<id>'` | Retries an older run by `GRAPH_RUN_GROUP_ID` |
| `ERROR_INTEGRATION`, `SUCCESS_INTEGRATION` | Notification integrations for SNS, Event Grid or Pub/Sub |
| `LOG_LEVEL` | Task events go to the active event table at this level or more severe |

**Privileges**
- Create: `CREATE TASK` on the schema, `USAGE` on database and schema, `USAGE` on the warehouse (user-managed), `EXECUTE MANAGED TASK` on the account (serverless).
- Run (owner role): account `EXECUTE TASK`, `USAGE` on database, schema and **task**, warehouse `USAGE` if used, plus rights for the SQL itself. **Revoking `EXECUTE TASK` stops all of that role's tasks.**
- `ALTER TASK ... RESUME` checks the owner's privileges. Resume and suspend need task `OPERATE` (or ownership) plus `USAGE` on database and schema.
- `EXECUTE TASK` needs `OWNERSHIP` or `OPERATE`.
- View history: `ACCOUNTADMIN`, task `OWNERSHIP`, or account `MONITOR EXECUTION`.
- Granting a task's ownership to a new role (individually) severs graph links. Transfer all tasks in the schema together to keep them.

**Monitoring**
- `TASK_HISTORY` table function (Information Schema) and `SNOWFLAKE.ACCOUNT_USAGE.TASK_HISTORY`. Queue time is `QUERY_START_TIME - SCHEDULED_TIME`. Run time is `COMPLETED_TIME - QUERY_START_TIME`.
- `CURRENT_TASK_GRAPHS` (running or scheduled graphs). `COMPLETE_TASK_GRAPHS` function (last **60 minutes**) and Account Usage view. Graph duration is `COMPLETED_TIME - SCHEDULED_TIME`.
- Serverless cost: `SERVERLESS_TASK_HISTORY` function or view. Also `METERING_HISTORY` with `service_type` `SERVERLESS_TASK`.

[Back to contents](#contents)

### 1.4.11 Troubleshooting streams and tasks

**Task did not run**
1. `TASK_HISTORY`: did it run? Check scheduled and completed times and the error. A run can succeed while its SQL failed.
2. Is it **resumed**? New tasks are `SUSPENDED`. Check `SHOW TASKS`. In a graph check every task. Verify at least one scheduled time has passed.
3. Owner privileges: `EXECUTE TASK`, `USAGE` on database, schema and warehouse, `OWNERSHIP` on the task.
4. `WHEN`: did the stream hold data at the scheduled time? Check history with `AT | BEFORE`.
5. Predecessors: a failed parent means the child is **skipped**.

**Task timed out**: default **60 minutes**. Likely an undersized warehouse. Raise the warehouse size or `ALTER TASK ... SET USER_TASK_TIMEOUT_MS`. `SHOW PARAMETERS LIKE 'USER_TASK_TIMEOUT_MS' IN TASK t` returns nothing when the default applies. A bigger warehouse or longer timeout won't help if the SQL parallelizes poorly.

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Stream returns nothing, source has changes | Append-only stream and the changes were updates or deletes. Or stale. Or another consumer already consumed it | Check stream type, `STALE`, and other tasks reading it |
| Stream query fails after a schema change | Incompatible change between the offset and the advance (the docs state the failure, not a fix) | Not documented on the pages read. Recreating the stream is the usual way to reset the offset |
| Stream is stale | Not consumed within retention, or source recreated | `CREATE OR REPLACE STREAM`. Unconsumed changes are lost |
| Triggered task runs every time and uses the warehouse | `SYSTEM$STREAM_HAS_DATA` is true but nothing consumes the stream | Consume it with DML on every run |
| Two tasks get different rows | Shared stream | One stream per consumer |
| Cannot create stream on a view | Change tracking off and you aren't the owner of the view and its tables. Or view has `GROUP BY`, `DISTINCT`, `LIMIT` and similar | Owner enables `CHANGE_TRACKING`. Simplify the view |
| Consumer can't create stream on shared data | Provider hasn't enabled change tracking | Provider runs `ALTER ... SET CHANGE_TRACKING = TRUE` |
| Graph stopped scheduling | Suspended after consecutive failures (default 10) | Fix, then `RESUME` |
| Run skipped, graph slower than schedule | `NO_OVERLAP` | Lengthen the schedule, add compute, or set `OVERLAP_POLICY` only if overlap is safe |
| Edit on a graph fails | Root is still resumed | Suspend the root first |
| `GET_PREDECESSOR_RETURN_VALUE` returns nothing | Task name case | Use uppercase name or quotes |
| After ownership transfer a child no longer runs | Single-task transfer severed links | Rebuild with `ALTER TASK ... ADD AFTER` |

[Back to contents](#contents)

### 1.4.12 Quick-reference for streams and tasks

| Scenario | Answer |
|----------|--------|
| Need only new rows, source gets truncated after load | Append-only stream |
| Stream on an external table | `INSERT_ONLY = TRUE` (required) |
| Several consumers of one table's changes | One stream each |
| Process changes only when present, no polling | Triggered task with `WHEN SYSTEM$STREAM_HAS_DATA` |
| Serverless triggered task | `TARGET_COMPLETION_INTERVAL` required, no `WAREHOUSE` |
| Check hourly, run only if data | `SCHEDULE = '1 HOUR'` plus `WHEN SYSTEM$STREAM_HAS_DATA` |
| Update in source appears how in a stream | `DELETE` + `INSERT`, both `ISUPDATE = TRUE` |
| Stream offset moves when | Used in DML that commits, not on `SELECT` |
| Same data across several statements | `BEGIN ... COMMIT` (repeatable read) |
| Initialize a target with existing rows | `SHOW_INITIAL_ROWS = TRUE` |
| Keep the offset when recreating a stream | `CREATE OR REPLACE STREAM s ON TABLE t AT (STREAM => 's')` |
| Stale stream | Recreate it. Consume before `STALE_AFTER` |
| Run a graph once | `EXECUTE TASK root` (children resumed) |
| Resume a graph | `SYSTEM$TASK_DEPENDENTS_ENABLE('root')` |
| Cleanup after a graph regardless of failure | Finalizer task |
| Fallback path after a failed parent | Advanced branching with `SYSTEM$PREDECESSORS_STATE` |
| Retry only the failed part | `EXECUTE TASK ... RETRY LAST` |
| Task suspended itself | `SUSPEND_TASK_AFTER_NUM_FAILURES` (default 10) |

[Back to contents](#contents)

### 1.4 Streams and tasks: open items and flags

- **Docs inconsistency on `EXECUTE MANAGED TASK`.** "Introduction to tasks" says the role that runs a task needs it in the user-managed example too, but the privilege tables say it is **required only for serverless tasks**. I followed the tables.
- **Stream `STALE_AFTER` wording.** The streams page says it adds the larger of retention or extension to the last consumption time. The "Manage streams" page says "to the current timestamp". I used the first.
- I did not fetch the task error notification pages (`tasks-errors`), the full list of `SYSTEM$PREDECESSORS_STATE` conditions, `ALTER TASK` details, or `TASK_HISTORY` column lists.
- **Snowflake Scripting, stored procedures called from tasks, and notebooks** are not covered here. They are in [d1-continuous-pipelines-concept.md](d1-continuous-pipelines-concept.md).
- "Task graph as an object" (`TASK GRAPH` declared object) appears on the graphs page. I did not read it.
