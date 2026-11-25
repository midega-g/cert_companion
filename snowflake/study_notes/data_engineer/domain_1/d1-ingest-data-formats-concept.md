# Domain 1: Data Movement, ingest data formats (SnowPro Advanced: Data Engineer, DEA-C02)

Weight: **28%**. Domain 1 notes are split across 8 files: [d1-load-data-concept.md](d1-load-data-concept.md) (1.1: load data); this file, 1.2: ingest data of various formats; [d1-troubleshoot-ingestion-concept.md](d1-troubleshoot-ingestion-concept.md) (1.3: troubleshoot data ingestion); [d1-streams-and-tasks-concept.md](d1-streams-and-tasks-concept.md) (1.4.1 to 1.4.12: streams and tasks); [d1-continuous-pipelines-concept.md](d1-continuous-pipelines-concept.md) (1.4.13 to 1.4.26: dynamic tables, Snowpipe and developer tools); [d1-connectors-concept.md](d1-connectors-concept.md) (1.5: connectors); [d1-data-sharing-concept.md](d1-data-sharing-concept.md) (1.6: data sharing and consumption); [d1-tables-and-data-operations-concept.md](d1-tables-and-data-operations-concept.md) (1.7: tables and data operations). A section is added only after it is approved. The contents table below lists only the sections in this file.

## Contents

| Section | Topic | Status |
|---------|-------|--------|
| 1.2 | [Ingest data of various formats](#12-ingest-data-of-various-formats) | Approved |

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

**Schema evolution (full coverage in [1.7.6](d1-tables-and-data-operations-concept.md#176-schema-evolution))**
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
