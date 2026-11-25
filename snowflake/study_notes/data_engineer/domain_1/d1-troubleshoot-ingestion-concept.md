# Domain 1: Data Movement, troubleshoot ingestion (SnowPro Advanced: Data Engineer, DEA-C02)

Weight: **28%**. Domain 1 notes are split across 8 files: [d1-load-data-concept.md](d1-load-data-concept.md) (1.1: load data); [d1-ingest-data-formats-concept.md](d1-ingest-data-formats-concept.md) (1.2: ingest data of various formats); this file, 1.3: troubleshoot data ingestion; [d1-streams-and-tasks-concept.md](d1-streams-and-tasks-concept.md) (1.4.1 to 1.4.12: streams and tasks); [d1-continuous-pipelines-concept.md](d1-continuous-pipelines-concept.md) (1.4.13 to 1.4.26: dynamic tables, Snowpipe and developer tools); [d1-connectors-concept.md](d1-connectors-concept.md) (1.5: connectors); [d1-data-sharing-concept.md](d1-data-sharing-concept.md) (1.6: data sharing and consumption); [d1-tables-and-data-operations-concept.md](d1-tables-and-data-operations-concept.md) (1.7: tables and data operations). A section is added only after it is approved. The contents table below lists only the sections in this file.

## Contents

| Section | Topic | Status |
|---------|-------|--------|
| 1.3 | [Troubleshoot data ingestion](#13-troubleshoot-data-ingestion) | Approved |

---

## 1.3 Troubleshoot data ingestion

**Sections in 1.3**

- [1.3.1 Method: where to look first](#131-method-where-to-look-first)
- [1.3.2 Bulk load: COPY_HISTORY, VALIDATION_MODE, VALIDATE](#132-bulk-load-copy_history-validation_mode-validate)
- [1.3.3 Causes of bulk load errors and fixes](#133-causes-of-bulk-load-errors-and-fixes)
- [1.3.4 Snowpipe: SYSTEM$PIPE_STATUS and execution states](#134-snowpipe-systempipe_status-and-execution-states)
- [1.3.5 Snowpipe: files that never load](#135-snowpipe-files-that-never-load)
- [1.3.6 Snowpipe: errors in files, notifications and VALIDATE_PIPE_LOAD](#136-snowpipe-errors-in-files-notifications-and-validate_pipe_load)
- [1.3.7 Recovering and reloading files](#137-recovering-and-reloading-files)
- [1.3.8 Duplicates and load time pitfalls](#138-duplicates-and-load-time-pitfalls)
- [1.3.9 Quick-reference](#139-quick-reference)
- [1.3 Open items and flags](#13-open-items-and-flags)

### 1.3.1 Method: where to look first

| Step | Bulk `COPY INTO` | Snowpipe |
|------|------------------|----------|
| 1. Is it running? | Not covered by the pages read | `SYSTEM$PIPE_STATUS('db.schema.pipe')` |
| 2. What happened to each file? | `COPY_HISTORY` (`STATUS`, `FIRST_ERROR_MESSAGE`) | `COPY_HISTORY` with the pipe's target table |
| 3. All errors, not just the first | `VALIDATION_MODE = RETURN_ALL_ERRORS`, or `VALIDATE(table, JOB_ID => ...)` | `VALIDATE_PIPE_LOAD(PIPE_NAME => ..., START_TIME => ...)` |
| 4. Keep the rejected rows | Error logging with `ON_ERROR = CONTINUE` | Same |

Most Snowpipe problems sit in one of three places: **event notifications** from cloud storage, **the pipe**, or **the files**.

[Back to contents](#contents)

### 1.3.2 Bulk load: COPY_HISTORY, VALIDATION_MODE, VALIDATE

**COPY_HISTORY (table function, Information Schema)**

```sql
SELECT file_name, status, row_count, first_error_message, last_load_time
FROM TABLE(INFORMATION_SCHEMA.COPY_HISTORY(
  TABLE_NAME => 'mytable',
  START_TIME => DATEADD('hour', -24, CURRENT_TIMESTAMP())));
```

| Item | Detail |
|------|--------|
| Covers | `COPY INTO <table>` **and** Snowpipe loads |
| Range | **Last 14 days**. Account Usage view covers 365 days |
| Required args | `TABLE_NAME`, `START_TIME`. Optional `END_TIME` (default now), `PIPE_NAME` |
| `STATUS` values | `Load in progress`, `Loaded`, `Load failed`, `Partially loaded`, `Load skipped` |
| Error columns | `FIRST_ERROR_MESSAGE`, `FIRST_ERROR_LINE_NUMBER`, `FIRST_ERROR_CHARACTER_POS`, `FIRST_ERROR_COLUMN_NAME`, `ERROR_COUNT`, `ERROR_LIMIT` |
| Only the **first** error per file | Use `VALIDATE`, `VALIDATION_MODE` or error logging for all of them |
| Missing from the results | Only COPY statements that **ran to completion**. Dropped or recreated **table** removes bulk history. Dropped or recreated **pipe** removes its Snowpipe history. History returned only **after the latest `TRUNCATE`** of the table |
| `PIPE_NAME` | `NULL` for bulk loads. Also masked to NULL for Snowpipe loads if the role lacks `MONITOR` on the pipe |
| Privileges | Bulk: `MONITOR` on account, or `USAGE` on schema and database plus any privilege on the table. Snowpipe: same on the pipe's schema |
| No 10,000 row limit | Unlike the `LOAD_HISTORY` view |

**COPY_HISTORY view (`SNOWFLAKE.ACCOUNT_USAGE`)**: 365 days. Latency usually up to **120 minutes**, and for a table with few recent loads up to **2 days**.

**VALIDATION_MODE (a copy option)**

```sql
COPY INTO mytable FROM @mystage/myfile.csv.gz VALIDATION_MODE = RETURN_ALL_ERRORS;
SET qid = LAST_QUERY_ID();
COPY INTO @mystage/errors/load_errors.txt
  FROM (SELECT rejected_record FROM TABLE(RESULT_SCAN($qid)));
```

- Checks the files and returns the errors. **No data is loaded.**
- Does **not** evaluate `CHECK` constraints, so those violations are not returned.
- Not supported with a transforming COPY (see 1.1.10), with `MATCH_BY_COLUMN_NAME`, or for Iceberg tables.

**VALIDATE (table function)**: checks a **past** `COPY INTO <table>`.

```sql
SELECT * FROM TABLE(VALIDATE(t1, JOB_ID => '_last'));
SELECT * FROM TABLE(VALIDATE(t1, JOB_ID => '5415fa1e-59c9-4dda-b652-533de02fdcf1'));
```

- `JOB_ID`: a query ID, or `_last` for the last load in the session (any table).
- Returns **one row per error**: `ERROR`, `FILE`, `LINE`, `CHARACTER`, `BYTE_OFFSET`, `CATEGORY`, `CODE`, `SQL_STATE`, `COLUMN_NAME`, `ROW_NUMBER`, `ROW_START_LINE`, `REJECTED_RECORD`.
- **Returns nothing** for COPY statements that used `ON_ERROR = ABORT_STATEMENT` (the default).
- **Fails** if the COPY used a transforming `SELECT`, if you lack access to the table, if you did not run the query (and lack privileges on that user), or if the copy history metadata expired.
- Files added to the stage since are ignored. Files removed since are reported as **missing**.
- Does not return `CHECK` constraint violations.

**Error logging** (details in 1.1.9): the only option that also keeps rows from **transforming loads** and rows that violate **CHECK constraints**. Supports CSV, JSON and Parquet. Needs `ON_ERROR = CONTINUE`.

[Back to contents](#contents)

### 1.3.3 Causes of bulk load errors and fixes

Causes already covered in earlier sections, collected here:

| Symptom | Cause | Fix |
|---------|-------|-----|
| Load aborts on the first bad row | `ON_ERROR = ABORT_STATEMENT` is the bulk default | Set `ON_ERROR = CONTINUE` or `SKIP_FILE` (1.1.8) |
| Only the first error is visible | `COPY_HISTORY` reports one per file | `VALIDATION_MODE = RETURN_ALL_ERRORS` or `VALIDATE` |
| File not reloaded, no error | File is in the table's load metadata (**64 days**) | `FORCE = TRUE` (can duplicate) or `LOAD_UNCERTAIN_FILES = TRUE` for files whose metadata expired (1.1.7) |
| Column count error on CSV | `ERROR_ON_COLUMN_COUNT_MISMATCH = TRUE` default | Set to `FALSE` (extra fields dropped, missing ones NULL). Varying record length still fails (1.2.3) |
| `match_by_column_name is not supported with copy transform` | `MATCH_BY_COLUMN_NAME` with a transforming `SELECT` | Use one or the other (1.1.10) |
| Invalid UTF-8 | Source encoding differs | `REPLACE_INVALID_CHARACTERS = TRUE` or set `ENCODING` (1.2.3) |
| Empty strings fail on non-string columns | `EMPTY_FIELD_AS_NULL = FALSE` | Leave at `TRUE`, or use `NULL_IF` |
| Brotli files not read | `AUTO` doesn't detect Brotli | `COMPRESSION = BROTLI` (1.2.5) |
| `Integration '{0}' associated with the stage '{1}' cannot be found` (SQL error `003139`) | Storage integration was **recreated** with `CREATE OR REPLACE`. Stages link by **hidden ID**, not name | `ALTER STAGE stage SET STORAGE_INTEGRATION = integration` |
| Access denied on an external stage | Integration, trust policy or bucket permissions wrong | Check `DESC INTEGRATION` values against the trust policy, and S3 permissions (1.2.9). Validate with `SYSTEM$VALIDATE_STORAGE_INTEGRATION` |
| Row load times earlier than `LAST_LOAD_TIME` | `CURRENT_TIMESTAMP` default is evaluated at **compile** time | Use `METADATA$START_SCAN_TIME` in the COPY, or row timestamps (1.3.8) |

[Back to contents](#contents)

### 1.3.4 Snowpipe: SYSTEM$PIPE_STATUS and execution states

```sql
SELECT SYSTEM$PIPE_STATUS('mydb.myschema.orders_pipe');   -- returns JSON
```

- Needs `OWNERSHIP` or `MONITOR` on the pipe, or `MONITOR EXECUTION` on the account.
- The pipe name is a string. If the name is case-sensitive, wrap it in double quotes inside the single quotes.
- `oldestPendingFilePath` and `oldestFileTimestamp` are absent when `pendingFileCount` is `0`.

| Field | Meaning and what to conclude |
|-------|------------------------------|
| `executionState` | `RUNNING` is normal |
| `lastIngestedTimestamp`, `lastIngestedFilePath` | Last file loaded successfully. An old time means the pipe stopped around then |
| `error` | Error from the **last compile** of the pipe's `COPY INTO`: missing object, missing privilege |
| `lastReceivedMessageTimestamp` | Last event notification received on the channel. The channel may be shared with **other pipes** |
| `lastForwardedMessageTimestamp`, `lastForwardedFilePath` | Last notification forwarded to **this** pipe (only for files in the path it watches) |
| `channelErrorMessage` | GCS and Azure: error reading the notification channel. On GCS `no monitoring permission` means the Monitoring Viewer role is missing |
| `pendingFileCount` | Files queued. Grows while `PAUSED` (expected). Grows while `RUNNING` with a fixed `oldestFileTimestamp`: contact Support |
| `notificationChannelName` | SQS queue or similar. Compare with `notification_channel` in `SHOW PIPES` |

Received but not forwarded: the notifications are for other paths. Received recently but forwarded long ago: check the pipe path and `PATTERN` (Snowpipe forwards on path only, so `PATTERN` can filter every file while `lastForwardedMessageTimestamp` stays recent).

If files load late but `pendingFileCount` stays low, the pipe may be **throttled**. Look for `pipe_throttled` events (recorded only if `LOG_EVENT_LEVEL` is `WARN` or more verbose).

**Execution states**

| State | Meaning | Action |
|-------|---------|--------|
| `PAUSED` | Paused on the pipe, its schema, or the account | `SHOW PARAMETERS LIKE 'PIPE_EXECUTION_PAUSED' IN PIPE p` and read `level`. Resume with `ALTER PIPE p SET PIPE_EXECUTION_PAUSED = FALSE`. A budget custom action can also pause pipes |
| `PAUSED` for **more than 14 days** (stale), or ownership changed while paused | Plain resume doesn't work | `SYSTEM$PIPE_FORCE_RESUME('p', 'staleness_check_override')`. Add `ownership_transfer_check_override` for an ownership change |
| `READ_ONLY` | Pipe or table is in a **secondary** database | Loads after you promote the secondary to primary |
| `FAILING_OVER` | After failover, load metadata still syncing | None. New files can still load |
| `STOPPED_CLONED` | Pipe is in a **cloned** database or schema. It collects no notifications and can't be paused | If the `COPY` names the source table (fully qualified, or `schema.table` in a cloned schema), resuming would load into the **source** table and duplicate data. Recreate the pipe in the clone |
| `STOPPED_STAGE_ALTERED` | Stage `URL` changed. Every pipe using that stage stops | Recreate the pipes, then load missed files |
| `STOPPED_STAGE_DROPPED`, `STOPPED_NOTIFICATION_INTEGRATION_DROPPED` | Object dropped or replaced | Recreate the object, then recreate the pipe |
| `STOPPED_FILE_FORMAT_DROPPED` | Named file format dropped (listed in the function reference) | Not covered in the troubleshooting page |
| `STOPPED_MISSING_TABLE` | Target table dropped or renamed | `UNDROP TABLE`, rename back, or create a table with the same name. **No pipe recreate needed.** Files that arrived meanwhile were **not queued** and must be loaded |
| `STALLED_STAGE_PERMISSION_ERROR` | Can't access the external stage | Fix the integration and cloud permissions. Run `LIST` on the stage and call `SYSTEM$PIPE_STATUS` again to recheck. Recreate the pipe only if the stage `URL` changed |
| `STALLED_COMPILATION_ERROR`, `STALLED_INITIALIZATION_ERROR`, `STALLED_EXECUTION_ERROR` | Error preparing or running the pipe's `COPY` | Read `error`. Check the stage, table, file format and the pipe **owner's privileges**. For compile errors check `invalid_reason` in `DESC PIPE` or `SHOW PIPES`. Recreate only to change the statement |
| `STALLED_INTERNAL_ERROR`, `STOPPED_BY_SNOWFLAKE_ADMIN`, `STOPPED_FEATURE_DISABLED`, `STOPPED_MISSING_PIPE` | Internal | Contact Snowflake Support |

[Back to contents](#contents)

### 1.3.5 Snowpipe: files that never load

With auto-ingest, a pipe loads only files it gets **event notifications** for. If a file is absent from `COPY_HISTORY` altogether, likely causes:

- Files were staged **before** notifications were configured.
- The pipe was **paused more than 14 days**, so queued files were dropped.
- Files arrived while the **target table was missing**.
- Files are **outside the pipe path** or filtered by `PATTERN`.
- The writer doesn't send the event Snowpipe listens for (S3 multipart, ADLS Gen2).
- A notification failed to arrive.

| Case | Cause | Fix |
|------|-------|-----|
| **S3 large files** don't load | Bucket notification lists only `s3:ObjectCreated:Put/Post/Copy`. Multipart uploads (AWS CLI default above **8 MiB**, typically 8 to 16 MiB) send `s3:ObjectCreated:CompleteMultipartUpload` | Notify on **All object create events**, or add `CompleteMultipartUpload`. Then load earlier files |
| S3: all pipes on an SNS topic stop | An admin **deleted the SQS subscription** Snowflake created on the topic | Wait **72 hours** then recreate every pipe with the same topic, or create a **differently named topic** and recreate the pipes on it |
| S3: notifications stopped | Bucket event notification no longer sends `s3:ObjectCreated` to the queue in `notification_channel` (`SHOW PIPES`), or for SNS or EventBridge the topic subscription is gone | Restore the notification or subscription, then load missed files |
| **ADLS Gen2** files don't load | Some third-party clients don't call **`FlushWithClose`**, so Azure sends no event | Call the ADLS Gen2 REST API to flush and close. Also check the Event Grid subscription doesn't filter out `FlushWithClose` |
| **GCS** delayed or missed | Notification must send **`OBJECT_FINALIZE`** in **JSON payload** format and its prefix must cover the pipe path. A message with no payload is **discarded silently** | Fix the notification |
| GCS | Another application pulls from the same **Pub/Sub subscription**, so each consumer sees only some messages | Use a **separate subscription** for Snowflake |
| GCS | Service account needs **Pub/Sub Subscriber** on the subscription and **Monitoring Viewer** on the project. Without Monitoring Viewer, `CREATE PIPE` fails with `Could not monitor` | Grant the roles. If removed later, loading continues but `numOutstandingMessagesOnChannel` is inaccurate and `channelErrorMessage` shows `no monitoring permission` |
| Gov versus commercial regions | Event notifications can't cross government and commercial regions | Automated loading doesn't work. Keep account and bucket in the same type |
| `Remote file '<path>' was not found` | File was deleted or moved before the load, credentials invalid, or `COPY ... PURGE = TRUE` removed it | Delay lifecycle rules. **Never purge files a pipe also loads** |
| `Failed to access remote file: access denied` or `[Access Denied (Status Code: 403; Error Code: AccessDenied)]` | Cloud storage rejected the read | Check integration or credentials and permissions on bucket and files |

**REST API (`insertFiles`) errors**

| HTTP code | Meaning |
|-----------|---------|
| `400` | Invalid request: no files, a path over **1,024 bytes**, missing parameter, or pipe is `STOPPED_CLONED` |
| `401` | Invalid or expired JWT. Message `JWT token is invalid` (vendor code 390144) |
| `403` | Role has privileges on the pipe but not the one the endpoint needs |
| `404` | Pipe name not recognized, or no privileges on the pipe, database or schema |
| `429` | Rate limit exceeded, or `insertFiles` with **more than 5,000 files**. Files are **not queued**. Split the list and retry after a delay |

JWT checks: signed with the private key matching the user's public key (compare `RSA_PUBLIC_KEY_FP` or `RSA_PUBLIC_KEY_2_FP` in `DESCRIBE USER`), account identifier and user name in **uppercase**, and token under **1 hour** old.

Status endpoints: `insertReport` and `loadHistoryScan`. For `429` on `loadHistoryScan`, call less often with a narrower range or use `insertReport`.

[Back to contents](#contents)

### 1.3.6 Snowpipe: errors in files, notifications and VALIDATE_PIPE_LOAD

- Default Snowpipe `ON_ERROR` is `SKIP_FILE`. A file with errors gets status `Load failed` and **nothing from it loads**.
- `ON_ERROR = CONTINUE` gives `Partially loaded`. The valid rows stay if you reload the file later.

**VALIDATE_PIPE_LOAD**

```sql
SELECT * FROM TABLE(INFORMATION_SCHEMA.VALIDATE_PIPE_LOAD(
  PIPE_NAME  => 'mydb.myschema.orders_pipe',
  START_TIME => DATEADD('hour', -24, CURRENT_TIMESTAMP())));
```

- Covers the pipe's load history, **last 14 days**. A recreated pipe has no history.
- Returns nothing if there were no errors.
- **Returns a user error** if the pipe's COPY uses `MATCH_BY_COLUMN_NAME` or **transforms semi-structured data** (JSON, Avro, ORC, Parquet, XML). It supports CSV transforms.
- Doesn't return `CHECK` violations.
- Privileges: pipe owner, or all of `MONITOR` on the pipe (or `MONITOR EXECUTION`), `USAGE` on external stage (or `READ` on internal), `SELECT` and `INSERT` on the table.
- Output columns are the same as `VALIDATE`.

**Error notifications**

| Item | Detail |
|------|--------|
| Purpose | Push a message to your cloud messaging service when a file **fails to load** |
| Services | AWS: **SNS standard topic** (FIFO unsupported). Google Cloud: Pub/Sub. Azure: Event Grid custom topic. Must match the cloud of your **Snowflake account**, not of the files |
| Integration | Notification integration with `TYPE = QUEUE` and `DIRECTION = OUTBOUND`. Email, webhook and inbound integrations don't work |
| Set on a pipe | `CREATE PIPE ... ERROR_INTEGRATION = my_int AS COPY ...` or `ALTER PIPE p SET ERROR_INTEGRATION = my_int` (no recreate, keeps load metadata) |
| Privileges | `CREATE NOTIFICATION INTEGRATION` or `CREATE INTEGRATION` on the account (default ACCOUNTADMIN only). `USAGE` on the integration for the **pipe owner**. `OPERATE` or `OWNERSHIP` on an existing pipe |
| Silent failure | If the owner loses `USAGE` on the integration, notifications **stop without an error** and loading continues |
| Test | `SYSTEM$SEND_SNOWFLAKE_NOTIFICATION(SNOWFLAKE.NOTIFICATION.APPLICATION_JSON('...'), SNOWFLAKE.NOTIFICATION.INTEGRATION('my_int'))`. `NOTIFICATION_HISTORY` shows failures |
| Delivery | **At least once**. Use `messageId` to drop duplicates |
| Reports only the **first** error per file | |
| Covers | Auto-ingest, REST API `insertFiles`, Kafka connector using the Snowpipe method |

Notifications do **not** report:
- **Partially loaded files**: with `ON_ERROR = CONTINUE` a message is sent only if **no rows** load. With `SKIP_FILE_<n>` or `SKIP_FILE_<n>%`, only for files that reach the error limit. Use default `SKIP_FILE` to be notified about every file with an error.
- Files that fail from **repeated internal errors** (check copy history).
- **Pipe-level problems** (stopped, stalled, unreadable channel). Use Snowpipe events in an event table plus an alert.
- Files that **never reach Snowpipe**. Create a scheduled alert that calls `SYSTEM$PIPE_STATUS` and checks how long ago the pipe last loaded.

[Back to contents](#contents)

### 1.3.7 Recovering and reloading files

**Before you recreate a pipe**, write down when it stopped (`lastIngestedTimestamp`). After recreation, `SYSTEM$PIPE_STATUS` no longer shows it and `COPY_HISTORY` loses the old pipe's loads.

**What kind of missed file is it?**

| Missed file | Where it shows | How to load it |
|-------------|----------------|----------------|
| Failed to load (access denied, remote file not found) | `COPY_HISTORY` with `STATUS = 'Load failed'` | **Stays in load metadata**, so `REFRESH` won't queue it. Reload it (below) |
| Never queued (no notification, table missing) | Not in history | `ALTER PIPE ... REFRESH` or `COPY INTO` |

**`ALTER PIPE ... REFRESH`**

```sql
ALTER PIPE p REFRESH;                                                 -- last 7 days
ALTER PIPE p REFRESH PREFIX = '2026/10/' MODIFIED_AFTER = '2026-10-01T00:00:00-07:00';
```

- Queues only files the pipe **and the table** haven't processed (skips files `COPY INTO` already loaded). Failed files count as processed.
- Covers only the **last 7 days**.
- For a new pipe, run it after configuring notifications to pick up earlier files.
- **After recreating a pipe, always add `MODIFIED_AFTER`.** The new pipe has no load metadata, so without it files the old pipe loaded are loaded again.
- Needs `OPERATE` or `OWNERSHIP` on the pipe, `USAGE` on external stage (or `READ` on internal), `USAGE` on a named file format, `INSERT` on the table.

**Files staged more than 7 days ago**
1. `COPY INTO` with the pipe's file format and options. Use `FILES` or `PATTERN` to select only missed files. `COPY INTO` doesn't check the pipe's metadata, so it will reload files the pipe already loaded.
2. Add `LOAD_UNCERTAIN_FILES = TRUE` if some files were last modified over **64 days** ago.
3. Add `ON_ERROR = SKIP_FILE` if the pipe's statement didn't set it (the `COPY INTO` default is `ABORT_STATEMENT`).
4. Configure auto-ingest if not done, then run `REFRESH` for the last 7 days.

**Reload a corrected file**: Snowpipe **ignores** a file whose path and name match its load metadata (**14 days**, including failed files). `REFRESH` does not help. Truncating the table does **not** clear pipe load metadata. Options:
- Stage the file under a **new name** (for example `_v2`). No warehouse needed.
- `COPY INTO ... FILES = ('path')` (uses a warehouse). Bulk and pipe metadata are separate.
- Recreate the pipe. Drops metadata for **all** files, so use only when you also need to change the pipe.
- First **delete rows** already loaded from the original file (partial loads), or the reload duplicates them. Finding them needs `METADATA$FILENAME` in the table, or `INCLUDE_METADATA` with `MATCH_BY_COLUMN_NAME`.
- With error logging on and `ON_ERROR = CONTINUE`, load corrected rows from **either** the error table **or** the corrected file, not both.

**When you must recreate a pipe** (`CREATE OR REPLACE PIPE`): changing the `COPY INTO` statement, `AUTO_INGEST`, `AWS_SNS_TOPIC` or `INTEGRATION`, or a changed stage `URL`. Use `ALTER PIPE` for `ERROR_INTEGRATION`, `LOG_EVENT_LEVEL`, comment and tags.

Safe recreate sequence:
1. Pause the pipe and save the time.
2. Wait for in-flight files (`pendingFileCount`).
3. Save `GET_DDL` and anything needed from load history.
4. Recreate from the DDL, keeping `AUTO_INGEST = TRUE` (if left out, no event-based loading).
5. Resume, and run `REFRESH ... MODIFIED_AFTER = '<saved time>'` within **7 days** of the pause.

Pause and ownership notes:
- A paused pipe keeps queueing new files for **up to 14 days**, then drops them.
- `GRANT OWNERSHIP` on a pipe **fails unless it is paused**. The new owner needs the owner privileges or the pipe stops after resume.
- A pipe resumed directly with `PIPE_EXECUTION_PAUSED = FALSE` isn't paused again by pausing its schema or account.

[Back to contents](#contents)

### 1.3.8 Duplicates and load time pitfalls

Find files loaded more than once:

```sql
SELECT file_name, COUNT(*) AS load_count,
       ARRAY_AGG(COALESCE(pipe_name, 'COPY INTO')) AS loaded_by
FROM TABLE(INFORMATION_SCHEMA.COPY_HISTORY(TABLE_NAME => 'orders',
     START_TIME => DATEADD('day', -14, CURRENT_TIMESTAMP())))
WHERE status IN ('Loaded', 'Partially loaded')
GROUP BY file_name HAVING COUNT(*) > 1;
```

Use `SNOWFLAKE.ACCOUNT_USAGE.COPY_HISTORY` (filter on `table_catalog_name`, `table_schema_name`, `table_name`) for older loads, or for loads by a **recreated pipe**.

| Cause of duplicates | Detail |
|---------------------|--------|
| **Overlapping pipes** | Paths `/path1/` and `/path1/path2/` both load the inner files |
| **No trailing slash** | Stage URL `s3://b/orders` or pipe path `orders` also matches `orders_archive/`. End URLs and paths with `/` |
| **Bulk `COPY` plus pipe on one location** | They keep **separate** load metadata |
| **Re-staged after 14 days** | Pipe record expired, so the same name loads again |
| **Recreated pipe** | Load metadata is gone, so `REFRESH` can reload. Use `MODIFIED_AFTER` |
| **Cloned pipe** | Naming the source table in the `COPY` loads into the source |
| **Partial load then reload** | With `ON_ERROR = CONTINUE`, rows from the first load stay |
| **Error table rows reloaded** | Inserting from the error table and also reloading the files, or running the `INSERT` twice before clearing |

**CURRENT_TIMESTAMP as load time**
- `CURRENT_TIMESTAMP` (and `CURRENT_DATE`, `CURRENT_TIME`, `GETDATE`, `LOCALTIME`, `LOCALTIMESTAMP`, `SYSDATE`, `SYSTIMESTAMP`) is evaluated when the load is **compiled in cloud services**, not when rows commit. Values can be hours earlier than `LAST_LOAD_TIME`.
- Instead use **`METADATA$START_SCAN_TIME`** in the COPY (bulk page), or enable **row timestamps** (`ROW_TIMESTAMP = TRUE`) and query `METADATA$ROW_LAST_COMMIT_TIME` (Snowpipe page).
- Row timestamps: rows loaded before enabling show `NULL`, an update replaces the value, and Iceberg tables are not supported.

[Back to contents](#contents)

### 1.3.9 Quick-reference

| Scenario | Answer |
|----------|--------|
| See which files loaded, partially loaded or failed | `COPY_HISTORY` `STATUS` |
| See every error in a file, without loading | `COPY INTO ... VALIDATION_MODE = RETURN_ALL_ERRORS` |
| See every error from a COPY already run | `VALIDATE(table, JOB_ID => query_id)`. Returns nothing if it used `ABORT_STATEMENT` |
| Snowpipe errors for the last day | `VALIDATE_PIPE_LOAD`. Fails if the pipe transforms semi-structured data or uses `MATCH_BY_COLUMN_NAME` |
| Keep every rejected row to fix and reload | Error logging plus `ON_ERROR = CONTINUE` |
| History older than 14 days | `SNOWFLAKE.ACCOUNT_USAGE.COPY_HISTORY` (365 days, up to 2 hours latency) |
| Pipe loads nothing, `executionState` is `RUNNING` | Check `lastReceivedMessageTimestamp` and `lastForwardedMessageTimestamp` |
| Pipe paused for over 14 days | `SYSTEM$PIPE_FORCE_RESUME('p', 'staleness_check_override')` |
| Target table dropped | `UNDROP TABLE` or recreate it. The pipe resumes. Load files that arrived meanwhile |
| Large S3 files never load | Add `s3:ObjectCreated:CompleteMultipartUpload` to the bucket notification |
| Fixed file with the same name not loaded | Pipe ignores names in its 14-day metadata. Stage under a new name or `COPY INTO ... FILES` |
| Load files staged before auto-ingest was set up | `ALTER PIPE ... REFRESH` (last 7 days). Older: `COPY INTO` |
| After recreating a pipe, avoid duplicates | `REFRESH ... MODIFIED_AFTER` with the pause time |
| Error notifications stop, loading continues | Pipe owner lost `USAGE` on the error integration |
| Get notified about a pipe going idle | Scheduled alert on `SYSTEM$PIPE_STATUS` |
| Stage fails after storage integration recreate | `ALTER STAGE ... SET STORAGE_INTEGRATION = name` |

[Back to contents](#contents)

### 1.3 Open items and flags

- Snowpipe **event table** setup (`LOG_EVENT_LEVEL`, event schema, alerts) was only seen as links. It belongs with 1.4. `NOTIFICATION_HISTORY` and the `pipe_throttled` event details were not fetched.
- `STOPPED_FILE_FORMAT_DROPPED` appears in the `SYSTEM$PIPE_STATUS` reference but not in the troubleshooting page. I gave no fix for it.
- The `LOAD_HISTORY` view was not fetched (HTTP 0 bytes). I only noted that `COPY_HISTORY` avoids its 10,000 row limit.
- The error table query and reload pages (`data-load-error-tables-*`) were not fetched. 1.1.9 holds the summary, and the reload steps above come from the "Manage Snowpipe" page.
- **Bulk-load data error messages** (for example numeric parse errors, `Found character ':' instead of field delimiter`) have no dedicated page in the URLs listed. I did not invent a list.
- The "Troubleshooting bulk data loads" page is short: `COPY_HISTORY`, `VALIDATION_MODE`, the storage integration error and the `CURRENT_TIMESTAMP` issue. Most other causes above come from the option pages in 1.1 and 1.2.
