# Subdomain 3.1: Data Loading and Unloading

Success here means knowing the **methods** for getting data into and out of Snowflake, and the **best practices** for each. This note differentiates the approaches and the objects involved: file formats, stages, `COPY INTO`, and error handling.

---

## Overview: The Loading/Unloading Pipeline

Loading and unloading both revolve around three pieces working together:

```
   FILES  ──►  STAGE  ──►  COPY INTO  ──►  TABLE     (loading)
   TABLE  ──►  COPY INTO  ──►  STAGE  ──►  FILES     (unloading)
              (uses a FILE FORMAT to interpret/produce the files)
```

| Piece | Role |
|-------|------|
| **File Format** | Describes *how* to parse (load) or produce (unload) files — delimiter, compression, type |
| **Stage** | The *location* where files sit (internal to Snowflake, or external cloud storage) |
| **COPY INTO** | The *command* that moves data between files (stage) and tables |

---

## Loading Methods (differentiate these)

| Method | Best for | How |
|--------|----------|-----|
| **Bulk loading (`COPY INTO`)** | Batches of files already in a stage | Uses a **virtual warehouse**; you run `COPY INTO`. |
| **Snowpipe** | Continuous / near-real-time micro-batches | **Serverless**, auto-ingests files as they arrive (event-driven or REST). |
| **Snowpipe Streaming** | Row-level streaming (lowest latency) | Writes rows directly via API, no files. |
| **Web UI (Snowsight) load** | Small, ad-hoc files | Wizard for quick loads of a limited file size. |

> This subdomain focuses on **bulk loading with `COPY INTO`** and staging. Snowpipe belongs to continuous-loading topics but is worth knowing as the contrast.

---

## 1. File Formats

**What it is:** A named object (or inline set of options) that tells Snowflake **how to interpret** files during load, or **how to produce** them during unload.

**Supported types:**
- **Structured/semi-structured:** `CSV` (delimited), `JSON`, `AVRO`, `ORC`, `PARQUET`, `XML`.

**Common options:**
- `TYPE` — the format (CSV, JSON, PARQUET, ...).
- `FIELD_DELIMITER`, `RECORD_DELIMITER`, `SKIP_HEADER` (CSV).
- `COMPRESSION` — `AUTO`, `GZIP`, `BZ2`, `ZSTD`, `SNAPPY`, `NONE`.
- `FIELD_OPTIONALLY_ENCLOSED_BY` — e.g., `'"'` to handle quoted fields.
- `NULL_IF`, `ERROR_ON_COLUMN_COUNT_MISMATCH`, `DATE_FORMAT`, etc.

**Best practice:** Create a **named file format** (`CREATE FILE FORMAT`) and reuse it across stages and `COPY` statements rather than repeating inline options — consistent and maintainable.

---

## 2. Stages — Create and Use

A **stage** is a pointer to where files live. Two broad kinds:

### Internal Stages (managed by Snowflake)
| Type | Reference | Use |
|------|-----------|-----|
| **User stage** | `@~` | Files private to one user |
| **Table stage** | `@%tablename` | Files destined for a specific table |
| **Named internal stage** | `@stagename` | Shared, reusable; **recommended** for most loads |

- Load files into internal stages with the **`PUT`** command (from a client/SnowSQL); files are automatically encrypted.

### External Stages (your cloud storage)
- Point to **Amazon S3**, **Google Cloud Storage**, or **Azure Blob Storage**.
- Reference credentials via a **storage integration** (recommended) or inline credentials.
- Support **server-side encryption** settings.

### Supporting features
- **Directory tables** — a table-like listing of files on a stage (query file names, sizes, last modified) — useful for tracking what's staged.
- **Organizing data by path** — use logical path prefixes (e.g., `s3://bucket/2026/09/23/`) so `COPY` can target subsets efficiently.

### Stage-related commands
| Command | Purpose |
|---------|---------|
| `CREATE STAGE` | Define an internal or external stage |
| `PUT` | Upload local files → internal stage |
| `GET` | Download files from internal stage → local |
| `LIST` (`LS`) | List files on a stage |

> **Note:** `PUT`/`GET` work only with **internal** stages and run from a client like SnowSQL — not from the Snowsight worksheet.

---

## 3. COPY INTO Command

The workhorse for both directions.

### Loading: `COPY INTO <table>`
```sql
COPY INTO my_table
  FROM @my_stage/path/
  FILE_FORMAT = (FORMAT_NAME = my_csv_format)
  ON_ERROR = 'CONTINUE';
```
- Reads files from a stage and inserts into a table using a **warehouse**.
- Snowflake tracks **load metadata** (which files were already loaded) for ~64 days, so re-running `COPY` **skips already-loaded files** by default (idempotency). Use `FORCE = TRUE` to reload.

### Unloading: `COPY INTO <location>`
```sql
COPY INTO @my_stage/export/
  FROM my_table
  FILE_FORMAT = (TYPE = PARQUET)
  HEADER = TRUE
  MAX_FILE_SIZE = 16777216;
```
- Writes query/table results to files on a stage.
- Can unload from a **query** (not just a table) for filtering/transformation on the way out.

---

## 4. Error Handling Options

### `ON_ERROR` (behavior when a row fails to parse)
| Value | Effect |
|-------|--------|
| `ABORT_STATEMENT` (default for bulk) | Stop the whole load on first error |
| `CONTINUE` | Skip bad rows, load the good ones |
| `SKIP_FILE` | Skip the **entire file** containing an error |
| `SKIP_FILE_<n>` / `SKIP_FILE_<n>%` | Skip file after N errors / N% of rows error |

### `VALIDATE` / validation mode
- `VALIDATION_MODE = 'RETURN_ERRORS'` — **dry run**: reports errors **without loading** anything.
- `RETURN_N_ROWS` — returns rows that *would* be loaded, to sanity-check parsing.
- `VALIDATE()` table function — inspect errors from a **previous** `COPY` execution.

**Best practice:** Validate first (`VALIDATION_MODE`) on new data, then load with an appropriate `ON_ERROR` policy.

---

## 5. Best Practices — File Sizing & Compression

### Loading
- **Aim for compressed files of ~100–250 MB each** — large enough to be efficient, small enough to parallelize across warehouse threads.
- **Split very large files** so multiple threads load in parallel; avoid a single huge file that one thread must process.
- **Compress** files (GZIP etc.) to cut transfer time and storage; Snowflake handles decompression on load.
- Organize files under **logical paths** so `COPY` can target just the new data.

### Unloading
- Default behavior **splits output into multiple files** sized by `MAX_FILE_SIZE` — good for parallel download.
- Use `SINGLE = TRUE` only when you truly need one file (limits parallelism).
- Choose a **compression** and **file format** that the downstream consumer expects (e.g., PARQUET for analytics, CSV for spreadsheets).
- Consider `PARTITION BY` to organize unloaded files by column values.

---

## Quick Reference Summary

| Topic | Key object/command | Best practice |
|-------|-------------------|---------------|
| **File format** | `CREATE FILE FORMAT` | Named & reused; set compression |
| **Internal stage** | `@stage`, `PUT`/`GET` | Named internal stage for shared loads |
| **External stage** | `CREATE STAGE ... URL=` + storage integration | Use integration, not inline creds |
| **Directory table** | on a stage | Track staged files |
| **Load** | `COPY INTO <table>` | Validate first; 100–250 MB files |
| **Unload** | `COPY INTO <location>` | Multiple files; consumer-friendly format |
| **Errors** | `ON_ERROR`, `VALIDATION_MODE`, `VALIDATE()` | Dry-run new data before loading |

---

## Reference Links (from Snowflake docs)

- Loading Data into Snowflake (overview)
- Supported file formats / CREATE FILE FORMAT
- External stages / Internal stages / Directory tables / Server-side encryption / Organizing Data by Path / CREATE STAGE / PUT / GET / LIST
- COPY INTO <table> / COPY INTO <location> / Bulk loading from a local file system / Load data using the web interface
- Copy options (ON_ERROR) / VALIDATE
- Data File Compression / File Sizing Best Practices and Limitations
- Overview of data unloading / Data Unloading Considerations / Preparing to unload data
