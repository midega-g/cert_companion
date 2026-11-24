# Domain 1: Data Movement (SnowPro Advanced: Data Engineer, DEA-C02)

Weight: **28%**. Domain 1 notes are split across five files: this file, 1.1 to 1.3: loading and ingestion; [d1-streams-and-tasks-concept.md](d1-streams-and-tasks-concept.md) (1.4.1 to 1.4.12: streams and tasks); [d1-continuous-pipelines-concept.md](d1-continuous-pipelines-concept.md) (1.4.13 to 1.4.26: dynamic tables, Snowpipe and developer tools); [d1-connectors-concept.md](d1-connectors-concept.md) (1.5: connectors); [d1-sharing-and-tables-concept.md](d1-sharing-and-tables-concept.md) (1.6 to 1.7: sharing and tables). A section is added only after it is approved. The contents table below lists only the sections in this file.

## Contents

| Section | Topic | Status |
|---------|-------|--------|
| 1.1 | [Load data into Snowflake](#11-given-a-data-set-load-data-into-snowflake) | Approved |
| 1.2 | [Ingest data of various formats](#12-ingest-data-of-various-formats) | Approved |
| 1.3 | [Troubleshoot data ingestion](#13-troubleshoot-data-ingestion) | Approved |

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
- Schema evolution (`ENABLE_SCHEMA_EVOLUTION`) is covered in [1.7.6](d1-sharing-and-tables-concept.md#176-schema-evolution). A short pointer is in 1.2.8.

[Back to contents](#contents)

---

## 1.2 Ingest data of various formats

**Sections in 1.2**

- [1.2.1 Kinds of data and where each lands](#121-kinds-of-data-and-where-each-lands)
- [1.2.2 File format objects](#122-file-format-objects)
- [1.2.3 CSV options](#123-csv-options)
- [1.2.4 JSON, Avro, ORC, Parquet and XML options](#124-json-avro-orc-parquet-and-xml-options)
- [1.2.5 Compression](#125-compression)
- [1.2.6 Semi-structured data in VARIANT](#126-semi-structured-data-in-variant)
- [1.2.7 Querying staged files and metadata columns](#127-querying-staged-files-and-metadata-columns)
- [1.2.8 INFER_SCHEMA and building tables from files](#128-infer_schema-and-building-tables-from-files)
- [1.2.9 Storage integrations](#129-storage-integrations)
- [1.2.10 Stage encryption](#1210-stage-encryption)
- [1.2.11 Unstructured data, URLs and directory tables](#1211-unstructured-data-urls-and-directory-tables)
- [1.2.12 Quick-reference](#1212-quick-reference)
- [1.2 Open items and flags](#12-open-items-and-flags)

### 1.2.1 Kinds of data and where each lands

| Kind | Formats | Where it lands | Notes |
|------|---------|----------------|-------|
| Structured | CSV (any delimiter), also Parquet, ORC, Avro with a fixed schema | Columns of a table | File needs a file format. Default is CSV, `,` field delimiter, newline record delimiter, UTF-8 |
| Semi-structured | JSON, Avro, ORC, Parquet, XML | VARIANT, OBJECT or ARRAY column, or separate columns | No schema needed up front. Snowflake converts to its internal format |
| Unstructured | Images, audio, video, PDFs, other binary or text documents | Stays in a stage. Access by URL or the `FILE` data type | Files are not loaded into table columns. Metadata and URLs can be loaded |

Load and unload support by format (from `CREATE FILE FORMAT`):

| Format | Load | Unload |
|--------|------|--------|
| CSV | Yes | Yes |
| JSON | Yes (NDJSON or comma-separated documents) | Yes, **NDJSON only** |
| Parquet | Yes | Yes |
| Avro | Yes | **No** |
| ORC | Yes | **No** |
| XML | Yes | **No** |

Ways to load semi-structured data:
- Into one VARIANT column: `CREATE TABLE t (v VARIANT); COPY INTO t FROM @s FILE_FORMAT = (TYPE = JSON);`
- Into separate columns with a `SELECT` transform in COPY (see 1.1.10), or with `MATCH_BY_COLUMN_NAME`.
- Detect the structure with `INFER_SCHEMA` and create the table from it (1.2.8).
- `INSERT ... SELECT PARSE_JSON('{...}')` for a single value.

[Back to contents](#contents)

### 1.2.2 File format objects

```sql
CREATE OR REPLACE FILE FORMAT my_csv
  TYPE = CSV
  FIELD_DELIMITER = '|'
  SKIP_HEADER = 1
  FIELD_OPTIONALLY_ENCLOSED_BY = '"'
  NULL_IF = ('NULL', '');
```

- `TYPE` default is **CSV**.
- Format options can be set in a **named file format object**, on a **stage**, or directly in the `COPY INTO` (inline `FILE_FORMAT = (TYPE = ... )`).
- Repeating an option with different values in one statement is an **error** (for example `TYPE = 'CSV' ... TYPE = 'JSON'`).
- `CREATE OR REPLACE FILE FORMAT` drops and recreates the object with a new hidden ID. **External tables that referenced it lose the link**, so recreate each external table. `GET_DDL` returns the DDL.
- `OR REPLACE` and `IF NOT EXISTS` can't be used together.
- When the stage definition holds the file format, a query on the stage can omit `FILE_FORMAT`.

[Back to contents](#contents)

### 1.2.3 CSV options

| Option | Default | What it does |
|--------|---------|--------------|
| `FIELD_DELIMITER` | `,` | Up to 20 characters. Can't be a substring of the record delimiter, or the reverse. Non-ASCII needs hex bytes |
| `RECORD_DELIMITER` | newline (`\r\n` also treated as newline) | Record separator |
| `SKIP_HEADER` | `0` | Skips that many **lines** (counted by line breaks, not by the delimiters) |
| `PARSE_HEADER` | `FALSE` | Uses the first row as column names. Only for `INFER_SCHEMA` and for `MATCH_BY_COLUMN_NAME` loads. **Can't be used with `SKIP_HEADER`.** Not supported for external tables. When `FALSE`, columns are named `c1`, `c2`, ... |
| `FIELD_OPTIONALLY_ENCLOSED_BY` | `NONE` | `'"'` or `'\''`. Use `0x27` or `''` for single quote |
| `ESCAPE` | not read | Escape character for **enclosed** fields on load |
| `ESCAPE_UNENCLOSED_FIELD` | not read | Escape character for unenclosed fields. The `NULL_IF` default `\N` assumes it is `\\` |
| `TRIM_SPACE` | `FALSE` | Removes spaces around enclosed values. Fixes a leading space before the opening quote |
| `NULL_IF` | `\N` | Strings that become SQL NULL. **Applies to every column type**. `2` in the list converts both `'2'` and `2` |
| `EMPTY_FIELD_AS_NULL` | `TRUE` | Two successive delimiters (`,,`) load as NULL. If `FALSE`, string columns get `''` and other types **error** |
| `ERROR_ON_COLUMN_COUNT_MISMATCH` | `TRUE` | Error when field count differs from table columns. If `FALSE`, extra fields are dropped and missing ones load NULL. **Records of varying length still error.** Ignored in a transforming COPY |
| `MULTI_LINE` | `TRUE` | If `FALSE` and a record delimiter appears inside a field, the record is an error |
| `SKIP_BLANK_LINES` | `FALSE` | Blank lines otherwise cause an end-of-record error |
| `SKIP_BYTE_ORDER_MARK` | `TRUE` | If `FALSE`, a BOM can cause an error or merge into the first column |
| `REPLACE_INVALID_CHARACTERS` | `FALSE` | `TRUE` swaps invalid UTF-8 for U+FFFD. `FALSE` errors |
| `ENCODING` | `UTF8` | Character set of the source |
| `BINARY_FORMAT` | `HEX` | `HEX`, `BASE64` or `UTF8` for BINARY columns |
| `DATE_FORMAT`, `TIME_FORMAT`, `TIMESTAMP_FORMAT` | `AUTO` per docs list | Parse formats. **Not supported by `INFER_SCHEMA`** |
| `COMPRESSION` | `AUTO` | See 1.2.5 |

Examples of `TRIM_SPACE` with `FIELD_DELIMITER='|'` and `FIELD_OPTIONALLY_ENCLOSED_BY='"'`: `|" Hello world "|` loads as ` Hello world ` (inner spaces kept). `| "Hello world" |` loads as `Hello world`.

[Back to contents](#contents)

### 1.2.4 JSON, Avro, ORC, Parquet and XML options

| Format | Option | Default | Effect |
|--------|--------|---------|--------|
| JSON | `STRIP_OUTER_ARRAY` | `FALSE` | Removes `[ ]` so each element is a row |
| JSON | `STRIP_NULL_VALUES` | `FALSE` | Removes object fields and array elements that are JSON `null`. `[null,null,3]` becomes `[,,3]` and `{"a":null,"c":123}` becomes `{"c":123}` |
| JSON | `ALLOW_DUPLICATE` | `FALSE` | Allows duplicate field names. Only the **last** is kept |
| JSON | `MULTI_LINE` | `TRUE` | If `FALSE`, a newline inside a JSON record is an error |
| JSON | `ENABLE_OCTAL` | `FALSE` | Parse octal numbers |
| JSON | `IGNORE_UTF8_ERRORS` | `FALSE` | Alternative syntax for `REPLACE_INVALID_CHARACTERS` |
| Parquet | `BINARY_AS_TEXT` | `TRUE` | Read columns with no logical type as UTF-8 text. Docs **recommend `FALSE`** |
| Parquet | `USE_LOGICAL_TYPE` | not read | Interpret Parquet logical types on load, query and schema detection. Not supported for unload |
| Parquet | `USE_VECTORIZED_SCANNER` | not read | Vectorized scanner for load and staged query. Used in the Iceberg `INFER_SCHEMA` examples |
| Parquet | `TRIM_SPACE` | `FALSE` | Only applies when loading Parquet into columns with `MATCH_BY_COLUMN_NAME` |
| Parquet | `COMPRESSION` | `AUTO` | Page lists `AUTO`, `LZO`, `SNAPPY`, `NONE`. Marked for **unloading and external tables** |
| XML | `PRESERVE_SPACE` | `FALSE` | Keep leading and trailing spaces in element content |
| XML | `STRIP_OUTER_ELEMENT` | `FALSE` | Drops the outer element so second-level elements become separate documents |
| XML | `DISABLE_AUTO_CONVERT` | `FALSE` | Stops automatic conversion of numbers and booleans from text |
| Avro, ORC | `TRIM_SPACE`, `REPLACE_INVALID_CHARACTERS`, `NULL_IF` | Listed on the page. Defaults not read | Same meaning as for CSV |
| XML | `REPLACE_INVALID_CHARACTERS`, `SKIP_BYTE_ORDER_MARK` | Defaults not read | Same meaning as for CSV |

[Back to contents](#contents)

### 1.2.5 Compression

| `COMPRESSION` value | Notes |
|---------------------|-------|
| `AUTO` (default) | On load, detects the algorithm **except Brotli**. On unload, gzip |
| `GZIP`, `BZ2`, `ZSTD`, `DEFLATE`, `RAW_DEFLATE` | Zstandard v0.8 and higher. `DEFLATE` has a zlib header (RFC1950). `RAW_DEFLATE` has none (RFC1951) |
| `BROTLI` | **Must be set explicitly** on load and unload |
| `NONE` | Files are not compressed |

- The option list differs by format. CSV, JSON and XML include `BZ2`. The Avro list shown does not.
- Unloaded files use gzip by default. Parquet unloads use Snappy by default.
- Tar archives are not supported (1.1.3).

[Back to contents](#contents)

### 1.2.6 Semi-structured data in VARIANT

- A VARIANT holds any type, including OBJECT and ARRAY. An OBJECT or ARRAY holds VARIANT values.
- VARIANT maximum is **128 MB uncompressed**. In practice it is usually smaller because of internal overhead.
- Choose **VARIANT** when you don't yet know the queries. Snowflake says storage and query speed are very similar to relational columns for regular data using native types.
- **Flatten into columns** (better pruning, less storage) when the data has:
  - dates and timestamps stored as strings, especially non-ISO 8601
  - numbers inside strings
  - arrays
- Values not native to JSON (dates, timestamps) are stored as **strings** in VARIANT.
- To test, load into VARIANT, `FLATTEN` the needed keys into a second table, and compare query times.

**Two kinds of NULL**

| Kind | Meaning | Shown as |
|------|---------|----------|
| SQL NULL | Missing or unknown | `NULL` |
| JSON null ("VARIANT NULL") | Explicit null in the document. Stored as the string `null` in a VARIANT | `null` |

```sql
SELECT PARSE_JSON('{ "a": null }'):a;              -- null (JSON null)
SELECT TO_CHAR(PARSE_JSON('{ "a": null }'):a);     -- NULL (SQL NULL): cast to a string
```

- An absent key (`:b` above) returns SQL NULL.
- `STRIP_NULL_VALUES = TRUE` also helps subcolumnarization (1.1.4).

[Back to contents](#contents)

### 1.2.7 Querying staged files and metadata columns

```sql
SELECT t.$1, t.$2
FROM @mystage1 (FILE_FORMAT => myformat, PATTERN => '.*data.*[.]csv.gz') t;

SELECT METADATA$FILENAME, METADATA$FILE_ROW_NUMBER, t.$1
FROM @mystage1/data1.csv.gz (FILE_FORMAT => myformat) t;
```

- Works on internal stages and **named** external stages. Intended for **simple queries**, inspecting files before load or after unload. It does not replace loading into tables.
- Columns are `$1`, `$2`, ... by position. For semi-structured files use `$1:path.to.element`.
- `FILE_FORMAT` is optional when the files are default CSV or the stage defines the format. Without the right format, `|`-delimited files return `$1 = 'a|b'` and `$2 = NULL`.
- External stages that list "directory blobs" (paths ending `/`) can make queries fail. Use `PATTERN`.
- Avoid patterns that filter many files.

**Metadata columns** (available for internal and external stages):

| Column | Type | Meaning |
|--------|------|---------|
| `METADATA$FILENAME` | text | File name **including full path** |
| `METADATA$FILE_ROW_NUMBER` | number | Row number in the file |
| `METADATA$FILE_CONTENT_KEY` | text | **Checksum** of the file |
| `METADATA$FILE_LAST_MODIFIED` | TIMESTAMP_NTZ | Last modified time of the file |
| `METADATA$START_SCAN_TIME` | TIMESTAMP_LTZ | When Snowflake started scanning the file for the query or load |

- Metadata columns can **only be queried by name**. They are **not** in `SELECT *`, `SHOW`, `DESCRIBE` or `INFORMATION_SCHEMA` output.
- They **can't be inserted into existing rows**. Load them with a `COPY INTO ... FROM (SELECT METADATA$FILENAME, ..., t.$1 FROM @s t)` transform, or with `INCLUDE_METADATA` plus `MATCH_BY_COLUMN_NAME` (1.1.8).

[Back to contents](#contents)

### 1.2.8 INFER_SCHEMA and building tables from files

```sql
SELECT * FROM TABLE(INFER_SCHEMA(
  LOCATION => '@mystage/json/',
  FILE_FORMAT => 'my_json_format'));

-- Create the table from the detected schema
CREATE TABLE mytable
  USING TEMPLATE (
    SELECT ARRAY_AGG(OBJECT_CONSTRUCT(*))
    FROM TABLE(INFER_SCHEMA(LOCATION => '@mystage/json/', FILE_FORMAT => 'my_json_format')));

-- Then load by column name
COPY INTO mytable FROM @mystage/json/
  FILE_FORMAT = (FORMAT_NAME = 'my_json_format')
  MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE;
```

**Supported files:** Parquet, Avro, ORC, JSON, CSV.

**Arguments**

| Argument | Default | Notes |
|----------|---------|-------|
| `LOCATION` | required | Named internal or external stage, or user stage `@~`. **Table stages are not supported.** Without a path, scans all subdirectories |
| `FILE_FORMAT` | required | Named file format object |
| `FILES` | none | Up to **1,000** names. Aborts if one is missing. For external stages you must supply the `/` separator |
| `IGNORE_CASE` | `FALSE` | `TRUE` returns column names in uppercase and the expression uses `GET_IGNORE_CASE` |
| `MAX_FILE_COUNT` | none | Limit files scanned. Can't choose which files. Use `FILES` to pick |
| `MAX_RECORDS_PER_FILE` | none | **CSV and JSON only.** Can reduce accuracy |
| `KIND` | `STANDARD` | `ICEBERG` returns Iceberg types. **Set it when inferring Parquet for Iceberg tables**, otherwise definitions may be wrong |
| `INFER_NESTED_TYPES` | `FALSE` | `TRUE` returns structured `OBJECT`, `ARRAY`, `MAP` types instead of VARIANT |

**Output columns:** `COLUMN_NAME`, `TYPE`, `NULLABLE`, `EXPRESSION` (like `$1:col::TYPE`), `FILENAMES`, `ORDER_ID`.

**Behaviors worth knowing**
- **CSV:** use `PARSE_HEADER = TRUE` in the file format to get real column names. Otherwise `c1`, `c2`. `SKIP_HEADER` can't be combined with `PARSE_HEADER = TRUE`.
- For CSV and JSON, **all columns come back NULLABLE**. For other types, nullability may apply to one file but not others.
- **All timestamp variants come back as `TIMESTAMP_NTZ`** with no time zone.
- JSON scientific notation (`1E2`) is `REAL`.
- `DATE_FORMAT`, `TIME_FORMAT`, `TIMESTAMP_FORMAT` (CSV and JSON) and JSON `TRIM_SPACE` are **not supported**.
- With `INFER_NESTED_TYPES = FALSE`, only the **first nesting level** is supported and nested columns are semi-structured. With `KIND => 'ICEBERG'` it **fails** instead.
- With `TRUE`: Parquet maps with non-string, non-integer keys are skipped **without a warning** (error with `KIND => 'ICEBERG'`). JSON objects become `OBJECT`, not `MAP`. ORC map columns must become `VARIANT`. Conflicting types: `NUMBER` is widened, others become `VARIANT` (`TEXT` for JSON).
- `ARRAY_AGG(OBJECT_CONSTRUCT(*))` can fail when the result exceeds **128 MB**. Select only `COLUMN_NAME`, `TYPE`, `NULLABLE`, and optionally `ORDER_ID` with `WITHIN GROUP (ORDER BY order_id)`.
- To make `INFER_NESTED_TYPES` apply when loading, also set the `INFER_NESTED_TYPES` **copy option** to `TRUE`.

**GENERATE_COLUMN_DESCRIPTION**

```sql
SELECT GENERATE_COLUMN_DESCRIPTION(ARRAY_AGG(OBJECT_CONSTRUCT(*)), 'table')
FROM TABLE(INFER_SCHEMA(LOCATION => '@mystage', FILE_FORMAT => 'my_parquet_format'));
```

- Second argument: `table`, `external_table` or `view`. It returns a formatted column list you paste into `CREATE`.
- `CREATE TABLE ... USING TEMPLATE` does it in one step. It also works for `CREATE EXTERNAL TABLE` and `CREATE ICEBERG TABLE`.

**Schema evolution (full coverage in [1.7.6](d1-sharing-and-tables-concept.md#176-schema-evolution))**
- Needs `ENABLE_SCHEMA_EVOLUTION = TRUE` on the table, `MATCH_BY_COLUMN_NAME` in the COPY, and `EVOLVE SCHEMA` or `OWNERSHIP` on the table. Snowpipe uses the pipe owner's role.
- For CSV with `PARSE_HEADER` and `MATCH_BY_COLUMN_NAME`, set `ERROR_ON_COLUMN_COUNT_MISMATCH = FALSE`.
- Works for COPY and Snowpipe, **not** `INSERT` and **not** tasks.

[Back to contents](#contents)

### 1.2.9 Storage integrations

A storage integration is a Snowflake object that holds a **generated IAM entity** for your cloud storage plus allowed and blocked locations. Users don't supply keys or tokens.

```sql
CREATE STORAGE INTEGRATION s3_int
  TYPE = EXTERNAL_STAGE
  STORAGE_PROVIDER = 'S3'
  ENABLED = TRUE
  STORAGE_AWS_ROLE_ARN = 'arn:aws:iam::001234567890:role/myrole'
  STORAGE_ALLOWED_LOCATIONS = ('s3://mybucket1/path1/', 's3://mybucket2/path2/')
  STORAGE_BLOCKED_LOCATIONS = ('s3://mybucket1/path1/sensitive/');

DESC INTEGRATION s3_int;     -- note STORAGE_AWS_IAM_USER_ARN and STORAGE_AWS_EXTERNAL_ID
GRANT USAGE ON INTEGRATION s3_int TO ROLE myrole;
GRANT CREATE STAGE ON SCHEMA public TO ROLE myrole;

CREATE STAGE my_s3_stage
  URL = 's3://mybucket1/path1/'
  STORAGE_INTEGRATION = s3_int;
```

| Item | Detail |
|------|--------|
| Types | `EXTERNAL_STAGE` (normal). Two `POSTGRES_*` types exist for Snowflake Postgres (preview) |
| Providers | `S3`, `GCS`, `AZURE` (Azure also needs `AZURE_TENANT_ID`) |
| `ENABLED` | Default `TRUE`. `FALSE` blocks new stages **and** existing stages lose access |
| `STORAGE_ALLOWED_LOCATIONS` | Required. `*` allows all buckets and paths. The stage URL must fall inside it |
| `STORAGE_BLOCKED_LOCATIONS` | Optional |
| `STORAGE_AWS_EXTERNAL_ID` | Optional. If omitted, Snowflake generates one |
| `STORAGE_AWS_OBJECT_ACL` | Optional, `bucket-owner-full-control` |
| `USE_PRIVATELINK_ENDPOINT` | Optional (S3 and Azure) |
| Sharing | One integration can back **many** stages |
| S3 identity | Snowflake creates **one IAM user per Snowflake account**, shared by all S3 integrations |

Setup flow for S3:
1. Create the IAM policy and role in AWS.
2. `CREATE STORAGE INTEGRATION` with the role ARN.
3. `DESC INTEGRATION` and read `STORAGE_AWS_IAM_USER_ARN` and `STORAGE_AWS_EXTERNAL_ID`.
4. Add them to the role's **trust relationship**.
5. Grant `USAGE` on the integration to roles that create stages.
6. Validate with `SYSTEM$VALIDATE_STORAGE_INTEGRATION`.

S3 permissions:
- Always: `s3:GetBucketLocation`, `s3:GetObject`, `s3:GetObjectVersion`, `s3:ListBucket`.
- Unload: add `s3:PutObject`.
- `PURGE` or `REMOVE`: add `s3:DeleteObject`.

Other points:
- In **government regions** and **China**, a storage integration works only from Snowflake accounts in the same region. Use `CREDENTIALS` on the stage instead.
- Unloading to another region or cloud has a **per-byte fee**.
- If the storage is on a different cloud, it must be in the public cloud, not a virtual private environment.

[Back to contents](#contents)

### 1.2.10 Stage encryption

**Internal stages** (`CREATE STAGE ... ENCRYPTION = (TYPE = ...)`)

| Type | What it does | Use for |
|------|--------------|---------|
| `SNOWFLAKE_FULL` (**default**) | Client-side encryption by the client during `PUT` (128-bit key by default, 256-bit via `CLIENT_ENCRYPTION_KEY_SIZE`), plus AES-256 server-side | General use, and **Tri-Secret Secure** |
| `SNOWFLAKE_SSE` | Server-side only, encrypted by the cloud service when files arrive | **Pre-signed URLs, file URLs, scoped URLs** on staged files |

- You **can't change the encryption type** after the stage exists.
- Default client-side encrypted files are **unreadable** through pre-signed, file or scoped URLs. Corrupt downloads usually mean the stage was not created with `SNOWFLAKE_SSE`.
- `SNOWFLAKE_SSE` does **not** support Tri-Secret Secure. Use `SNOWFLAKE_FULL` for that.
- SSE on internal stages is limited to newer clients (the page names JDBC 3.12.11 or higher).

**External stages** (encryption of files already in your bucket)

| Cloud | Options |
|-------|---------|
| S3 | `AWS_CSE` (needs `MASTER_KEY`, 128 or 256-bit, Base64, **symmetric**), `AWS_SSE_S3`, `AWS_SSE_KMS` (optional `KMS_KEY_ID`), `NONE` |
| GCS | `GCS_SSE_KMS` (optional `KMS_KEY_ID`, **ignored on load**), `NONE`. Default `NONE` |
| Azure | `AZURE_CSE` (needs `MASTER_KEY`), `NONE` |

- `AWS_CSE`: master key held in Snowflake. A key in AWS KMS is **not supported**. AWS V1 encryption standard only, **V2 not supported**.
- Giving a `MASTER_KEY` implies `AWS_CSE`.
- Pre-signed URLs require **server-side encryption** on the stage (internal or external).

[Back to contents](#contents)

### 1.2.11 Unstructured data, URLs and directory tables

Unstructured data stays in an internal or external stage. Snowflake supports accessing the files, sharing access URLs, loading URLs and metadata into tables, and processing the files.

**Three URL types**

| | Scoped URL | File URL | Pre-signed URL |
|---|-----------|----------|----------------|
| Function | `BUILD_SCOPED_FILE_URL(@stage, 'path')` | `BUILD_STAGE_FILE_URL(@stage, 'path')`, or the `FILE_URL` column of a directory table | `GET_PRESIGNED_URL(@stage, 'path', [seconds])` |
| Who can use it | **Only the user who generated it** | Any role with `USAGE` (external stage) or `READ` (internal stage) | **Anyone holding the URL**, no Snowflake login |
| Expiry | Until the query result cache expires (**24 hours**) | **Permanent** | `expiration_time`. Default **3600** seconds. Max **604800** (7 days). Max **3600** if the stage uses `AWS_ROLE`, and for Fabric OneLake |
| Auth to download | REST API, or click in Snowsight | REST API with OAuth token, or Snowsight | None. Open in a browser |
| Via a **secure view in a share** | Yes | **No** | Yes |
| Recommended use | Admin gives scoped access through a **view** (only roles on the view reach files). Query history records who used it | Custom apps | BI and reporting tools |
| Needs SSE stage | No | No | **Yes** |

- `GET_PRESIGNED_URL` returns a URL **even if the file does not exist**. A browser then shows `NoSuchKey`.
- For Azure, `GET_PRESIGNED_URL` needs a **storage integration**, not a SAS token.
- `BUILD_SCOPED_FILE_URL` has `use_privatelink_host_for_business_critical`, default `TRUE`.
- The REST API is `GET /api/files/<url path>`. Authenticate with OAuth (security integration for custom clients) or key-pair via the SQL API. The client must **allow redirects**.

**File functions**

| Function | Returns |
|----------|---------|
| `GET_STAGE_LOCATION` | Stage URL |
| `GET_RELATIVE_PATH` | Path relative to the stage, from an absolute path |
| `GET_ABSOLUTE_PATH` | Absolute path, from a relative one |
| `GET_PRESIGNED_URL` | Pre-signed URL |
| `BUILD_SCOPED_FILE_URL` | Scoped URL |
| `BUILD_STAGE_FILE_URL` | File URL |
| `TO_FILE` / `TRY_TO_FILE` | `FILE` object. `TRY_` returns NULL if missing or inaccessible |

**Directory tables**

- An **implicit object layered on a stage**, not a separate database object. It has **no grantable privileges** of its own. Works on internal and external stages.
- Stores file-level metadata, similar to an external table.

```sql
CREATE STAGE my_int_stage
  ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE')
  DIRECTORY = (ENABLE = TRUE);

CREATE STAGE mystage
  URL = 's3://load/files/'                -- must end with /
  STORAGE_INTEGRATION = my_storage_int
  DIRECTORY = (ENABLE = TRUE);

ALTER STAGE mystage REFRESH;                              -- required once after create (manual)
ALTER STAGE mystage REFRESH SUBPATH = '2024/01/31';       -- cheaper: narrow the listing
SELECT * FROM DIRECTORY(@mystage);
```

| Item | Detail |
|------|--------|
| Add to existing stage | `ALTER STAGE ... SET DIRECTORY = (ENABLE = TRUE)` |
| Columns returned by `DIRECTORY()` | `RELATIVE_PATH`, `SIZE`, `LAST_MODIFIED` (TIMESTAMP_TZ), `MD5`, `ETAG`, `FILE_URL` |
| `REFRESH` result statuses | `REGISTERED_NEW`, `REGISTERED_UPDATE`, `REGISTER_SKIPPED`, `REGISTER_FAILED`, `UNREGISTERED`, `UNREGISTER_FAILED` |
| Options (S3) | `ENABLE`, `REFRESH_ON_CREATE`, `AUTO_REFRESH`, `AWS_SNS_TOPIC` |
| Options (GCS, Azure) | `ENABLE`, `AUTO_REFRESH`, `REFRESH_ON_CREATE`, `NOTIFICATION_INTEGRATION` |
| Auto-refresh | Uses cloud **event notifications**. A **manual refresh on an external stage blocks automated refreshes** until it finishes |
| Manual refresh | Performs a list operation, slow and costly on big or fast-growing stages |
| Billing, auto-refresh | Shows as **Snowpipe charges**. Estimate with `PIPE_USAGE_HISTORY`. History via `AUTO_REFRESH_REGISTRATION_HISTORY` (needs ACCOUNTADMIN or global `MONITOR USAGE`) |
| Billing, manual refresh | Cloud services credits, **not** in `PIPE_USAGE_HISTORY` |

| Task | Privilege on stage |
|------|--------------------|
| `SELECT FROM DIRECTORY` | Internal: `READ`. External: `READ` or `USAGE` |
| `PUT` | Internal: `WRITE` |
| `REMOVE` | Internal: `WRITE`. External: `WRITE` or `USAGE` |
| `ALTER STAGE ... REFRESH` | Internal: `WRITE`. External: `WRITE` or `USAGE` |

Use directory tables to list files, join with a table of extra metadata in a view, or build a file-processing pipeline with Snowpark or external functions.

Download in Snowsight: click a scoped, pre-signed or file URL in the result grid.

[Back to contents](#contents)

### 1.2.12 Quick-reference

| Scenario | Answer |
|----------|--------|
| Create a table from Parquet files without typing columns | `CREATE TABLE ... USING TEMPLATE (SELECT ARRAY_AGG(OBJECT_CONSTRUCT(*)) FROM TABLE(INFER_SCHEMA(...)))` |
| CSV headers should become column names | `PARSE_HEADER = TRUE` in the file format (not with `SKIP_HEADER`) |
| Infer schema for Parquet destined for an Iceberg table | `KIND => 'ICEBERG'` |
| `INFER_SCHEMA` on a table stage | Not supported. Use a named or user stage |
| Brotli files fail to load | Set `COMPRESSION = BROTLI` explicitly |
| JSON file is one big array | `STRIP_OUTER_ARRAY = TRUE` |
| JSON nulls hurt query speed | `STRIP_NULL_VALUES = TRUE` |
| Convert VARIANT JSON null to SQL NULL | Cast to string, for example `TO_CHAR(v:a)` |
| Need file name in the loaded table | `METADATA$FILENAME` in a COPY `SELECT`, or `INCLUDE_METADATA` with `MATCH_BY_COLUMN_NAME` |
| Give one role temporary access to a staged file, no stage privileges | Scoped URL through a view |
| Open staged files from a BI tool without Snowflake login | Pre-signed URL, stage must use `SNOWFLAKE_SSE` |
| Share file access with another account | Secure view returning scoped or pre-signed URLs. **File URLs don't work** |
| Pre-signed URLs return corrupt files | Internal stage was created without `SNOWFLAKE_SSE`. Encryption type can't be changed, so recreate it |
| Stage on S3 without passing keys | Storage integration |
| Need Tri-Secret Secure on an internal stage | `SNOWFLAKE_FULL` |
| List unstructured files and their URLs | Directory table, `SELECT * FROM DIRECTORY(@stage)` |
| New files not appearing in directory table | `ALTER STAGE ... REFRESH`, or enable `AUTO_REFRESH` with event notifications |

[Back to contents](#contents)

### 1.2 Open items and flags

- **Docs conflict on directory tables for internal stages.** The "Manage directory tables" page says internal stage directory tables need manual refresh. The `CREATE STAGE` syntax lists `AUTO_REFRESH` for internal stages. I did not fetch the page that explains which is true. Treat internal stages as manual until checked.
- `USE_LOGICAL_TYPE` and `USE_VECTORIZED_SCANNER` defaults were not in the text I read.
- Per-format default values for `DATE_FORMAT`, `TIME_FORMAT` and `TIMESTAMP_FORMAT` were not read. I only recorded that `AUTO` is an accepted value.
- The GCS and Azure storage integration setup steps were not fetched. Only the S3 flow is described.
- Automated directory table refresh setup (SNS, Event Grid, Pub/Sub) is on a separate page I did not fetch.
- The Parquet `COMPRESSION` entry is marked "unloading and external tables" in the docs. It is easy to assume it applies to load.

[Back to contents](#contents)

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
