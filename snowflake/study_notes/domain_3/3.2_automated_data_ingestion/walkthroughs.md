# Subdomain 3.2: Automated Data Ingestion — End-to-End Walkthroughs

Companion to `concepts.md`. Each feature is shown **end-to-end**: setup → apply → **what you actually see** (output, change records, refresh history). The examples build a small automated pipeline so you can see how the pieces connect.

> Convention:
> - 🟢 = success / rows present
> - Output blocks show the **actual result set or status**.

---

## Scenario Setup

```sql
USE ROLE SYSADMIN;
CREATE DATABASE IF NOT EXISTS ingest_demo;
CREATE SCHEMA IF NOT EXISTS ingest_demo.public;
USE SCHEMA ingest_demo.public;

-- Raw landing table (Snowpipe target)
CREATE OR REPLACE TABLE raw_orders (order_id INT, customer STRING, amount NUMBER);
-- Processed target
CREATE OR REPLACE TABLE orders_summary (customer STRING, total NUMBER, updated_at TIMESTAMP);
```

---

## 1. Snowpipe — End to End (auto-ingest from a stage)

### Step 1: Stage + pipe
```sql
CREATE OR REPLACE STAGE orders_stage
  URL = 's3://my-bucket/orders/'
  STORAGE_INTEGRATION = my_s3_int
  FILE_FORMAT = (TYPE = CSV SKIP_HEADER = 1);

CREATE OR REPLACE PIPE orders_pipe
  AUTO_INGEST = TRUE
  AS
  COPY INTO raw_orders
  FROM @orders_stage
  FILE_FORMAT = (TYPE = CSV SKIP_HEADER = 1);
```

### Step 2: Wire the event notification
```sql
-- Get the SQS/notification channel ARN to configure in S3
SHOW PIPES;
```
```
+--------------+-------------+-------------------------------------------------+
| name         | auto_ingest | notification_channel                            |
|--------------+-------------+-------------------------------------------------|
| ORDERS_PIPE  | true        | arn:aws:sqs:us-east-1:123:sf-snowpipe-abc...    |
+--------------+-------------+-------------------------------------------------+
```
> You paste that ARN into your S3 bucket's event notification config so new files ping Snowpipe.

### Step 3: What you see after a file lands
```sql
SELECT SYSTEM$PIPE_STATUS('orders_pipe');
```
```json
{
  "executionState": "RUNNING",
  "pendingFileCount": 0,
  "lastReceivedMessageTimestamp": "2026-09-23T19:10:02Z",
  "lastForwardedMessageTimestamp": "2026-09-23T19:10:03Z"
}
```
Confirm data loaded automatically (no manual COPY):
```sql
SELECT COUNT(*) FROM raw_orders;   -- grows as files arrive
```
```
+----------+
| COUNT(*) |
|----------|
|      500 |
+----------+
```

### Monitor load history
```sql
SELECT file_name, status, row_count, last_load_time
FROM TABLE(ingest_demo.INFORMATION_SCHEMA.COPY_HISTORY(
  TABLE_NAME => 'raw_orders',
  START_TIME => DATEADD('hour', -1, CURRENT_TIMESTAMP())));
```
```
+------------------+--------+-----------+---------------------+
| FILE_NAME        | STATUS | ROW_COUNT | LAST_LOAD_TIME      |
|------------------+--------+-----------+---------------------|
| orders/f1.csv    | LOADED |    250    | 2026-09-23 19:10:03 |
| orders/f2.csv    | LOADED |    250    | 2026-09-23 19:12:44 |
+------------------+--------+-----------+---------------------+
```

**Point driven home:** No warehouse, no manual command — files hit S3, the event notification wakes Snowpipe, and rows appear. `SYSTEM$PIPE_STATUS` and `COPY_HISTORY` are how you observe it.

---

## 2. Streams — End to End (change tracking)

### Step 1: Create a stream on the raw table
```sql
CREATE OR REPLACE STREAM orders_stream ON TABLE raw_orders;
```

### Step 2: Make some changes, then read the stream
```sql
INSERT INTO raw_orders VALUES (9001, 'Alice', 100), (9002, 'Brian', 200);
UPDATE raw_orders SET amount = 150 WHERE order_id = 9001;
```
```sql
SELECT order_id, customer, amount,
       METADATA$ACTION, METADATA$ISUPDATE
FROM orders_stream;
```
🟢 What you see — the net changes with CDC metadata:
```
+----------+----------+--------+-----------------+-------------------+
| ORDER_ID | CUSTOMER | AMOUNT | METADATA$ACTION | METADATA$ISUPDATE |
|----------+----------+--------+-----------------+-------------------|
|     9001 | Alice    |  150   | INSERT          | TRUE              |  <- update shows as
|     9001 | Alice    |  100   | DELETE          | TRUE              |     delete + insert
|     9002 | Brian    |  200   | INSERT          | FALSE             |
+----------+----------+--------+-----------------+-------------------+
```

### Step 3: Offset behavior
```sql
SELECT SYSTEM$STREAM_HAS_DATA('orders_stream');   -- TRUE
```
> A plain `SELECT` from the stream does **not** advance the offset. Consuming it in a DML statement (next section) does.

**Point driven home:** Streams don't store data — they expose *changes since the last consume*. An UPDATE appears as a paired DELETE+INSERT with `METADATA$ISUPDATE = TRUE`.

---

## 3. Tasks — End to End (process the stream on a schedule)

### Step 1: Create a task that runs only when the stream has data
```sql
CREATE OR REPLACE TASK process_orders_task
  WAREHOUSE = etl_wh
  SCHEDULE = '5 MINUTE'
  WHEN SYSTEM$STREAM_HAS_DATA('orders_stream')
AS
  MERGE INTO orders_summary s
  USING (
    SELECT customer, SUM(amount) AS amt
    FROM orders_stream
    WHERE METADATA$ACTION = 'INSERT'
    GROUP BY customer
  ) c
  ON s.customer = c.customer
  WHEN MATCHED THEN UPDATE SET total = s.total + c.amt, updated_at = CURRENT_TIMESTAMP()
  WHEN NOT MATCHED THEN INSERT (customer, total, updated_at)
       VALUES (c.customer, c.amt, CURRENT_TIMESTAMP());
```

### Step 2: Tasks start suspended — resume it
```sql
ALTER TASK process_orders_task RESUME;
SHOW TASKS;
```
```
+---------------------+---------+------------+-------------+
| name                | state   | warehouse  | schedule    |
|---------------------+---------+------------+-------------|
| PROCESS_ORDERS_TASK | started | ETL_WH     | 5 MINUTE    |
+---------------------+---------+------------+-------------+
```

### Step 3: Run it manually (or wait for schedule) and inspect history
```sql
EXECUTE TASK process_orders_task;

SELECT name, state, scheduled_time, completed_time, error_message
FROM TABLE(ingest_demo.INFORMATION_SCHEMA.TASK_HISTORY(
  TASK_NAME => 'PROCESS_ORDERS_TASK'))
ORDER BY scheduled_time DESC;
```
```
+---------------------+-----------+---------------------+---------------------+
| NAME                | STATE     | SCHEDULED_TIME      | COMPLETED_TIME      |
|---------------------+-----------+---------------------+---------------------|
| PROCESS_ORDERS_TASK | SUCCEEDED | 2026-09-23 19:20:00 | 2026-09-23 19:20:04 |
| PROCESS_ORDERS_TASK | SKIPPED   | 2026-09-23 19:15:00 | 2026-09-23 19:15:00 |  <- stream empty
+---------------------+-----------+---------------------+---------------------+
```

### Step 4: Confirm the stream was consumed
```sql
SELECT * FROM orders_summary;
SELECT SYSTEM$STREAM_HAS_DATA('orders_stream');   -- now FALSE (offset advanced)
```
```
+----------+-------+---------------------+
| CUSTOMER | TOTAL | UPDATED_AT          |
|----------+-------+---------------------|
| Alice    |  150  | 2026-09-23 19:20:04 |
| Brian    |  200  | 2026-09-23 19:20:04 |
+----------+-------+---------------------+
```

**Point driven home:** The task ran the MERGE, which **consumed** the stream (offset advances → `STREAM_HAS_DATA` flips to FALSE). When the stream is empty the task shows **SKIPPED**, saving compute.

---

## 4. Task Graph (DAG) — End to End

```sql
-- Root task
CREATE OR REPLACE TASK load_task WAREHOUSE=etl_wh SCHEDULE='10 MINUTE'
  AS INSERT INTO staging SELECT * FROM raw_orders;
-- Child runs AFTER the root
CREATE OR REPLACE TASK transform_task WAREHOUSE=etl_wh
  AFTER load_task
  AS INSERT INTO final SELECT customer, SUM(amount) FROM staging GROUP BY customer;

-- Resume children first, root last
ALTER TASK transform_task RESUME;
ALTER TASK load_task RESUME;
```
View the graph dependencies:
```sql
SELECT name, predecessors, state FROM TABLE(
  ingest_demo.INFORMATION_SCHEMA.CURRENT_TASK_GRAPHS());
```

**Point driven home:** `AFTER` builds a DAG. Always **resume children before the root**, because a running root would otherwise try to trigger not-yet-resumed children.

---

## 5. Dynamic Tables — End to End (declarative alternative)

The Stream+Task MERGE above can be replaced by **one** dynamic table.

```sql
CREATE OR REPLACE DYNAMIC TABLE orders_summary_dt
  TARGET_LAG = '5 minutes'
  WAREHOUSE = etl_wh
AS
  SELECT customer, SUM(amount) AS total
  FROM raw_orders
  GROUP BY customer;
```

### What you see — it self-populates and self-refreshes
```sql
SELECT * FROM orders_summary_dt;   -- always reflects raw_orders within ~5 min
```
```
+----------+-------+
| CUSTOMER | TOTAL |
|----------+-------|
| Alice    |  150  |
| Brian    |  200  |
+----------+-------+
```

### Inspect refresh behavior
```sql
SELECT name, state, refresh_action, refresh_trigger, data_timestamp
FROM TABLE(ingest_demo.INFORMATION_SCHEMA.DYNAMIC_TABLE_REFRESH_HISTORY())
ORDER BY data_timestamp DESC;
```
```
+-------------------+-----------+----------------+-----------------+
| NAME              | STATE     | REFRESH_ACTION | REFRESH_TRIGGER |
|-------------------+-----------+----------------+-----------------|
| ORDERS_SUMMARY_DT | SUCCEEDED | INCREMENTAL    | SCHEDULED       |  <- only changed rows
| ORDERS_SUMMARY_DT | SUCCEEDED | FULL           | MANUAL          |  <- initial refresh
+-------------------+-----------+----------------+-----------------+
```

**Point driven home:** No stream, no task, no MERGE — you declared the **target query** and a **TARGET_LAG**, and Snowflake keeps it fresh, preferring **INCREMENTAL** refreshes. This is the modern replacement for many Stream+Task pipelines.

---

## Mental Model Recap

| Feature | You run… | You see… | Key takeaway |
|---------|----------|----------|--------------|
| Snowpipe | `CREATE PIPE AUTO_INGEST=TRUE` | rows appear, `PIPE_STATUS` RUNNING | Serverless, event-driven file loads |
| Snowpipe Streaming | SDK / Kafka connector | rows in seconds | Row-level, no files |
| Streams | `CREATE STREAM ON TABLE` | changed rows + METADATA$ columns | CDC; offset advances on DML consume |
| Tasks | `CREATE TASK ... WHEN STREAM_HAS_DATA` | SUCCEEDED / SKIPPED history | Cron for SQL; resume children first |
| Task DAG | `AFTER` | dependency graph | Chain steps; resume root last |
| Dynamic Tables | `CREATE DYNAMIC TABLE ... TARGET_LAG` | auto-refresh, INCREMENTAL | Declarative Stream+Task replacement |

> ⚠️ **Verify before exam/production:** exact `INFORMATION_SCHEMA` function names (`TASK_HISTORY`, `DYNAMIC_TABLE_REFRESH_HISTORY`, `CURRENT_TASK_GRAPHS`), Snowpipe notification setup per cloud, and dynamic-table incremental-refresh eligibility change over time. Confirm against current Snowflake docs.
