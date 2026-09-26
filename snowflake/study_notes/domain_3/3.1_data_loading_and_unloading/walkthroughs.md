# Subdomain 3.1: Data Loading & Unloading — End-to-End Walkthroughs

Companion to `concepts.md`. Each step shows setup → command → **what you actually see** (output, staged files, load results), following one continuous scenario: load a CSV of orders, then unload results.

> Convention:
> - 🟢 = success
> - 🔴 = error / rejected rows
> - Output blocks show the **actual command result**.

---

## Scenario Setup

```sql
USE ROLE SYSADMIN;
CREATE DATABASE IF NOT EXISTS load_demo;
CREATE SCHEMA IF NOT EXISTS load_demo.public;
USE SCHEMA load_demo.public;

CREATE OR REPLACE TABLE orders (
  order_id   INT,
  customer   STRING,
  amount     NUMBER(10,2),
  order_date DATE
);
```

Local file `orders.csv` we'll load:
```csv
order_id,customer,amount,order_date
1001,Alice,250.00,2026-09-01
1002,Brian,99.50,2026-09-02
1003,Carla,ABC,2026-09-03        <- bad amount (not numeric)
1004,David,120.00,2026-09-04
```

---

## 1. Create a File Format — End to End

```sql
CREATE OR REPLACE FILE FORMAT csv_orders
  TYPE = CSV
  FIELD_DELIMITER = ','
  SKIP_HEADER = 1
  FIELD_OPTIONALLY_ENCLOSED_BY = '"'
  NULL_IF = ('', 'NULL')
  COMPRESSION = AUTO;
```

Verify:
```sql
SHOW FILE FORMATS LIKE 'csv_orders';
DESC FILE FORMAT csv_orders;
```
```
+-------------+-------+---------+
| property    | value | default |
|-------------+-------+---------|
| TYPE        | CSV   | CSV     |
| SKIP_HEADER | 1     | 0       |
| FIELD_DELIMITER | ,  | ,       |
+-------------+-------+---------+
```

**Point driven home:** Defining the format **once** means every `COPY` and stage can reference `FORMAT_NAME = csv_orders` — no repeated inline options.

---

## 2. Create a Stage & Upload Files — End to End

### Named internal stage
```sql
CREATE OR REPLACE STAGE orders_stage
  FILE_FORMAT = csv_orders
  DIRECTORY = (ENABLE = TRUE);   -- enables a directory table
```

### Upload with PUT (run from SnowSQL, not the web worksheet)
```bash
snowsql> PUT file:///home/user/orders.csv @orders_stage AUTO_COMPRESS=TRUE;
```
🟢 What you see:
```
+------------+-----------------+-------------+-------------+--------------------+--------------------+----------+---------+
| source     | target          | source_size | target_size | source_compression | target_compression | status   | message |
|------------+-----------------+-------------+-------------+--------------------+--------------------+----------+---------|
| orders.csv | orders.csv.gz   |     142     |     118     | NONE               | GZIP               | UPLOADED |         |
+------------+-----------------+-------------+-------------+--------------------+--------------------+----------+---------+
```
> `AUTO_COMPRESS=TRUE` gzipped the file on upload — note `target: orders.csv.gz`.

### List what's staged
```sql
LIST @orders_stage;
```
```
+---------------------------+------+----------------------------------+-------------------------------+
| name                      | size | md5                              | last_modified                 |
|---------------------------+------+----------------------------------+-------------------------------|
| orders_stage/orders.csv.gz|  118 | a1b2c3...                        | Wed, 23 Sep 2026 18:50:00 GMT |
+---------------------------+------+----------------------------------+-------------------------------+
```

### External stage alternative (S3 via storage integration)
```sql
CREATE OR REPLACE STAGE orders_ext_stage
  URL = 's3://my-bucket/orders/'
  STORAGE_INTEGRATION = my_s3_int
  FILE_FORMAT = csv_orders;
```
**Point driven home:** `PUT`/`GET` + `AUTO_COMPRESS` only apply to **internal** stages. External stages point at files already in your cloud bucket.

---

## 3. Validate Before Loading — End to End

Dry run — report errors, load nothing:
```sql
COPY INTO orders
  FROM @orders_stage
  VALIDATION_MODE = 'RETURN_ERRORS';
```
🔴 What you see (the bad row surfaces without touching the table):
```
+------------------------------+------+-----------+------+--------+-----------+
| error                        | line | character | col  | row    | rejected  |
|------------------------------+------+-----------+------+--------+-----------|
| Numeric value 'ABC' is not   |  3   |    14     | AMOUNT| 3     | 1003,Carla,ABC,2026-09-03 |
| recognized                   |      |           |      |        |           |
+------------------------------+------+-----------+------+--------+-----------+
```

**Point driven home:** `VALIDATION_MODE` is a **safe preview** — you know row 3 will fail *before* committing any load. The table is still empty.

---

## 4. COPY INTO with Error Handling — End to End

### Attempt 1: default ON_ERROR (ABORT_STATEMENT)
```sql
COPY INTO orders FROM @orders_stage;
```
🔴 Whole load aborts on the bad row:
```
Error: Numeric value 'ABC' is not recognized
  File 'orders.csv.gz', line 3, column AMOUNT
Nothing was loaded.
```

### Attempt 2: ON_ERROR = CONTINUE (skip bad rows)
```sql
COPY INTO orders
  FROM @orders_stage
  ON_ERROR = 'CONTINUE';
```
🟢 What you see — good rows load, bad row skipped:
```
+------------------+--------+-------------+-------------+-------------+-------------------+
| file             | status | rows_parsed | rows_loaded | error_limit | errors_seen       |
|------------------+--------+-------------+-------------+-------------+-------------------|
| orders.csv.gz    | LOADED |     4       |     3       |     4       |     1             |
+------------------+--------+-------------+-------------+-------------+-------------------+
```

Confirm the table:
```sql
SELECT * FROM orders ORDER BY order_id;
```
```
+----------+----------+--------+------------+
| ORDER_ID | CUSTOMER | AMOUNT | ORDER_DATE |
|----------+----------+--------+------------|
|     1001 | Alice    | 250.00 | 2026-09-01 |
|     1002 | Brian    |  99.50 | 2026-09-02 |
|     1004 | David    | 120.00 | 2026-09-04 |   <- 1003 (Carla) skipped
+----------+----------+--------+------------+
```

**Point driven home:** `ON_ERROR = CONTINUE` loaded 3 of 4 rows and reported `errors_seen = 1`. `ABORT_STATEMENT` (default) would have loaded **zero**.

### Inspect errors from that COPY afterwards
```sql
SELECT * FROM TABLE(VALIDATE(orders, JOB_ID => '_last'));
```
```
+------------------------------+------+------+---------------------------+
| error                        | line | col  | rejected_record           |
|------------------------------+------+------+---------------------------|
| Numeric value 'ABC' not recognized | 3 | AMOUNT | 1003,Carla,ABC,2026-09-03 |
+------------------------------+------+------+---------------------------+
```

---

## 5. Load Idempotency — End to End

Re-run the same COPY:
```sql
COPY INTO orders FROM @orders_stage ON_ERROR = 'CONTINUE';
```
🟢 Nothing re-loads:
```
+---------------+-------------+-------------+
| file          | status      | rows_loaded |
|---------------+-------------+-------------|
| orders.csv.gz | LOAD_SKIPPED|     0       |   <- already loaded
+---------------+-------------+-------------+
```

Force a reload:
```sql
COPY INTO orders FROM @orders_stage ON_ERROR = 'CONTINUE' FORCE = TRUE;
```
```
| orders.csv.gz | LOADED | 3 |   <- loaded again (duplicates now possible)
```

**Point driven home:** Snowflake remembers loaded files (~64 days) and **skips** them by default — safe to re-run. `FORCE = TRUE` overrides this but risks duplicates.

---

## 6. Unloading Data — End to End

### Unload filtered results to the stage as Parquet
```sql
COPY INTO @orders_stage/export/
  FROM (SELECT * FROM orders WHERE amount > 100)
  FILE_FORMAT = (TYPE = PARQUET)
  HEADER = TRUE
  MAX_FILE_SIZE = 16777216;
```
🟢 What you see:
```
+-------------------------------------+-------+-------------+
| rows_unloaded | input_bytes | output_bytes | file        |
|---------------+-------------+--------------+-------------|
|      2        |    512      |    980       | export/data_0_0_0.parquet |
+---------------+-------------+--------------+-------------+
```

### List and download with GET
```sql
LIST @orders_stage/export/;
```
```bash
snowsql> GET @orders_stage/export/ file:///home/user/downloads/;
```
🟢
```
+-----------------------------+-------------+------------+---------+
| file                        | size        | status     | message |
|-----------------------------+-------------+------------+---------|
| data_0_0_0.parquet          |    980      | DOWNLOADED |         |
+-----------------------------+-------------+------------+---------+
```

**Point driven home:** Unloading can pull from a **query** (here filtering `amount > 100`), and by default writes **multiple files** for parallelism — use `SINGLE = TRUE` only if you must have one.

---

## 7. Directory Table — End to End

```sql
ALTER STAGE orders_stage REFRESH;    -- sync directory metadata
SELECT relative_path, size, last_modified
FROM DIRECTORY(@orders_stage);
```
```
+----------------------------+------+-------------------------------+
| RELATIVE_PATH              | SIZE | LAST_MODIFIED                 |
|----------------------------+------+-------------------------------|
| orders.csv.gz              | 118  | 2026-09-23 18:50:00           |
| export/data_0_0_0.parquet  | 980  | 2026-09-23 19:05:00           |
+----------------------------+------+-------------------------------+
```

**Point driven home:** A directory table turns "what files are on my stage?" into a **queryable table** — handy for pipelines and auditing staged files.

---

## Mental Model Recap

| Step | You run… | You see… | Key takeaway |
|------|----------|----------|--------------|
| File format | `CREATE FILE FORMAT` | reusable parse rules | Define once, reference everywhere |
| Stage + upload | `CREATE STAGE`, `PUT` | file gzipped & staged | PUT/GET = internal stages only |
| Validate | `VALIDATION_MODE=RETURN_ERRORS` | errors, nothing loaded | Safe preview before loading |
| Load | `COPY INTO <table>` + `ON_ERROR` | rows_loaded vs errors_seen | CONTINUE skips bad rows; default aborts all |
| Idempotency | re-run `COPY` | LOAD_SKIPPED | Loaded files skipped ~64 days; FORCE to redo |
| Unload | `COPY INTO <location>` | multiple output files | Can unload from a query; splits for parallelism |
| Directory table | `DIRECTORY(@stage)` | queryable file listing | Track staged files as a table |

> ⚠️ **Verify before exam/production:** exact `VALIDATE()`/`JOB_ID` syntax, directory-table refresh behavior, and `MAX_FILE_SIZE` limits change over time. Confirm against current Snowflake docs.
