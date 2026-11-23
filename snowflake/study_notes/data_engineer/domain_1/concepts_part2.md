# Domain 1: Data Movement, part 2 (SnowPro Advanced: Data Engineer, DEA-C02)

Weight: **28%**. These notes cover Domain 1 sections 1.1 to 1.7 and are divided into three parts. Part 1 is [concepts_part1.md](concepts_part1.md) (1.1 to 1.3). Part 2 (this file) covers 1.4 and 1.5. Part 3 is [concepts_part3.md](concepts_part3.md) (1.6 and 1.7). A section is added only after it is approved. The contents table below lists only the sections in this file.

## Contents

| Section | Topic | Status |
|---------|-------|--------|
| 1.4 | [Design, build and troubleshoot continuous data pipelines](#14-design-build-and-troubleshoot-continuous-data-pipelines) | Approved |
| 1.5 | [Install, configure and use connectors](#15-install-configure-and-use-connectors) | Approved |

---

## 1.4 Design, build and troubleshoot continuous data pipelines

This section is split in two. **Part A** covers streams and tasks. **Part B** (after the Part A open items) covers dynamic tables, materialized views, Snowpipe (auto-ingest versus REST API), Snowpipe Streaming versus the Kafka connector, UDFs, the SQL API, Openflow, notebooks and Snowflake Scripting. Stages in pipelines are covered in 1.2 (directory tables with streams and triggered tasks are in 1.4.3 and 1.4.8).

**Sections in 1.4 Part A**

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
- [1.4.12 Quick-reference for Part A](#1412-quick-reference-for-part-a)
- [1.4 Part A open items and flags](#14-part-a-open-items-and-flags)

### 1.4.1 How the pieces fit

- A **stream** records the row-level changes (CDC) to a source object between two points in time. A **task** runs a SQL statement or stored procedure on a schedule or on a trigger.
- Together: a task reads a stream, transforms the new or changed rows, and skips the run when the stream is empty (`SYSTEM$STREAM_HAS_DATA` in `WHEN`).
- Other pieces of a continuous pipeline: continuous loading (Snowpipe, Snowpipe Streaming, Kafka connector) and continuous transformation (dynamic tables). Those are in Part B.

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

### 1.4.12 Quick-reference for Part A

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

### 1.4 Part A open items and flags

- **Docs inconsistency on `EXECUTE MANAGED TASK`.** "Introduction to tasks" says the role that runs a task needs it in the user-managed example too, but the privilege tables say it is **required only for serverless tasks**. I followed the tables.
- **Stream `STALE_AFTER` wording.** The streams page says it adds the larger of retention or extension to the last consumption time. The "Manage streams" page says "to the current timestamp". I used the first.
- I did not fetch the task error notification pages (`tasks-errors`), the full list of `SYSTEM$PREDECESSORS_STATE` conditions, `ALTER TASK` details, or `TASK_HISTORY` column lists.
- **Snowflake Scripting, stored procedures called from tasks, and notebooks** are not covered here. They are in Part B.
- "Task graph as an object" (`TASK GRAPH` declared object) appears on the graphs page. I did not read it.

---

### 1.4 Part B: dynamic tables, materialized views, Snowpipe, streaming and developer tools

**Sections in 1.4 Part B**

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
- [1.4.26 Quick-reference for Part B](#1426-quick-reference-for-part-b)
- [1.4 Part B open items and flags](#14-part-b-open-items-and-flags)

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
- `SECURE`: makes it a secure UDF (the secure UDF page was not read). `TEMP`: lasts for the session.
- `CALLED ON NULL INPUT` (default) calls the UDF with nulls. `RETURNS NULL ON NULL INPUT` or `STRICT` returns `NULL` without calling it. **`STRICT` isn't supported for SQL UDFs.** They always use `CALLED ON NULL INPUT`, so handle nulls yourself.
- `VOLATILE` (**default**) may return different values for the same input. `IMMUTABLE` promises the same result for the same inputs. **Snowflake doesn't check this.** A wrong `IMMUTABLE` gives undefined behavior. Aggregate functions can't be `IMMUTABLE`.
- `NOT NULL` isn't enforced for SQL UDFs.
- Volatility matters for dynamic tables (1.4.16). UDFs are not allowed in MVs (1.4.18).

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
- UDF depth for transformation (secure UDFs, Snowpark UDFs) is also in Domain 3 of the study guide. This section covers only the pipeline angle.

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

### 1.4.26 Quick-reference for Part B

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

### 1.4 Part B open items and flags

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
- **UDFs and Scripting depth.** UDF and Scripting topics also appear in other domains of the study guide, so deeper coverage (Snowpark UDFs, secure UDF details, cursors and loops) is left for those domains.
- **Unfetched pages**: `tasks-events`, `tasks-errors`, task graph object (also open in Part A).

---

## 1.5 Install, configure and use connectors

The study guide lists four connector families: Kafka, Spark, Python and native connectors. This section covers each. The Kafka connector summary in 1.4.21 is the short version. This is the full version.

**Sections in 1.5**

- [1.5.1 Which connector for which job](#151-which-connector-for-which-job)
- [1.5.2 Kafka connector: versions and architecture](#152-kafka-connector-versions-and-architecture)
- [1.5.3 Kafka connector v4: Snowflake setup and properties](#153-kafka-connector-v4-snowflake-setup-and-properties)
- [1.5.4 Kafka connector v4: tables, pipes, validation and errors](#154-kafka-connector-v4-tables-pipes-validation-and-errors)
- [1.5.5 Kafka connector v3 (classic)](#155-kafka-connector-v3-classic)
- [1.5.6 Kafka connector: migration and troubleshooting](#156-kafka-connector-migration-and-troubleshooting)
- [1.5.7 Spark connector](#157-spark-connector)
- [1.5.8 Python connector](#158-python-connector)
- [1.5.9 Native connectors](#159-native-connectors)
- [1.5.10 Quick-reference for 1.5](#1510-quick-reference-for-15)
- [1.5 open items and flags](#15-open-items-and-flags)

### 1.5.1 Which connector for which job

| Source or client | Use | Direction | Notes |
|------------------|-----|-----------|-------|
| Apache Kafka topics | Kafka connector (v4 recommended) | Kafka to Snowflake only | Runs in your Kafka Connect cluster |
| Apache Spark (self-hosted, EMR, Databricks, Qubole) | Spark connector | Both directions | Query pushdown from Spark into Snowflake |
| A Python application | Python connector | Both | PEP 249 `Connection` and `Cursor` |
| MySQL or PostgreSQL | Native App connector with an agent (preview), or the Openflow connector (the stated successor) | Source to Snowflake | CDC replication |
| ServiceNow | Native App connector | Source to Snowflake | The page calls it generally available |
| Google Analytics 4 | Native App connectors (aggregate or raw) | Source to Snowflake | See 1.5.9 |
| SharePoint | Native App connector (preview), or the Openflow connector | Source to Snowflake | Files and permissions, Cortex Search |

The Kafka connector only loads data into Snowflake. The Spark connector's alternatives, per the pages: Snowpark (work stays inside Snowflake, all operations push down, including Snowflake UDFs) and Snowpark Connect for Spark.

[Back to contents](#contents)

### 1.5.2 Kafka connector: versions and architecture

**Release series**

| Series | Status | Notes |
|--------|--------|-------|
| 4.x | Generally available | Latest. Migration from 3.x and 2.x is manual |
| 3.x | Officially supported | Upgrade to v4 recommended |
| 2.x | Officially supported | Upgrade recommended |
| 1.x | Not supported | |

**Packages.** Confluent (zip from Confluent Hub or the Snowflake package repository, includes dependencies) and OSS Apache Kafka (fat JAR from Maven Central, needs **Bouncy Castle** JARs downloaded separately to use an encrypted private key). v4 is **not** a fully managed Confluent Cloud connector. On Confluent Cloud, install it as a custom plugin. The v3 overview page says a hosted version exists on Confluent Cloud.

**Connector classes**

| | Class |
|--|-------|
| v4 | `com.snowflake.kafka.connector.SnowflakeStreamingSinkConnector` |
| v3 and earlier | `com.snowflake.kafka.connector.SnowflakeSinkConnector` |

**Ingestion paths**

| | v3 Snowpipe mode (default) | v3 Snowpipe Streaming mode | v4 |
|--|----------------------------|-----------------------------|----|
| Set by | `snowflake.ingestion.method=SNOWPIPE` | `SNOWFLAKE_STREAMING` (connector 2.0.0 or later) | Always high-performance Snowpipe Streaming |
| Path | Files to an internal stage, then Snowpipe | Rows via the classic Streaming API | Rows via channels and a PIPE object |
| Delivery | Deduplication, no ordering guarantee | Exactly-once | Exactly-once and ordered |
| Latency | Higher (file-based) | Lower than Snowpipe | 5 to 10 seconds, up to 10 GB/s per table |
| Billing | Snowpipe serverless | Serverless compute and client connections (classic) | Flat price per ingested GB |

**Runtime requirements (both versions)**
- Supported packages: Apache Kafka 2.0.0 or higher in the connector table (tested 2.8.2, 3.7.2, and 4.1.1 on the v4 page) and Confluent (tested 6.2.15, 7.8.2, and 8.2.0 on the v4 page). Built for Kafka Connect API 3.9.0. Older Connect versions work. Newer ones are untested.
- The JDBC driver version must match the `snowflake-jdbc` version in the connector's `pom.xml`.
- At least **5 MB of RAM per Kafka partition** on each Connect node.
- Run Kafka Connect in the **same cloud provider and region** as the Snowflake account. This is a strong recommendation, not a requirement.
- Avro needs the Avro parser 1.8.2 or later. Avro with a schema registry needs Kafka Connect Avro Converter 5.0.0 or later. The schema registry feature is not in the OSS package.
- v4 uses a Rust Snowpipe Streaming SDK that allocates off-heap memory. Limit the JVM heap to about **50% of RAM** (for 8 GB, `-Xmx4g`).

[Back to contents](#contents)

### 1.5.3 Kafka connector v4: Snowflake setup and properties

**Privileges.** Give them directly to the connector role. They cannot be inherited through a role hierarchy. Snowflake recommends a separate user and role per Kafka instance.

| Object | Privilege | When |
|--------|-----------|------|
| Database | `USAGE` | Always |
| Schema | `USAGE` | Always |
| Schema | `CREATE TABLE` | The connector auto-creates tables |
| Schema | `CREATE PIPE` | The connector auto-creates pipes (default pipe mode) |
| Schema | `CREATE VIEW` | Recommended for future Error Table features |
| Pipe | `OPERATE` | User-defined pipes |
| Destination table | `INSERT` | Always |

v3 needed more: `CREATE STAGE`, plus `OWNERSHIP` on an existing target table, plus `READ` and `WRITE` on an existing internal stage (see 1.5.5).

**Authentication** (`snowflake.authenticator`)

| Value | Method | Since | Notes |
|-------|--------|-------|-------|
| `snowflake_jwt` (default) | Key pair | | RSA 2048-bit minimum. Public key set on the user with `ALTER USER ... SET RSA_PUBLIC_KEY` (`SECURITYADMIN` or higher) |
| `oauth` | Snowflake OAuth or External OAuth | 4.1.0 | `snowflake.oauth.client.id`, `.client.secret`, `.refresh.token`, `.token.endpoint`. An empty refresh token means the `client_credentials` grant. The token endpoint defaults to the account URL. No `snowflake.private.key` needed |
| `spcs` | Workload identity inside Snowpark Container Services | 4.2.0 | `snowflake.role.name` not required from 4.3.0. The service owner's role is used |

- Private key: key only, no header or footer, no line breaks. Set `snowflake.private.key.passphrase` **if and only if** the key is encrypted. Snowflake recommends externalizing secrets with a Kafka Connect `ConfigProvider` (AWS KMS, Azure Key Vault, HashiCorp Vault).
- v3 uses key pair. External OAuth in v3 works with Snowpipe Streaming mode only.

**Minimal v4 configuration** (distributed mode JSON, `config` block)

```json
{
  "connector.class": "com.snowflake.kafka.connector.SnowflakeStreamingSinkConnector",
  "topics": "my_topic",
  "snowflake.url.name": "https://myaccount.snowflakecomputing.com",
  "snowflake.user.name": "my_user",
  "snowflake.private.key": "<key>",
  "snowflake.database.name": "MY_DB",
  "snowflake.schema.name": "MY_SCHEMA",
  "snowflake.role.name": "MY_ROLE",
  "value.converter": "org.apache.kafka.connect.json.JsonConverter",
  "value.converter.schemas.enable": "false",
  "key.converter": "org.apache.kafka.connect.storage.StringConverter",
  "snowflake.streaming.validate.compatibility.with.classic": "false"
}
```

**Required properties:** `name` (unique across connectors, unquoted identifier), `connector.class`, `topics` **or** `topics.regex` (not both), `snowflake.url.name` (the account endpoint, not the discovered ingest host, a private endpoint DNS target or an IP), `snowflake.user.name`, `snowflake.role.name`, `snowflake.database.name`, `snowflake.schema.name`, `key.converter` (required by the platform, unused by the connector), `value.converter`. `header.converter` is required only for Avro with headers.

**Converters.** v4 supports community converters. With schematization on (the default), **`StringConverter` and `ByteArrayConverter` are not supported** as value converters. Use `JsonConverter`, `AvroConverter` or `ProtobufConverter`.

**Network and proxy**
- Complete the Snowpipe Streaming network prerequisites from **every** Connect worker. Private connectivity also needs private DNS for the **ingest hostname**, not only the account hostname. A common symptom is that table creation succeeds and streaming initialization fails with a DNS error on `get_pipe_info`.
- The Java side (JDBC) uses `jvm.proxy.*` or `KAFKA_OPTS`. The **native streaming SDK ignores those** and reads proxy environment variables set on the worker before the JVM starts. Restart the worker, not only the task, after changing them.

**Caching.** The connector caches table and pipe existence checks (`snowflake.cache.table.exists`, `snowflake.cache.pipe.exists`, **5 minutes by default**). For testing, set them to `false` so a table or pipe you just created is seen. Keep defaults in production.

[Back to contents](#contents)

### 1.5.4 Kafka connector v4: tables, pipes, validation and errors

**Table and pipe behavior**
- By default the connector **creates the table and a default pipe** named `{tableName}-STREAMING`. It maps the **first-level keys** of the record to columns by name, case-insensitively. Unmatched keys are ignored unless `ENABLE_SCHEMA_EVOLUTION` is on for the table.
- **User-defined pipe mode:** create a pipe with the **same name as the table**. The connector uses it. The pipe holds the transformation (casts, renames, masking, filters) as `COPY INTO ... FROM (SELECT ... FROM TABLE(DATA_SOURCE(TYPE => 'STREAMING')))`. `$1:RECORD_METADATA.<field>` is available in the pipe.
- **Default pipe mode:** no transformations. Record keys must match the column names.
- `RECORD_METADATA` fields include `topic`, `partition`, `offset`, `CreateTime`, `SnowflakeConnectorPushTime` (Snowpipe Streaming only), `key`, `schema_id` and `headers`. `snowflake.metadata.topic` and `snowflake.metadata.offset.and.partition` control some fields (default true).
- `snowflake.enable.schematization` defaults to **`true`** in v4 (columns per field). It was `false` in v3. With `false`, you get the two VARIANT columns `RECORD_CONTENT` and `RECORD_METADATA`, as in v3.

**Topic to table mapping**
- Without `snowflake.topic2table.map`, the table name derives from the topic name. See open items for conflicting text on case and sanitization.
- With `snowflake.topic2table.map` the format is `topic1:table1,topic2:table2`. Regex patterns are allowed and **cannot overlap**. Many topics can map to one table. Quote names to preserve case or use special characters. Table names need **at least 2 characters**.

**Validation modes** (`snowflake.validation`)

| | `server_side` (default) | `client_side` |
|--|-------------------------|---------------|
| Who validates | Snowflake backend, aligned with `COPY` and Snowpipe | The connector, before sending rows |
| Invalid records | Captured in the table's **Error Table** | Handled by `errors.tolerance`. Routed to a **DLQ** |
| DLQ use | Only for converter (deserialization) errors | For client-detected errors and converter errors |
| Pipe mode | Default pipe and user-defined pipe | **Default pipe only.** With a user-created pipe the connector fails with `ERROR_5030` |
| Throughput | Maximum (validation is offloaded) | Not maximum (validation runs in the connector) |
| New column types | Inferred from the JSON values. Registry precision can be lost. Binary becomes `VARCHAR` (base64). A string like `"2026-04-13"` can become `DATE` | From the converter's Connect schema when present. `FLOAT32`→`FLOAT`, `FLOAT64`→`DOUBLE`, bytes→`BINARY`, logical decimal→`VARCHAR`, struct and map→`VARIANT`, arrays→`ARRAY` |
| Iceberg | Supported, and required for `snowflake.autocreate.table.type=iceberg` | Only for a pre-created Iceberg v3 table with a compatible schema. Rejected with Iceberg auto-creation |

- Avro or Protobuf alone does **not** require client-side validation.
- Pre-create columns when you need exact types or precision in either mode.

**Schema evolution**
- Needs `ENABLE_SCHEMA_EVOLUTION=TRUE` on the table and the right privileges. Client-side evolution needs a direct `EVOLVE SCHEMA` or `OWNERSHIP` grant to the connector role. Choosing a mode alone does not turn evolution on.
- It can add top-level columns and drop `NOT NULL`. It does **not** widen existing column types and does not evolve fields inside structured columns.
- Existing column types are not corrected automatically. Avoid concurrent DDL on a table the connector is ingesting into.

**Errors**

| Property | Default | Meaning |
|----------|---------|---------|
| `errors.tolerance` | `none` | `none`: the task fails on the first error. `all`: continue, route to the DLQ if configured |
| `errors.deadletterqueue.topic.name` | empty (off) | Effective only with `client_side` validation **and** `errors.tolerance=all` |
| `errors.log.enable` | `false` | Log failed operation and record properties |
| `enable.task.fail.on.authorization.errors` | `false` | `true` fails the task on authorization errors. `false` retries |

- `errors.tolerance=all` with no DLQ **silently drops** invalid records (client-side). That risks data loss.
- With server-side validation and `none`, error detection is **asynchronous**, so a few records after the bad one can still be ingested before the task fails.

**Iceberg.** v4 loads Snowflake-managed Iceberg tables (v2 and v3). From 4.1.0, `snowflake.autocreate.table.type` is `snowflake` (default), `iceberg` or `none` (never auto-create, fail if the table is missing). `snowflake.iceberg.create.table.options` splices extra clauses into the auto-created table's `CREATE` statement. Do not include `CATALOG`, `ENABLE_SCHEMA_EVOLUTION` or `ERROR_LOGGING`.

[Back to contents](#contents)

### 1.5.5 Kafka connector v3 (classic)

**Objects the connector creates (Snowpipe mode)**

| Object | Count | Name pattern |
|--------|-------|--------------|
| Internal stage | One per topic | `SNOWFLAKE_KAFKA_CONNECTOR_..._STAGE_...`. Holds data files and **state** used to resume |
| Pipe | **One per topic partition** | `SNOWFLAKE_KAFKA_CONNECTOR_..._PIPE_...` |
| Table | One per topic, unless mapped | Topic name uppercased |

If the stage is dropped, the connector cannot resume where it left off.

**Table names without a mapping:** lowercase becomes uppercase. A first character that is not a letter or underscore gets an underscore prepended. Illegal characters become underscores. If two topics collapse to the same name (for example `numbers+x` and `numbers-x`), the connector adds a suffix.

**Flow (Snowpipe mode)**
1. The connector buffers messages per partition. A threshold (time, size or count) writes a file to the internal stage.
2. The connector calls Snowpipe to ingest it. A Snowflake-provided warehouse loads it through the partition's pipe.
3. The connector polls the `insertReport` API for **one hour**, deletes the file when loaded, and **moves it to the table stage** if the status was not found in that hour or the load failed.
4. A record Snowpipe cannot parse (for example malformed JSON or Avro) is not loaded. It goes to the table stage.

**Privileges (v3):** `USAGE` on the database, `USAGE`, `CREATE TABLE`, `CREATE STAGE`, `CREATE PIPE` on the schema (the `CREATE` privileges can be revoked once the objects exist), `OWNERSHIP` on an existing target table, `READ` and `WRITE` on an existing internal stage (not recommended). If the connector creates the table or stage, the user's **default role** owns it. Set the connector role as the user's default role.

**Buffer properties and defaults differ by ingestion method**

| Property | Snowpipe mode | Snowpipe Streaming mode |
|----------|---------------|--------------------------|
| `buffer.flush.time` | **120** s | **10** s (minimum 1) |
| `buffer.count.records` | 10,000 | 10,000 |
| `buffer.size.bytes` | 5,000,000 (5 MB) | 20,000,000 (20 MB) |

Records are compressed when written, so buffer size can exceed the file size.

**v3 Snowpipe Streaming mode specifics**
- `snowflake.ingestion.method=SNOWPIPE_STREAMING`, connector 2.0.0 or later. Snowflake converters are **not supported**. Use community converters.
- `snowflake.streaming.max.client.lag`: 1 to 600 s. Default 30 s (3.1.1 and later), 120 s (3.0.0 to 3.1.0), 1 s otherwise.
- `snowflake.streaming.enable.single.buffer`: default `true` from 3.0.0. When `true`, `buffer.flush.time` and `buffer.count.records` stop mattering.
- `enable.streaming.client.optimization` (2.1.2 and later, default `true`): one client for many partitions. Disable for high throughput (the page's example is about 50 MB/s per connector).
- **Exactly-once.** One channel per partition. Two offsets: the Kafka consumer offset and the Snowflake **offset token**. On open or reopen, the connector takes the **latest committed offset token as the source of truth** and resets the consumer offset. Only if the token is NULL does it trust Kafka's offset. A row is accepted only if its offset is the last processed offset plus one.
- **NULL records** (not tombstones) are dropped and leave missing offsets, which can break the connector. Use tombstone records.
- `behavior.on.null.values` (`DEFAULT` inserts an empty JSON string, `IGNORE` skips). Snowpipe mode: 1.5.5 and later. Streaming mode: 2.1.0 and later. Snowpipe mode uses Snowflake converters for this property. For Kafka community converters use `transforms` with `io.confluent.connect.transforms.TombstoneHandler`.
- Schematization: set `snowflake.ingestion.method` and `snowflake.enable.schematization` for schema detection and evolution.
- Channel name format: V1 `[topic]_[partition]` (all versions except 2.1.0 and 2.1.1). V2 `[connectorName]_[topic]_[partition]` (2.1.0 and 2.1.1 only). Relevant when migrating offsets.

**Converters (v3 Snowpipe mode)**

| Data | `value.converter` |
|------|-------------------|
| JSON | `com.snowflake.kafka.connector.records.SnowflakeJsonConverter` |
| Avro with Schema Registry | `com.snowflake.kafka.connector.records.SnowflakeAvroConverter` |
| Avro with embedded schema | `...SnowflakeAvroConverterWithoutSchemaRegistry` |
| Plain text | `org.apache.kafka.connect.storage.StringConverter` |

**Other v3 properties:** `tasks.max` (Snowflake recommends the total number of Kafka partitions, not above the CPU core count. More tasks raise memory use and rebalances). `snowflake.topic2table.map`. `snowflake.metadata.createtime`, `.topic`, `.offset.and.partition`, `.all` (default true, `false` omits fields). `snowflake.jdbc.map`. `jvm.proxy.*`. `snowflake.snowpipe.v2CleanerEnabled` and `snowflake.snowpipe.v2CleanerIntervalSeconds` (default 61 s, raise it to about 30 minutes for low volume, to save cost).

**Fault tolerance limits (v3)**
- Kafka's default retention is 7 days. If the connector is offline longer, expired records are lost.
- Changes or deletes of messages already in Kafka may not reach the table.
- Instances do not communicate. Two instances on the same topic or partition insert duplicates.
- Snowpipe mode gives no row-order guarantee.

**Managing and dropping:** find stages, pipes and tables with `SHOW` as the owning role (the user's default role), then `DROP`.

[Back to contents](#contents)

### 1.5.6 Kafka connector: migration and troubleshooting

**Migrating v3 to v4**
- v4 is a rewrite, **not a drop-in**. New connector class, different defaults, removed properties. Create a new configuration by hand.
- Pricing changes from serverless compute and file notifications to per-GB throughput pricing.
- Keep the **same connector name**. The name determines the Kafka consumer group (`connect-<name>`) that holds committed offsets. Kafka Connect allows one connector per name, even stopped, so a second create returns `409 Conflict`. Stop or delete the v3 connector, wait until the consumer group state is `Empty`, then start v4 with the same name.
- Deleting a connector does not delete its consumer group offsets. Raise `task.shutdown.graceful.timeout.ms` (a **worker** setting, 5 s by default) before migrating, or v4 reloads records the v3 task never committed.
- Migration from Snowpipe mode or Snowpipe Streaming mode works without gaps or duplicates if configured correctly. The switchover must happen within `offsets.retention.minutes` (default 7 days).
- Compatibility validator, on by default: `snowflake.streaming.validate.compatibility.with.classic=true`. At startup it requires these to be set explicitly: `snowflake.validation=client_side`, `snowflake.compatibility.enable.column.identifier.normalization=true`, `snowflake.compatibility.enable.autogenerated.table.name.sanitization=true`, `snowflake.enable.schematization` (default changed), `snowflake.streaming.classic.offset.migration`, and `...offset.migration.include.connector.name` (when migration is `strict` or `best_effort`). New installations set it to `false`.
- A bad setting shows as `FAILED` in `GET /connectors/<name>/status`, because v4 checks at start, not at submit.

| `snowflake.streaming.classic.offset.migration` | Behavior |
|----------------------------------------------|----------|
| `skip` (default) | No SSv1 offset migration. Use the Kafka consumer group offset. Use for v3 **Snowpipe** mode |
| `strict` | Resume from the v3 Streaming channel's committed offset. Fail if the channel is missing |
| `best_effort` | Try the channel. Fall back to the consumer group offset |

Before migrating, keep `snowflake.metadata.topic`, `.offset.and.partition` and `.createtime` enabled in v3 (they are by default), so `RECORD_METADATA` supports deduplication.

**Troubleshooting v3 (Snowpipe mode)**

1. Check the load history: `COPY_HISTORY` for the target table. `STATUS` shows loaded, partially loaded or failed. `FIRST_ERROR_MESSAGE` shows only the first error per file.
2. Look in the **table stage**: `LIST @db.schema.%mytable;`. Two file name patterns:
   - **Raw bytes** (`.../offset_<n>.gz` style): the record could not be converted from bytes to Avro, JSON or Protobuf. A dropped character from a network failure is a common cause. Fix: **resend the record** as a new record.
   - **Source format** (Avro, JSON or Protobuf): Snowpipe could not load it. Fix the file, then reload.
3. To see all errors in a failed file: `GET` the files from the table stage, `PUT` them to a named internal stage, run `COPY INTO ... VALIDATION_MODE = 'RETURN_ALL_ERRORS'` into a temporary table, fix the files, `PUT ... OVERWRITE = TRUE` them back, then `COPY INTO` the table with `PURGE = TRUE`.
4. If `COPY_HISTORY` has nothing, read the Kafka Connect log. Search for `ERROR` and `com.snowflake.kafka.connector`. Categories: configuration error, read error (Kafka not running, message not sent or expired), stage write error (privileges, out of space, dropped stage, unexpected files), table write error (privileges).
5. If the log is clean, check Kafka Connect itself.
- Set up **Snowpipe error notifications** for file errors.
- **Duplicate rows with the same partition and offset** (v1.4 and later): the load exceeded the default 300,000 ms (300 s) execution timeout, shown as `CommitFailedException ... group has already rebalanced`. Set `consumer.max.poll.interval.ms` to 900000 or `consumer.max.poll.records` to 50 in the Connect worker configuration.

**Troubleshooting v4**

| Symptom | Cause and action |
|---------|------------------|
| `rows_error_count` rising | With `errors.tolerance=none` the task fails with `ERROR_5030`. With `all` it continues and logs. Check the Error Table. Find gaps with `RECORD_METADATA` offsets. Server-side detection is asynchronous, so some extra rows load first |
| `ERROR_5030` | Type mismatch, a **user-created pipe with `client_side` validation**, or a schema change that cannot evolve. Switch to `server_side` or remove the pipe |
| Table created, streaming fails | Ingest hostname DNS from the worker. Configure private DNS |
| Auth failure (key pair) | Valid base64 PKCS#8 key with no header, footer or line breaks. Passphrase only if encrypted. Role privileges |
| SPCS auth error `395090` ("Please use OAuth") | The service spec is missing `capabilities.securityContext.enableCustomCredentials: true`. OAuth is not the fix |
| "Table does not exist" under SPCS auth | The service owner's role is used and lacks access. `snowflake.role.name` is overridden |
| Unsupported converter | `StringConverter` or `ByteArrayConverter` with schematization on |
| Startup failures about config | The compatibility validator. Set `...validate.compatibility.with.classic=false` for new installs |
| Lag growing | Raise `tasks.max` toward the partition count. About 2 tasks per CPU core is the page's optimum. Check `backpressure-rewind-count`. Keep heap near 50% of RAM |
| `channel-recovery-count` rising | Schema change conflicting with the cached schema, permission change, or unstable network |
| `sdk-client-count` above the table count | Possible SDK client leak. One client per distinct table. Contact Support |
| `409 Conflict` creating the connector | The v3 connector still exists under that name. Other 409s during a rebalance are temporary |

[Back to contents](#contents)

### 1.5.7 Spark connector

**Versions and packaging**

| | 3.x | 2.x |
|--|-----|-----|
| Spark versions | 3.2, 3.3, 3.4, 3.5, 4.0, 4.1 | 3.2, 3.3, 3.4 |
| Artifact | One per Scala version, covers most Spark versions: `net.snowflake:spark-snowflake_2.13:3.1.1` | One per Spark version: `net.snowflake:spark-snowflake_2.12:2.16.0-spark_3.4` |

- Scala 2.12 or 2.13. Distributed from Maven Central. Compiled packages are not on GitHub. The connector runs as a Spark plugin (`spark-snowflake`).
- Data source name: `net.snowflake.spark.snowflake`. From 2.10.0, `snowflake` also works.
- You need the **Snowflake JDBC driver** version the connector declares in its POM, plus the connector JAR. With `spark-shell` pass `--packages net.snowflake:snowflake-jdbc:<v>,net.snowflake:spark-snowflake_2.12:<v>`.
- The role needs **`USAGE` and `CREATE STAGE`** on the schema of the table it reads or writes.
- Databricks and Qubole embed the connector. You do not install it there.
- To enforce row access and masking policies on **Iceberg tables** read from Spark through Horizon Catalog, use connector **3.1.6 or later**.
- Optional: verify the package signature with GPG (`.jar.asc`). Snowflake rotates the key periodically.

**Data transfer**

| | Internal (default recommendation) | External |
|--|-----------------------------------|----------|
| Location | A temporary internal stage the connector creates at session start and drops at session end | A bucket or container you create (S3, Azure Blob) |
| Minimum version | AWS 2.2.0, Azure 2.4.0, GCP 2.7.0 | Required for 2.1.x or lower |
| Use when | Default | A transfer likely to take **36 hours or more**. Internal uses temporary credentials that **expire after 36 hours** |
| Cleanup | Automatic | **Not automatic.** Set `purge=on` (Spark to Snowflake only), delete manually, or use a bucket lifecycle policy |

- `columnmapping` style mapping works for internal transfer only (see open items).

**Query pushdown** (2.1.0 and later)
- On by default (`autopushdown`). The connector captures the Spark logical plan and translates it to SQL that runs in Snowflake. Supported: aggregates (`Count`, `Sum`, `Avg`, `Max`, `Min`, variance and stddev), boolean operators, joins, filters, projections, sorts, `Limit`, `Union`, window functions (`Rank`, `DenseRank`, `RowNumber`), many string, math and date functions.
- **Spark UDFs cannot be pushed down.** When pushdown fails the connector falls back to Spark and runs the operation there.
- If the connector is plugged into a different Spark version than it targets, `autopushdown` is **off** even if you set it on.
- Disable per session with `SnowflakeConnectorUtils.disablePushdownSession(spark)` plus `.option("autopushdown","off")`. Use `Utils.getLastSelect()` to see the SQL issued.

**Reading and writing**
- Read with `format("net.snowflake.spark.snowflake")`, options, and either `dbtable` (all columns) or `query` (a `SELECT`). DataFrames support `SELECT` only, no `SHOW`, `DESC` or DML.
- Write with `dbtable` and a save mode. `SaveMode.Overwrite` replaces the table **and its schema** unless `truncate_table=on`, which truncates and keeps the schema. A `StringType` column that holds geospatial data creates `VARCHAR`. Keep `GEOGRAPHY` by writing to an existing table with `truncate_table=on`.
- `Utils.runQuery(sfOptions, "<DDL or DML>")` returns only `TRUE` or `FALSE`. It is not for `SELECT` or `SHOW`.
- JSON to a `VARIANT`: create the table first, then write with `SaveMode.Append`. `Overwrite` creates a `VARCHAR` column.
- For `DataFrame.show(n)`, sort then limit first, or the rows shown vary between runs.

**Connection options**

| Option | Meaning |
|--------|---------|
| `sfUrl` | `account_identifier.snowflakecomputing.com` |
| `sfUser` | Login name |
| One of: `sfPassword`, `pem_private_key`, `sfAuthenticator` | Password, key pair, or `oauth` (with `sfToken`) or `WORKLOAD_IDENTITY` (recommended, with `sfWorkloadIdentityProvider` = `AWS`, `AZURE`, `GCP` or `OIDC`) |
| `sfDatabase`, `sfSchema` | Required session context |
| `sfWarehouse`, `sfRole` | Optional context |
| `use_proxy`, `proxy_host`, `proxy_port`, `proxy_user`, `proxy_password`, `non_proxy_hosts` | Proxy. `proxy_protocol` (2.11.1 and later), user, password and `non_proxy_hosts` are AWS only |

**Behavior options and defaults**

| Option | Default | Effect |
|--------|---------|--------|
| `usestagingtable` | `on` | Load into a temporary table, then swap. On failure the target keeps its old data. Needs create-table privilege. `off` loads directly |
| `continue_on_error` | `off` | `on` skips bad rows. Not recommended, causes missing data |
| `truncate_columns` | `on` | `COPY` truncates over-length strings. `off` errors |
| `truncate_table` | `off` | `on` keeps the target schema on overwrite |
| `column_mapping` | `order` | `name` maps by column name, case-insensitively |
| `column_mismatch_behavior` | `error` | With `name` mapping, `ignore` drops extra DataFrame columns and fills missing table columns with NULL. It still errors if **no** names match |
| `columnmap` | null | An explicit map, `"Map(col_2 -> col_b)"`. Spark to Snowflake only |
| `keep_column_case` | `off` | Writes uppercase column names unless quoted. Reads quote names with other characters |
| `sfCompress` | `on` | Compress transfer data |
| `s3MaxFileSize` | 10 MB | File size from Snowflake to Spark |
| `purge` | `off` | Delete external-transfer temp files (Spark to Snowflake only) |
| `preactions`, `postactions` | none | Semicolon-separated SQL. `%s` becomes the table name |
| `sfTimezone` | `spark` | Also `snowflake`, `sf_default`, or a named zone |

**Time zones.** Spark has one timestamp type, close to `TIMESTAMP_LTZ`. The connector's default Snowflake mapping is `TIMESTAMP_NTZ`. To avoid shifted times, follow at least one: use only `TIMESTAMP_LTZ` (set the timestamp type mapping parameter), or set Spark and Snowflake both to UTC. The page's example: a Spark zone of New York, a Snowflake zone of Warsaw, and an NTZ value of `12:00:00` reloaded as LTZ becomes `18:00:00`.

**Type mapping highlights**

| Direction | Mapping |
|-----------|---------|
| Spark to Snowflake | `ArrayType`, `MapType`, `StructType` → `VARIANT`. `Byte`, `Short`, `Int`, `Long` → `INTEGER`. `StringType` → `VARCHAR`. `TimestampType` → `TIMESTAMP`. **`BinaryType` not supported** |
| Snowflake to Spark | `ARRAY`, `OBJECT`, `VARIANT` → `StringType`. `BIGINT`, `INTEGER` → `DecimalType(38,0)`. `FLOAT` → `DoubleType`. `TIME` → `StringType` (2.4.14 and later). **`BINARY` not supported**. `GEOGRAPHY` and `GEOMETRY` → `StringType` for GeoJSON, WKT, EWKT output formats. WKB and EWKB are returned as binary and unsupported |

[Back to contents](#contents)

### 1.5.8 Python connector

**Install and versions**
- `pip install snowflake-connector-python`. Version **5.x** is built on the Universal Core, requires **Python 3.11 or later**, and keeps the `snowflake.connector` module and PEP 249 `Connection` and `Cursor`.
- **Snowpark for Python, Snowflake ML, Snowflake SQLAlchemy and Snowflake CLI still need a connector before 5.0.** Upgrading a shared environment can break them. Pin `snowflake-connector-python>=4,<5` when needed.
- Pandas support: `pip install "snowflake-connector-python[pandas]"` (quotes needed). The extra installs PyArrow. Do not install another PyArrow version.
- A **FIPS** build compiles from the source distribution: `SNOWFLAKE_FIPS=1 python -m pip install --no-binary snowflake-connector-python snowflake-connector-python`. `snowflake.connector.get_fips_status()` reports it.
- Removed or changed in 5.0: `converter_class` raises `ProgrammingError`. OCSP is not used. Certificate revocation uses CRLs through `crl_check_mode` (`DISABLED` default, `ADVISORY`, `ENABLED`). `private_key_file_pwd` is renamed `private_key_password` (the old name works with a `DeprecationWarning`). `network_timeout` and `socket_timeout` are deprecated.

**Connecting**
- `user` is the user's `LOGIN_NAME`, not `NAME`, when they differ. `account` is the account identifier **without** `snowflakecomputing.com`.
- `connections.toml` lookup order: `~/.snowflake/connections.toml` if that directory exists (override with `SNOWFLAKE_HOME`), otherwise `~/.config/snowflake/` (Linux), `%USERPROFILE%\AppData\Local\snowflake\` (Windows), `~/Library/Application Support/snowflake/` (macOS). Use `connect(connection_name="x")`. Other arguments override the file values.
- The default connection, lowest to highest precedence: a connection named `default`, `default_connection_name` in `config.toml`, the `SNOWFLAKE_DEFAULT_CONNECTION_NAME` environment variable. With a default connection you **cannot override** parameters such as `username`, `database` or `schema`.
- Session parameters: `session_parameters={'QUERY_TAG': ...}` at connect, `ALTER SESSION SET`, or per statement with `execute(..., _statement_params={...})` for `TIMEZONE` and `QUERY_TAG`. You cannot set `SEARCH_PATH` through connect.

| Method | Parameters |
|--------|------------|
| Password | `user`, `password`, `account`, and context |
| Key pair | `authenticator='SNOWFLAKE_JWT'`, `private_key_file`, `private_key_password` (or `private_key`) |
| OAuth token | `authenticator='oauth'`, `token` |
| OAuth authorization code | `authenticator='OAUTH_AUTHORIZATION_CODE'`, `oauth_client_id`, `oauth_client_secret`, `oauth_authorization_url`, `oauth_token_request_url`, `oauth_scope`, `oauth_redirect_uri`. PKCE on unless `oauth_disable_pkce` |
| OAuth client credentials | `authenticator='OAUTH_CLIENT_CREDENTIALS'`, client ID and secret, token request URL, scope |
| Workload identity | `authenticator='WORKLOAD_IDENTITY'`, `workload_identity_provider` = `AWS`, `AZURE`, `GCP` or `OIDC` (OIDC needs `token` or `token_file_path`) |
| Programmatic access token | `token` or `token_file_path`. The feature must be enabled on the account |
| MFA | `authenticator='username_password_mfa'`, `passcode`, or `passcode_in_password=True`. Token caching through `client_store_temporary_credential` (default `True`, also needs server-side enablement) |

**Timeouts and retries.** `login_timeout` 120 s. `query_timeout` 0 (none). `request_timeout` 120 s. `connect_timeout` and `retry_timeout` have no default cap. Backoff: `retry_backoff_base_ms` 250, `retry_backoff_factor` 2, `retry_backoff_cap_ms` 16000, `retry_backoff_jitter` `decorrelated`.

**Running SQL**

| Need | Call | Notes |
|------|------|-------|
| One statement | `cursor.execute(sql, params)` | |
| Same parameterized statement, many rows | `cursor.executemany(sql, seq)` | **One** statement only. Not for several statements joined by semicolons |
| Several statements in one string | `connection.execute_string(text)` | **No bind parameters.** Injection risk if you build the string from user input |
| A script from a file or stream | `connection.execute_stream(stream)` | A generator of cursors. Set `remove_comments=True` if the stream ends in comment lines |
| Do not wait | `cursor.execute_async(sql)` | No `PUT` or `GET`. Poll with `conn.get_query_status(sfqid)` (or `get_query_status_throw_if_error`). Fetch with `cursor.get_results_from_sfqid(id)` |
| Cancel | `SELECT SYSTEM$CANCEL_QUERY('<query id>')` | |

- The query ID is `cursor.sfqid`.
- **Async queries are not guaranteed to return ordered results**, even with `ORDER BY`. Never run `BEGIN`, `COMMIT` or `ROLLBACK` in parallel with other statements.
- `ABORT_DETACHED_QUERY` (default `FALSE`): queries keep running after connectivity is lost. `TRUE` aborts them 5 minutes after loss. Calling `cursor.query_result(queryId)` prevents the abort.
- `connection.close()` logs the session out and cancels its queries unless async queries are running. `server_session_keep_alive=True` stops the logout and can leave billable queries running up to `STATEMENT_TIMEOUT_IN_SECONDS`. Put long async work on a separate connection.

**Binding**

| Style | Placeholder | Where bound |
|-------|-------------|-------------|
| `pyformat` (default), `format` | `%(name)s`, `%s` | **Client** |
| `qmark` | `?` | **Server** |
| `numeric` | `:1`, `:2` | **Server**. A value used twice is sent once |

- Set with `snowflake.connector.paramstyle='qmark'` or `paramstyle` in `connect()`.
- With client binding, escape a literal `%` as `%%`. The API page says there is no significant performance difference between styles.
- A list binds into `IN (%s)` for the client styles.
- Never build SQL with Python `%`, `.format()` or f-strings.
- With server binding, `executemany` for an `INSERT` streams values above a threshold to a temporary stage. The session needs a **current database and schema**, or `CREATE TEMPORARY STAGE SYSTEM$BIND` fails.

**Transactions.** `autocommit` is on by default and honors the `AUTOCOMMIT` parameter. With `autocommit=False` the `with connect()` context manager commits on success and rolls back on an exception. Otherwise use `BEGIN`, `COMMIT`, `ROLLBACK`.

**Loading data**
- Files: `PUT file:///tmp/data/file* @%testtable`, then `COPY INTO`. External data: `COPY INTO ... FROM s3://... STORAGE_INTEGRATION = myint`.
- Batch rows: `executemany` with server binding. Avoid individual `INSERT` statements for bulk data.
- DataFrames: **`write_pandas(conn, df, 'table')`** writes Parquet files, `PUT`s them to a temporary stage, and runs `COPY INTO`. It returns `(success, num_chunks, num_rows, output)`.

| `write_pandas` parameter | Default |
|--------------------------|---------|
| `chunk_size` | All rows in one chunk |
| `compression` | `gzip` (or `snappy` for speed) |
| `on_error` | `ABORT_STATEMENT` |
| `quote_identifiers` | `True`. `False` rejects invalid unquoted names |
| `bulk_upload_chunks` | `False` (chunks are saved, uploaded and deleted one by one) |
| `table_type` | `''` (permanent). Also `temp`, `temporary`, `transient` |
| `database`, `schema` | Session's. Giving `database` requires `schema` |

- `DataFrame.to_sql(..., method=pd_writer)` also works. When DataFrame column names are all lowercase, quote them or the connector raises `ProgrammingError`. `snowflake-sqlalchemy` does not quote lowercase names when creating a table.

**Fetching data**
- `fetchone`, `fetchmany`, `fetchall`, and iteration over the cursor. `DictCursor` returns rows keyed by column name.
- `fetch_pandas_all()` and `fetch_pandas_batches()` return DataFrames. `fetch_arrow_all()` and `fetch_arrow_batches()` return PyArrow tables.
- **`cursor.get_result_batches()`** returns `ResultBatch` objects (`rowcount`, `compressed_size`, `uncompressed_size`, `to_arrow()`, `to_pandas()`). Hand different batches to different workers to fetch in parallel. It returns `None` if the query has not finished.
- Pandas mapping: a zero-scale numeric becomes an integer type, but **NULLs turn it into `float64`**. Scale above zero becomes `float64`. `DECIMAL` becomes `decimal`. `VARIANT` and `BINARY` become `str`. `DATE` becomes `datetime.date` objects. Overflow raises an exception.
- `unsafe_file_write` (3.14.0 and later, default `False`) sets file permissions for `GET` downloads to 600. `True` gives 644.

**Other:** use the connector's `VECTOR` type support (3.6.0 and later). Close connections in `finally` or a `with` block, because unclosed connections can exhaust resources. Run connectivity diagnostics with `enable_connection_diag=True`.

[Back to contents](#contents)

### 1.5.9 Native connectors

"Native connectors" are Snowflake Native Apps that ingest from an external system, installed from the Snowflake Marketplace. The Openflow connectors in 1.4.24 are the stated next-generation replacement for several of them.

**Status of each connector (as stated on its page)**

| Connector | Status |
|-----------|--------|
| MySQL | Preview. GA is not on the roadmap. The Openflow Connector for MySQL is the successor |
| PostgreSQL | Preview. GA is not on the roadmap. The Openflow Connector for PostgreSQL is the successor |
| SharePoint | Preview. GA is not on the roadmap. The Openflow Connector for SharePoint is the successor |
| ServiceNow | Generally available |
| Google Analytics Aggregate Data and Raw Data | No status stated on the pages read |
| Microsoft Power Platform | A connection from Power Apps, Power Automate, Copilot Studio and Logic Apps **into** Snowflake |

**Database connectors (MySQL, PostgreSQL): components**
- A **Native App** in your account and an **Agent**, a Docker image that runs **inside your network** and pushes data to Snowflake. This is the push-based pattern for sources behind a firewall.
- **Exactly one agent instance** must run at all times. One agent connects to one Native App instance and vice versa. For separate networks, install more app instances (a private-preview feature), each with its own agent.
- Keep the agent version equal to the app version. Each app `x.y.z` supports agents with the same major version and a minor version no higher. Each `x.0.0` app also supports all `(x-1).Y.Z` agents.
- Agent resources (MySQL page): at least **6 GB RAM**, **4 CPUs** optimal (more does not help). Direct reachability to every source database (MySQL port 3306) and to Snowflake hostnames. The agent needs the **MariaDB JDBC driver 3.4.1**, which you supply (licensing). Private links are supported (AWS PrivateLink, Azure Private Link, Google Private Service Connect).
- The MySQL page says to install and configure as **`ACCOUNTADMIN`** (other roles are not supported). An **event table** must be configured (the connector logs to it). `AUTOCOMMIT` must be true. Government regions are not supported. Use a schema different from other native apps.
- Application roles: `ADMIN` (view config and run procedures), `AGENT` (used by the agent, not manually), `VIEWER` (basic config), `DATA_READER` (read replicated data). To read data a user needs `USAGE` on the destination database and schema and `SELECT` on the table.

**Objects and lifecycle**

| Object | Role |
|--------|------|
| Data source | The database being replicated. One connector instance can use many if the agent can reach them |
| Source table | A table tracked for changes |
| Journal | A connector-owned table with every insert, update and delete for a source table |
| Destination table | Where data lands. Adds `_SNOWFLAKE_INSERTED_AT`, `_SNOWFLAKE_UPDATED_AT`, `_SNOWFLAKE_DELETED`. **Change tracking is pre-enabled** so you can create streams. The app keeps `OWNERSHIP` |

Per-table lifecycle:
1. **Schema introspection:** discover columns and validate against Snowflake and connector limits. A failure ends the cycle.
2. **Snapshot load:** the agent runs one `SELECT` on the source and streams rows through **Snowpipe Streaming** into a snapshot table. A task then runs `INSERT INTO ... SELECT` into the destination, and the snapshot table is dropped. It can be heavy on the source and slow for large tables.
3. **Incremental load:** the agent reads the source changelog (CDC) into the journal. A **merge task** merges journal rows into the destination (insert, update, soft-delete).
- A table that **fails permanently** stays stopped until the cause is fixed and you **remove the table from replication and add it again**. That repeats the snapshot.
- A snapshot is also repeated if replication was paused and the source changelog no longer holds the entries since the last replication.

**Replication mode and warehouses**
- Mode is set **per data source**, not per table. **Continuous** (default) replicates as fast as possible. **Scheduled** batches on a fixed schedule, for data that changes rarely or to cut credits. Continuous mode never reports incremental load as completed.
- Two warehouses: an **Operational warehouse** (command and control, XS is optimal, **cannot be shared** between instances or other workloads) and a **Compute warehouse** (merge tasks, may be shared, but sharing can delay data).
- The operational warehouse **never suspends in continuous mode**, so it consumes credits even with no changes. To allow auto-suspend, switch **all** data sources to scheduled.

**MySQL requirements and limits**
- MySQL 8.0 or 8.4 (`binlog_row_metadata=full` exists from 8). Supported: standard, AWS RDS, Amazon Aurora (version 3), GCP Cloud SQL. Azure Database for MySQL is listed as not supported.
- Server settings: `log_bin=on`, `binlog_format=row`, `binlog_row_metadata=full`, `binlog_row_image=full`, `binlog_row_value_options` empty, `binlog_expire_logs_seconds` at least a few hours (longer than the schedule when using scheduled replication).
- The agent user needs `REPLICATION SLAVE`, `REPLICATION CLIENT` and `SELECT`. Only **username and password** authentication is supported.
- **Tables without a primary key are not supported.**
- A transaction over about **4 GB** marks the table permanently failed and needs a snapshot reload.
- The binlog holds changes for **all** tables. Very large events (for example `BLOB` updates) on tables not replicated can exhaust agent memory.
- Unsupported identifiers: the `"` character, schema `INFORMATION_SCHEMA`, column names `_SNOWFLAKE_INSERTED_AT`, `_SNOWFLAKE_UPDATED_AT`, `_SNOWFLAKE_DELETED`, and names ending in `__SNOWFLAKE_DELETED`.
- Values that exceed Snowflake limits (for example `BINARY` over 64 MB, `VARCHAR` over 128 MB, a year above 9999) stop replication of that table.

| Source schema change | Result |
|----------------------|--------|
| Add column | Supported. A name cannot reuse a previously dropped or renamed column's name |
| Drop column | Supported as a **soft delete**. The column is renamed `<name>__SNOWFLAKE_DELETED`. New rows get NULL |
| Rename column | Treated as drop plus add. Old rows keep values in the `__SNOWFLAKE_DELETED` column |
| Change type | Only if both types map to the same Snowflake type. Otherwise replication **fails permanently** |
| Change numeric precision or scale | **Fails permanently** |
| Change primary key | **Fails permanently** |

**Cost governance.** Use a **dedicated** operational and compute warehouse pair and put **resource monitors** on them. A quota set too low can stop the connector before all data arrives. Use a separate account or database and object tags to track cost. Storage includes Fail-safe, which grows with updates and reloads and stabilizes about **7 to 10 days** after setup.

**Support and logs.** Native app logs go to your event table and are shared with Snowflake by default. Agent logs must be extracted and attached to a case manually.

**Other native connectors**

| Connector | Key facts |
|-----------|-----------|
| ServiceNow | Uses the ServiceNow `v2` Table API. Initial load plus incremental pulls on a schedule you control. Needs a `sys_id` column. Views and archived records are not ingested. Does not work with IP-restricted instances or ones behind a VPN. Destination schemas cannot use **managed access**. Needs `AUTOCOMMIT` and a warehouse with `AUTO_RESUME` (serverless is not supported) |
| Google Analytics Aggregate Data | GA4 report data from the Reporting API. Report definition must include the `date` dimension. **At most 40 reports.** GA data can change up to 72 hours after recording. Needs `AUTOCOMMIT`, `TIMESTAMP_INPUT_FORMAT=AUTO`, and a warehouse `STATEMENT_TIMEOUT_IN_SECONDS` of at least 4 hours if set. The connector must own the destination tables. No future ownership grants and no managed schema. Not on trial accounts |
| Google Analytics Raw Data | Event-level GA4 data. Needs a manual link from the GA4 property to a GCP project (BigQuery export). The connector reads through the BigQuery Storage API. Not on trial accounts. The app owns tables and views in the destination schema. No future ownership grants and no managed schema. Custom date formats and emoji in the app name are not supported. Switching the export to another project is not supported |
| SharePoint | Ingests files and user permissions. Works with Cortex Search and respects SharePoint access controls through Cortex Search filters |

**Native SDK for Connectors.** A set of templates and libraries to build your own native connector. It currently supports only the **pull-based** pattern, where the app uses external access to fetch from the source. The **push-based** pattern uses an agent behind the customer's firewall (as the MySQL and PostgreSQL connectors do).

[Back to contents](#contents)

### 1.5.10 Quick-reference for 1.5

| Question | Answer |
|----------|--------|
| Kafka to Snowflake, lowest latency | Connector v4 (Snowpipe Streaming high-performance), 5 to 10 s |
| v4 connector class | `SnowflakeStreamingSinkConnector` |
| v3 backend setting | `snowflake.ingestion.method` = `SNOWPIPE` (default) or `SNOWPIPE_STREAMING` |
| v3 Snowpipe vs Streaming buffer defaults | 120 s and 5 MB, versus 10 s and 20 MB. Count 10,000 for both |
| v4 table shape by default | Schematized columns. `RECORD_CONTENT` and `RECORD_METADATA` only with schematization off |
| v4 default pipe name | `{tableName}-STREAMING` |
| User-defined pipe in v4 | Same name as the table. Needs server-side validation |
| `ERROR_5030` | User-created pipe with client-side validation, or a data error with tolerance `none` |
| Where do v3 failed files go | The target table's stage (`@db.schema.%table`) |
| Same partition and offset duplicated (v3) | Poll timeout. Raise `consumer.max.poll.interval.ms` to 900000 or lower `consumer.max.poll.records` to 50 |
| Replace v3 with v4 | Same connector name, wait for the consumer group to be `Empty`, set offset migration (`skip` for Snowpipe mode) |
| Spark transfer over 36 hours | External transfer. Temporary internal credentials expire at 36 hours |
| Spark UDF | Cannot be pushed down |
| Spark overwrite keeps schema | `truncate_table=on` |
| Spark write fails midway, target intact | `usestagingtable=on` (default) |
| Spark timestamps shift | Use `TIMESTAMP_LTZ` only, or UTC on both sides |
| Python placeholders on the server | `qmark` (`?`) or `numeric` (`:1`) |
| Python many statements, one call | `execute_string` (no binds) or `execute_stream` |
| Python batch insert | `executemany` with server binding. Needs a current database and schema |
| Python DataFrame load | `write_pandas`. It stages Parquet and runs `COPY` |
| Python parallel fetch | `get_result_batches()` |
| Python 5.x with Snowpark | Pin the connector below 5.0 |
| MySQL or PostgreSQL native connector fails on one table | Remove the table from replication and add it again |
| Native connector table without a primary key | Not supported (MySQL) |
| Cut credits for a native DB connector | Scheduled mode on all data sources so the ops warehouse can suspend |
| Cap native connector cost | Dedicated warehouses with resource monitors. Too low a quota stops ingestion |

[Back to contents](#contents)

### 1.5 open items and flags

- **"Native connectors" is ambiguous.** The study guide lists it with no detail. I took it to mean the Snowflake Connectors for Native Apps (database, ServiceNow, Google Analytics, SharePoint) and the Native SDK for Connectors. Openflow connectors (1.4.24) might be what the exam means. Please confirm.
- **v4 table naming.** `how-the-connector-works` says a valid topic name becomes the table name "converted to uppercase", and an invalid one gets underscores plus a hash (`my-topic.data` becomes `MY_TOPIC_DATA_`). The `setup-kafka` property `snowflake.compatibility.enable.autogenerated.table.name.sanitization` says that with the default `false`, topic names are used **as-is, case preserved, as quoted identifiers**, and the underscore, uppercase and hash behavior applies only when `true`. I could not reconcile these.
- **Buffer defaults.** v3 Snowpipe mode and Snowpipe Streaming mode have different defaults (120 s and 5 MB, versus 10 s and 20 MB). The v3 install page's sample files use 60 s and 5,000,000 bytes, which are not the defaults. 1.4.21 labels its buffer line as v3 streaming and is correct. Its default-schema line was reworded (below).
- **Confluent Cloud.** The v3 overview says a hosted version exists on Confluent Cloud. The v4 page says v4 is not yet a managed Confluent Cloud connector.
- **v3 object name patterns.** The page's angle-bracket placeholders were stripped, so I did not reproduce the exact `STAGE` and `PIPE` name formats.
- **Spark column mapping.** The overview says the `columnmapping` parameter works for internal transfer only. The options list documents `columnmap`, `column_mapping` and `column_mismatch_behavior` and does not say they are internal-only. The option is `sfUrl` in the option list and `sfURL` in sample code. The page does not say whether the name is case-sensitive.
- **Spark age of text.** The Databricks page says "Databricks Runtime 4.2 or later". The 2.1.x external-transfer requirement is old. Treat both as background only.
- **Not fetched or empty:** Kafka `monitor` (JMX metrics), `test-connector`, the Iceberg page, v3 Snowpipe Streaming classic configuration and best-practice pages, `kafka-connector/classic/index` details, Spark `pushdown` (empty), Spark Qubole and ETL pages, Python `asyncio`, `upgrade` and SQLAlchemy pages, and the full `connect()` parameter table (only the pages above were read). Openflow connector pages (`connectors/about` returned nothing), PostgreSQL-specific limits beyond the intro, the MySQL and PostgreSQL ongoing-tasks and replication-configuration pages, SharePoint setup, and ServiceNow cost pages.
- **Python version claim.** The 5.x pages say Python 3.11 or later and that 5.0 raised the minimum from 3.9. Older exam material may state a lower version.
- **Google Analytics status.** The two pages say nothing about preview or GA status, so I left it blank.
