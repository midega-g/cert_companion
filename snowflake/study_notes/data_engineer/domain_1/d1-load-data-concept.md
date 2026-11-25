# Domain 1: Data Movement, load data (SnowPro Advanced: Data Engineer, DEA-C02)

Weight: **28%**. Domain 1 notes are split across 8 files: this file, 1.1: load data; [d1-ingest-data-formats-concept.md](d1-ingest-data-formats-concept.md) (1.2: ingest data of various formats); [d1-troubleshoot-ingestion-concept.md](d1-troubleshoot-ingestion-concept.md) (1.3: troubleshoot data ingestion); [d1-streams-and-tasks-concept.md](d1-streams-and-tasks-concept.md) (1.4.1 to 1.4.12: streams and tasks); [d1-continuous-pipelines-concept.md](d1-continuous-pipelines-concept.md) (1.4.13 to 1.4.26: dynamic tables, Snowpipe and developer tools); [d1-connectors-concept.md](d1-connectors-concept.md) (1.5: connectors); [d1-data-sharing-concept.md](d1-data-sharing-concept.md) (1.6: data sharing and consumption); [d1-tables-and-data-operations-concept.md](d1-tables-and-data-operations-concept.md) (1.7: tables and data operations). A section is added only after it is approved. The contents table below lists only the sections in this file.

## Contents

| Section | Topic | Status |
|---------|-------|--------|
| 1.1 | [Load data into Snowflake](#11-given-a-data-set-load-data-into-snowflake) | Approved |

---

## 1.1 Given a data set, load data into Snowflake

**Sections in 1.1**

- [1.1.1 Ways to load](#111-ways-to-load)
- [1.1.2 Stages](#112-stages)
- [1.1.3 Supported file details](#113-supported-file-details)
- [1.1.4 Preparing data files](#114-preparing-data-files)
- [1.1.5 Planning and staging](#115-planning-and-staging)
- [1.1.6 Selecting files to load](#116-selecting-files-to-load)
- [1.1.7 Load metadata and duplicate prevention](#117-load-metadata-and-duplicate-prevention)
- [1.1.8 COPY INTO options that change results](#118-copy-into-options-that-change-results)
- [1.1.9 Error logging (error tables)](#119-error-logging-error-tables)
- [1.1.10 Simple transformations during load](#1110-simple-transformations-during-load)
- [1.1.11 Handling loaded files](#1111-handling-loaded-files)
- [1.1.12 Format-specific load options worth knowing](#1112-format-specific-load-options-worth-knowing)
- [1.1.13 Quick-reference: which tool?](#1113-quick-reference-which-tool)
- [Open items (not covered by the pages read)](#open-items-not-covered-by-the-pages-read)

### 1.1.1 Ways to load

| Method | Data arrives as | Compute | Latency | Use when |
|--------|-----------------|---------|---------|----------|
| Bulk load (`COPY INTO <table>`) | Files in a stage | **Your virtual warehouse** (you size it) | Batch | Scheduled or one-off loads of files |
| Snowpipe | Files in a stage | **Serverless**, Snowflake-managed | Typically within minutes | Files arrive throughout the day |
| Snowpipe Streaming | Rows written by API, **no files** | Serverless | Lowest | Near real-time streams |
| Snowflake Connector for Kafka | Kafka topic messages | Connector (can use Snowpipe Streaming) | Low | Loading from Apache Kafka |
| External table (alternative) | Data stays in cloud storage | Warehouse at query time | Query time | Query a lake without loading |

Key facts:
- `COPY INTO <table>` is the command behind both bulk loading and Snowpipe. A pipe wraps a COPY statement.
- Snowpipe charges a **fixed number of credits per GB loaded**, with no per-file charge. You don't size a warehouse.
- Snowpipe loads files into standard tables and Iceberg tables.
- To transform **after** loading, use dynamic tables, or streams and tasks.
- Row timestamps measure ingestion latency of a pipeline.

[Back to contents](#contents)

### 1.1.2 Stages

A stage is the location of data files. `COPY INTO` accepts internal and external stages.

| Stage type | Scope | Created with | Can ALTER or DROP? | Notes |
|------------|-------|--------------|--------------------|-------|
| **User** `@~` | One per user | Automatic | No | Files staged by one user, loadable into **multiple** tables |
| **Table** `@%table` | One per table | Automatic | No | Loadable into **one** table only. Not a separate object. No grantable privileges. You must own the table (OWNERSHIP) to stage, list, query or drop files |
| **Named internal** `@name` | Schema object | `CREATE STAGE` | Yes | Many users, many tables. Controlled by privileges |
| **Named external** `@name` | Schema object | `CREATE STAGE URL=...` | Yes | Stores the URL, access settings and format defaults for S3, GCS or Azure |

```sql
-- Upload from local machine to an internal stage (PUT only works from a client such as SnowSQL)
PUT file:///data/mydata.csv @%t1/United_States/California/Los_Angeles/2016/06/01/11/;

-- Named external stage on a path
CREATE STAGE my_stage
  URL = 's3://mybucket/United_States/California/Los_Angeles/'
  STORAGE_INTEGRATION = my_int;   -- the docs example also shows CREDENTIALS=(...), but an integration avoids embedding keys

DESCRIBE STAGE my_stage;          -- shows the URL property (matters for Snowpipe PATTERN, see 1.1.5)
LIST @my_stage;
REMOVE @my_stage/path/;
```

Facts to remember:
- External stages work on **any** cloud platform hosting your account (S3, GCS, Azure can be loaded into any Snowflake account). Cross-region or cross-cloud loading can incur **data transfer charges**.
- **Archival storage classes that need restoring** (S3 Glacier Flexible Retrieval, Glacier Deep Archive, Azure Archive) can't be loaded.
- Stage reference formats: `@[ns.]int_stage[/path]`, `@[ns.]%table[/path]`, `@~[/path]`, `@[ns.]ext_stage[/path]`.
- Multi-location resilience (fail over a pipeline to storage in another region or cloud) needs **Business Critical or higher** plus account replication. It applies to bulk `COPY INTO` and Snowpipe **auto-ingest**. **Snowpipe Streaming and Openflow don't support it.**

[Back to contents](#contents)

### 1.1.3 Supported file details

| Item | Supported |
|------|-----------|
| Local files | Staged first (PUT) into an internal stage, then loaded |
| Cloud sources | S3, GCS, Azure (Blob, ADLS Gen2, GPv1, GPv2) |
| Formats | Delimited (CSV, TSV), JSON, Avro, ORC, Parquet, XML, plus unstructured |
| Encoding, delimited files | Default **UTF-8**. Set others with `ENCODING` (for example `ISO88591`, `WINDOWS1252`, `SHIFTJIS`, `UTF16`) |
| Encoding, semi-structured | **UTF-8 only** |
| tar archives | **Not supported** (including compressed tar) |
| Uncompressed files staged | **Auto-gzipped** unless compression is disabled |
| Pre-compressed files | gzip, bzip2, deflate, raw_deflate, Brotli, Zstandard. Auto-detected, **except Brotli**, which must be stated explicitly |
| Encryption, internal stages | Server-side AES-256 always. Client-side 128-bit key by default (256-bit configurable) |
| Already-encrypted files | Loadable from external storage if you supply the key |

[Back to contents](#contents)

### 1.1.4 Preparing data files

**File sizing**
- Target **100-250 MB compressed** per file (or larger).
- Parallel load operations **cannot exceed the number of files**. One huge file does not parallelize.
- Avoid files of 100 GB or more. A load running past **24 hours** can be aborted with **nothing committed**.
- Aggregate small files, split large ones (split by line so records don't span chunks, for example `split -l 100000 file.csv pages`).
- Exception: large uncompressed RFC4180 CSV files (over 128 MB) can be scanned in parallel when `MULTI_LINE = FALSE`, `COMPRESSION = NONE` and `ON_ERROR` is `ABORT_STATEMENT` or `CONTINUE`.
- **Snowpipe:** if it takes more than a minute to accumulate 100-250 MB, create a (smaller) file about **once per minute**. Staging more often than once per minute doesn't guarantee lower latency. Amazon Data Firehose can batch with a buffer size and buffer interval (for example 60 seconds).

**Object size limits**

| Type | Limit |
|------|-------|
| VARCHAR, VARIANT, OBJECT, ARRAY | 128 MB |
| BINARY, GEOGRAPHY, GEOMETRY | 64 MB |

- **Default VARCHAR size is 16 MB** (8 MB for BINARY). For larger columns, state the size: `VARCHAR(134217728)`.
- `ALTER TABLE ... ALTER COLUMN c SET DATA TYPE VARCHAR(134217728)` works for VARCHAR. **BINARY length can't be altered**, so recreate the table.
- VARIANT, OBJECT, ARRAY, GEOGRAPHY and GEOMETRY can hold large objects without specifying a length. Older functions and procedures taking VARIANT, VARCHAR or BINARY may need to be recreated without a length.
- Old drivers fail with error `100067 (54000)` when a result exceeds 16 MB. Example minimum versions: Python connector 3.10.0, JDBC 3.17.0, ODBC 3.6.0, Spark connector 3.0.0.

**Delimited text (CSV)**
- Quote fields that contain the delimiter or a carriage return. Escape quotes inside quoted fields.
- Keep the column count consistent across rows (otherwise `ERROR_ON_COLUMN_COUNT_MISMATCH`).
- Numbers: no embedded commas (`123,456`), decimal point for fractions. Oracle NUMBER without scale loses decimals in Snowflake unless a scale is defined.
- Oracle DATE that holds time must map to **TIMESTAMP**.
- Invalid dates such as `0000-00-00` **error at load time**.

**Semi-structured data and subcolumnarization**
- When loaded into VARIANT, Snowflake extracts up to **200 elements per partition, per table** into columnar form (limit raised only through Support).
- **Not extracted:** elements that contain **any JSON `null`**, and elements that hold **multiple data types** (for example `{"foo":1}` and `{"foo":"1"}`).
- Non-extracted elements force a scan of the whole structure per row, so queries are slower.
- Fixes: single native type per element, and `STRIP_NULL_VALUES = TRUE` if nulls just mean "missing".

[Back to contents](#contents)

### 1.1.5 Planning and staging

- **Separate warehouses for loading and querying.** Loads can hurt query performance.
- With well-sized files, a **Small, Medium or Large** warehouse is usually enough. X-Large or bigger burns credits with no gain unless you load **hundreds or thousands of files at once**.
- **Organize stage paths** by source and date (for example `app/location/2016/07/01/11/`). A narrow path means one COPY loads exactly that slice, and concurrent COPY statements can each take a different slice.
- Smaller directories help: S3 sends a directory listing with each COPY, so fewer files per directory is faster.
- Load from the **most granular path** you can.

[Back to contents](#contents)

### 1.1.6 Selecting files to load

| Option | Speed | Limit | Notes |
|--------|-------|-------|-------|
| Path / prefix | Fast | None | Include a name prefix: `FROM @%t1/path/mydata` |
| `FILES = ('a.csv','b.csv')` | **Fastest** | **Max 1,000 files** | Explicit list |
| `PATTERN = '<regex>'` | **Slowest** | None | Good for named-order exports |

**PATTERN is applied differently:**
- **Bulk COPY** applies the regex to the **entire** storage location in the FROM clause.
- **Snowpipe** trims the path segments of the stage URL (see `DESCRIBE STAGE`) and applies the regex only to the **remaining** path and file name.
- For Snowpipe, prefer **cloud event filtering** (S3 key prefix filtering, Event Grid, Pub/Sub) over PATTERN to cut cost, noise and latency.

```sql
COPY INTO load1 FROM @%load1/data1/ FILES = ('test1.csv', 'test2.csv', 'test3.csv');
COPY INTO people_data FROM @%people_data/data1/ PATTERN = '.*person_data[^0-9{1,3}$$].csv';
```

[Back to contents](#contents)

### 1.1.7 Load metadata and duplicate prevention

Snowflake keeps **per-table** load metadata: file name, size, ETag, rows parsed, last load timestamp, and errors. **It expires after 64 days.**

| Condition | Result |
|-----------|--------|
| File `LAST_MODIFIED` is **64 days or newer** | Load status known. Not reloaded |
| `LAST_MODIFIED` older than 64 days, but the file was loaded successfully within 64 days **or** the table's initial load was within 64 days | Load status still known |
| `LAST_MODIFIED` older than 64 days **and** the table's initial load older than 64 days **and** any past load of the file older than 64 days | Status **unknown**. COPY **skips the file by default** |

`LAST_MODIFIED` is when the file was first staged, or last modified, whichever is later.

**Loading files with unknown status**

| Option | Behavior |
|--------|----------|
| `LOAD_UNCERTAIN_FILES = TRUE` | Uses load metadata where it exists to avoid duplicates, **and** also loads files whose metadata expired. **Preferred** for "don't duplicate" |
| `FORCE = TRUE` | Ignores load metadata, loads **all** files, **can duplicate data** |

> Look-alike: wiping the table first (`DELETE`, `TRUNCATE`) is not the way to avoid duplicates for files that are only partly new. It does not address the skipped-file problem and discards good data. This matches the study guide sample question 1, where `LOAD_UNCERTAIN_FILES = TRUE` (option C) is what the docs support. The guide's listed answer of D conflicts with this.

**Concurrent COPY statements:** when a COPY starts, Snowflake marks the referenced files with a load status, which stops parallel COPYs from loading the same file. Failed files are marked "load failed" and can be loaded by a later COPY. For **highly concurrent** COPY on the **same table**, use **Snowpipe**, which is built for that. Otherwise, space COPY statements out.

[Back to contents](#contents)

### 1.1.8 COPY INTO options that change results

| Option | Values and default | Effect |
|--------|--------------------|--------|
| `ON_ERROR` | `CONTINUE`, `SKIP_FILE`, `SKIP_FILE_<n>`, `'SKIP_FILE_<n>%'`, `ABORT_STATEMENT`. **Default bulk: `ABORT_STATEMENT`. Default Snowpipe: `SKIP_FILE`** | Error handling for the load |
| `SIZE_LIMIT` | bytes, default none | COPY stops starting new files once the total passes the limit. **At least one file is always loaded** |
| `PURGE` | `FALSE` | Deletes files after successful load. **If the purge fails, no error is returned** |
| `FORCE` | `FALSE` | Reload everything |
| `LOAD_UNCERTAIN_FILES` | `FALSE` | See 1.1.7 |
| `ENFORCE_LENGTH` | **`TRUE`** | Error if a string exceeds the column length |
| `TRUNCATECOLUMNS` | **`FALSE`** | Reverse logic of `ENFORCE_LENGTH`. Use only one of the two |
| `RETURN_FAILED_ONLY` | `FALSE` | Statement result lists only failed files |
| `MATCH_BY_COLUMN_NAME` | `CASE_SENSITIVE`, `CASE_INSENSITIVE`, `NONE` | Map semi-structured data to table columns by name |
| `INCLUDE_METADATA` | `(col = METADATA$FILENAME, ...)` | Fill a column with file metadata. **Needs `MATCH_BY_COLUMN_NAME`**. For CSV also set `ERROR_ON_COLUMN_COUNT_MISMATCH = FALSE` |
| `INFER_NESTED_TYPES` | `FALSE` | With schema evolution, creates structured OBJECT, ARRAY, MAP columns. Can't be combined with a `SELECT` transform |
| `LOAD_MODE` | `FULL_INGEST` (default), `ADD_FILES_COPY` | **Iceberg only:** Parquet into a Snowflake-managed Iceberg table. `ADD_FILES_COPY` server-side copies raw Iceberg-compatible Parquet, no transformation |
| `CLUSTER_AT_INGEST_TIME` | TRUE or FALSE | Pre-sorts data by the target table's clustering keys before commit. **Only with Snowpipe Streaming high-performance architecture**, and the table must have clustering keys |

**`ON_ERROR` details**
- `CONTINUE`: keeps loading a file after an error. Reports a **maximum of one error per file** in the result. `ROWS_PARSED - ROWS_LOADED` = number of rows with errors.
- `SKIP_FILE`: skips a file on any error. It **buffers the entire file**, so it is slower than `CONTINUE` and `ABORT_STATEMENT`. Wasteful on large files with a few bad rows.
- `SKIP_FILE_10`: skip when the file has **10 or more** error rows. `'SKIP_FILE_10%'`: skip when error rows are **more than 10%**.
- `ABORT_STATEMENT`: stops on the first error. Aborted loads **don't appear in `COPY_HISTORY`**. Look in `QUERY_HISTORY` instead.
- Rows that violate a `CHECK` constraint are rejected the same way, per `ON_ERROR`. A **hybrid table** supports only `ABORT_STATEMENT`.
- Unsupported combinations that cause inconsistent `ON_ERROR` behavior: `SELECT DISTINCT` in a transform, and COPY into clustered tables (in general).

**Validating before loading**

```sql
COPY INTO t FROM @s VALIDATION_MODE = RETURN_10_ROWS;   -- first 10 rows, fails on first error
COPY INTO t FROM @s VALIDATION_MODE = RETURN_ERRORS;    -- all errors across files
COPY INTO t FROM @s VALIDATION_MODE = RETURN_ALL_ERRORS;-- also errors from files partly loaded earlier with ON_ERROR = CONTINUE

SELECT * FROM TABLE(VALIDATE(t, JOB_ID => '_last'));     -- errors from a previous load
```

- `VALIDATION_MODE` **validates instead of loading**. It does not load.
- It **does not support transformations** in the COPY (the statement errors) and is **not supported for Iceberg tables**.
- Neither `VALIDATION_MODE` nor `VALIDATE` returns **CHECK constraint** violations. Use **error logging** with `ON_ERROR = CONTINUE` for those.

[Back to contents](#contents)

### 1.1.9 Error logging (error tables)

- Turn on error logging for a table and Snowflake records rows that DML, `COPY INTO` and Snowpipe **can't write**, in the table's **error table**. You can query, fix and reload them.
- `ON_ERROR` still decides which rejected rows are recorded:
  - `CONTINUE`: every rejected row.
  - `SKIP_FILE` (default for Snowpipe): **one error per skipped file**.
  - `ABORT_STATEMENT` (default for bulk): **no errors recorded**. So a COPY without `ON_ERROR` records nothing.
  - `SKIP_FILE_<n>` and `'SKIP_FILE_<n>%'`: **error logging isn't supported**.

[Back to contents](#contents)

### 1.1.10 Simple transformations during load

`COPY INTO` supports these without a separate step:
- Column reordering
- Column omission
- Casts
- Truncating strings that exceed the target length

File column count and order need not match the table.

```sql
COPY INTO t (id, name)
  FROM (SELECT $1, $3 FROM @my_stage/path)
  FILE_FORMAT = (TYPE = CSV SKIP_HEADER = 1);
```

Limits of COPY transformations:
- Supported file types: CSV, JSON, Avro, ORC, Parquet, XML. Applies to bulk loading and Snowpipe.
- **Not supported:** `FLATTEN`, `JOIN`, `GROUP BY` (aggregates), a `WHERE` clause on the FROM, `ORDER BY`, `LIMIT`, `FETCH`, `TOP`. Only a subset of functions is allowed.
- `SELECT DISTINCT` is not fully supported and can cause inconsistent `ON_ERROR` behavior.
- `MATCH_BY_COLUMN_NAME` and `INFER_NESTED_TYPES` **can't be combined** with a transforming `SELECT`. The error is `match_by_column_name is not supported with copy transform`.
- `ERROR_ON_COLUMN_COUNT_MISMATCH` is ignored when transforming.
- `VALIDATION_MODE` can't be used with a transforming COPY.
- `FLATTEN` is allowed when you query staged files with `CREATE TABLE AS SELECT` (the docs example does this), but not inside `COPY INTO`. Otherwise load into a VARIANT column first, then flatten.

[Back to contents](#contents)

### 1.1.11 Handling loaded files

- **Don't remove staged files until the load succeeds.** Check `COPY_HISTORY` and its `STATUS` column. If the status is `Load in progress`, removing the file can cause a **partial load and data loss**.
- Remove with `PURGE = TRUE` in the COPY, or run `REMOVE @stage/path` afterward. Removing also **speeds later loads**, because COPY scans fewer files to check whether they were loaded.
- Since a failed `PURGE` raises no error, run `LIST` periodically.

[Back to contents](#contents)

### 1.1.12 Format-specific load options worth knowing

| Option | Applies to | Purpose |
|--------|------------|---------|
| `STRIP_NULL_VALUES = TRUE` | JSON | Removes OBJECT or ARRAY elements holding `null`. A VARIANT `null` is stored as the text "null", not SQL NULL, and wastes storage |
| `STRIP_OUTER_ARRAY = TRUE` | JSON | Loads each array element as a row |
| `TRIM_SPACE = TRUE` | CSV | Removes a leading space before an opening quote. Combine with `FIELD_OPTIONALLY_ENCLOSED_BY = '0x22'` |
| `SKIP_HEADER`, `PARSE_HEADER` | CSV | Skip header rows, or read column names from the header |
| `ERROR_ON_COLUMN_COUNT_MISMATCH` | CSV | Error if the column counts differ |
| `ENCODING` | CSV | Character set, default UTF-8 |
| `USE_VECTORIZED_SCANNER` | Parquet | Vectorized Parquet reader |
| `COMPRESSION` | All | `AUTO` by default. **Set Brotli explicitly** |

[Back to contents](#contents)

### 1.1.13 Quick-reference: which tool?

| Scenario | Answer |
|----------|--------|
| Hundreds of files each hour, loaded by schedule | Bulk `COPY INTO` with a dedicated warehouse |
| Files land continuously, no warehouse management | Snowpipe (serverless) |
| App sends rows directly, no files, lowest latency | Snowpipe Streaming |
| Kafka topics | Kafka connector (optionally with Snowpipe Streaming) |
| Query lake data without loading | External table |
| Many concurrent COPYs on one table | Move to Snowpipe |
| Files older than 64 days being skipped | `LOAD_UNCERTAIN_FILES = TRUE` (not `FORCE`, which duplicates) |
| Check data without loading | `VALIDATION_MODE` |
| See errors from a past load | `VALIDATE` function |
| Aborted COPY not in `COPY_HISTORY` | Search `QUERY_HISTORY` |

[Back to contents](#contents)

### Open items (not covered by the pages read)

- Snowpipe internals (auto-ingest versus REST API, `SYSTEM$PIPE_STATUS`, `PIPE_USAGE_HISTORY`) belong in 1.4.
- Schema evolution (`ENABLE_SCHEMA_EVOLUTION`) is covered in [1.7.6](d1-tables-and-data-operations-concept.md#176-schema-evolution). A short pointer is in 1.2.8.

[Back to contents](#contents)
