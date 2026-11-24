# Domain 5: Data Transformation, unstructured data and Cortex (SnowPro Advanced: Data Engineer, DEA-C02)

Weight: **25%**. Domain 5 has sections 5.1 to 5.7. Notes are split by topic across these files: [d5-udfs-concept.md](d5-udfs-concept.md) (5.1 UDFs; 5.2 and 5.3 to come); [d5-semi-structured-data-concept.md](d5-semi-structured-data-concept.md) (5.4 semi-structured data); this file, 5.5 unstructured data, semantic views, Cortex, REST API; [d5-snowpark-transformations-concept.md](d5-snowpark-transformations-concept.md) (5.7 Snowpark for data transformations). Section 5.6 will get its own file. A section is added only after it is approved. The contents table below lists only the sections in this file.

In the study guide's two-column layout, the bullets "Use the Rest API", "Use semantic views", the Cortex features and "Use Cortex LLM for cost management" continue section 5.5 at the top of the right column. They are covered here.

## Contents

| Section | Topic | Status |
|---------|-------|--------|
| 5.5 | [Handle and process unstructured data](#55-handle-and-process-unstructured-data) | Draft for approval |

---

## 5.5 Handle and process unstructured data

The study guide lists: use unstructured data (URL types), use directory tables, use the REST API, use semantic views, use Snowflake Cortex features (automate data categorization, extract multimedia data, perform semantic data analysis, run text analytics in data pipelines, run multimodal AI workflows within SQL queries), and use Cortex LLM for cost management.

**Sections in 5.5**

- [5.5.1 Unstructured data, URL types and directory tables](#551-unstructured-data-url-types-and-directory-tables)
- [5.5.2 Sharing unstructured data](#552-sharing-unstructured-data)
- [5.5.3 Processing files in UDF and procedure handlers](#553-processing-files-in-udf-and-procedure-handlers)
- [5.5.4 Semantic views](#554-semantic-views)
- [5.5.5 Cortex AI functions in SQL](#555-cortex-ai-functions-in-sql)
- [5.5.6 Cortex cost management](#556-cortex-cost-management)
- [5.5.7 REST APIs](#557-rest-apis)
- [5.5.8 Quick-reference for 5.5](#558-quick-reference-for-55)
- [5.5 open items and flags](#55-open-items-and-flags)

### 5.5.1 Unstructured data, URL types and directory tables

[Domain 1, 1.2.11](../domain_1/d1-data-loading-and-ingestion-concept.md#1211-unstructured-data-urls-and-directory-tables) already covers this in full, so it is not repeated here. It has the comparison of scoped, file and pre-signed URLs, the file functions (`BUILD_SCOPED_FILE_URL`, `BUILD_STAGE_FILE_URL`, `GET_PRESIGNED_URL`, `TO_FILE` and others), `SNOWFLAKE_SSE` versus `SNOWFLAKE_FULL` stage encryption, directory table creation, refresh and billing, and the privileges to query them.

Two points from the intro page that 1.2.11 lacks:

- **Supported storage.** Internal and external stages both hold unstructured data. External stages can be Amazon S3, Google Cloud Storage, or Azure (Blob storage, Data Lake Storage Gen2, general-purpose v1 and v2).
- **`FILE` data type.** It represents a file on an internal or external stage. Some built-in functions accept a `FILE` object in place of a stage name and path. `TO_FILE` and `TRY_TO_FILE` build one. The AI functions in 5.5.5 take `FILE` objects.

[Back to contents](#contents)


### 5.5.2 Sharing unstructured data

- Share files with a **secure view** over a directory table that returns scoped or pre-signed URLs. Consumers query the view.
- Snowflake creates the URL **only when a consumer queries the secure view**. That lets you control the life of pre-signed URLs. To lower the risk of leaks, use a short `expiration_time` (the example uses 60 seconds).
- Scoped URLs are the more secure choice. Pre-signed URLs need no authentication.
- To share a subset, join the directory table to a metadata table in the view (for example, `WHERE client_name = 'abc'`) instead of sharing the whole stage.
- File URLs can't be accessed by consumers through a shared secure view (see 1.2.11).

[Back to contents](#contents)


### 5.5.3 Processing files in UDF and procedure handlers

Snowflake offers two ways to process unstructured files, besides the AI functions in 5.5.5.

- **External functions** call services outside Snowflake, such as Amazon Textract, Document AI or Azure Computer Vision, that internal UDFs can't use. They are covered in section 5.2.
- **UDFs, UDTFs and procedures** read a staged file in handler code (Java, Python or Scala) and can run your own machine learning models.

Reading the file:

| Handler | How the Java handler reads the file |
|---------|-------------------------------------|
| UDF | Takes an `InputStream` |
| Procedure | Uses the `SnowflakeFile` class, for example `SnowflakeFile.newInstance(fileURL).getInputStream()` |
| UDTF | Uses `SnowflakeFile` to open a stream and returns rows as it reads, so a very large file doesn't cause out-of-memory errors |

- Pass the file location as a **scoped URL** (`BUILD_SCOPED_FILE_URL`) so the code resists **file injection** attacks. Always do this when the function's caller is not its owner. When the caller is the owner, other URL forms are acceptable.
- Library JARs (for example Apache PDFBox for PDFs) go on a stage and are named in `IMPORTS`. The data stage in the example has a directory table and `SNOWFLAKE_SSE`.
- UDFs process staged files serially, UDTFs in parallel (see [5.1.1](d5-udfs-concept.md#511-udf-variations-languages-and-handler-location)).

[Back to contents](#contents)


### 5.5.4 Semantic views

A semantic view is a **schema-level object** that stores business concepts and metrics in the database. It is metadata. It gives one definition for terms like net revenue, with the right aggregation.

**Parts of a semantic view**

| Part | Meaning |
|------|---------|
| Logical tables | Business entities (customers, orders) mapped to physical tables or views |
| Relationships | Joins between logical tables on shared keys (`REFERENCES`). Ranges of dates, times, timestamps or numbers can join tables too |
| Facts | Row-level numeric attributes (an individual sale amount). Helpers to build metrics and dimensions |
| Metrics | Aggregations of facts (`SUM`, `AVG`, `COUNT`). KPIs such as total revenue |
| Dimensions | Categorical attributes for grouping and filtering (who, what, where, when) |

**Create and manage**
- SQL: `CREATE SEMANTIC VIEW` with `TABLES`, `RELATIONSHIPS`, `FACTS`, `DIMENSIONS` and `METRICS` clauses, plus `ALTER`, `DESCRIBE`, `DROP`, `SHOW SEMANTIC VIEWS`, `SHOW SEMANTIC DIMENSIONS`, `SHOW SEMANTIC DIMENSIONS FOR METRIC`, `SHOW SEMANTIC FACTS`, `SHOW SEMANTIC METRICS`.
- Other interfaces: **Semantic View Autopilot** (AI wizard in Snowsight, also accepts a YAML spec, a Tableau file or a Power BI file) and **Semantic Studio** in Workspaces.
- Create needs `CREATE SEMANTIC VIEW` on the schema and `SELECT` on the tables and views used.

**Query**
- A role that doesn't own the view needs only **`SELECT` on the semantic view**, not on the underlying tables. This matches standard views.
- Two forms:
  - `SELECT * FROM SEMANTIC_VIEW(tpch_analysis DIMENSIONS customer.customer_market_segment METRICS orders.order_average_value)`. Aliases are allowed, with or without `AS`. You can ask for `FACTS` as well.
  - A normal `FROM` with the view name: `SELECT customer_market_segment, AGG(order_average_value) FROM tpch_analysis GROUP BY customer_market_segment`.
- **Uses**: Cortex Agents (add the view as a tool), the **Cortex Analyst REST API** (name the view in the request), BI tools, and sharing in private listings, on the Marketplace and in organizational listings. For AI use, Cortex Agents read the view definition and generate the SQL against the physical tables.

[Back to contents](#contents)


### 5.5.5 Cortex AI functions in SQL

Cortex AI functions run LLMs from SQL (and Python) on text, images, documents, audio and video. Models are hosted within the Snowflake service perimeter. Some functions are Preview, so check each one's status.

**Access**
- The role needs the **`USE AI FUNCTIONS`** account privilege and one of the **`CORTEX_USER`** or **`AI_FUNCTIONS_USER`** database roles (AI functions overview page). The `AI_CLASSIFY` page lists only `SNOWFLAKE.CORTEX_USER`.
- `SNOWFLAKE.CORTEX_USER` is granted to **`PUBLIC`** by default, so every user has access until you revoke it (see 5.5.6).
- Functions are built for **throughput** on large tables. For interactive, low-latency use, call the **Cortex REST API**.

**Functions by task (study guide topics)**

| Task | Functions |
|------|-----------|
| Data categorization | `AI_CLASSIFY` (text, image, document), `AI_FILTER` (returns `TRUE`/`FALSE`, usable in `SELECT`, `WHERE` and `JOIN ... ON`) |
| Extract multimedia data | `AI_EXTRACT`, `AI_PARSE_DOCUMENT`, `AI_TRANSCRIBE` (audio and video, with timestamps and speakers) |
| Semantic data analysis | `AI_SENTIMENT`, `AI_SIMILARITY`, `AI_EMBED`, `AI_MULTI_EMBED` |
| Text analytics in pipelines | `AI_AGG`, `AI_SUMMARIZE_AGG` (both have no context-window limit), `AI_SUMMARIZE`, `AI_TRANSLATE`, `AI_REDACT` (removes PII) |
| Multimodal AI in SQL | `AI_COMPLETE` (general generation), with `TO_FILE` to refer to staged files and `PROMPT` to build prompt objects |
| Helpers | `TO_FILE`, `AI_COUNT_TOKENS`, `PROMPT` |

**`AI_CLASSIFY`**
- `AI_CLASSIFY(input, list_of_categories [, config_object] [, return_error_details])`.
- At least **two** unique categories. The token window is the only hard limit, but **more than twenty** categories can reduce accuracy.
- Input text and category labels are **case sensitive**.
- A category can be a string or an object with `label` (required) and `description` (optional, at most **25 words**). Descriptions count as input tokens.
- `config_object` keys: `task_description` (50 words or fewer), `output_mode` (`'single'` default, or `'multi'`), `examples` (few-shot objects with `input`, `labels`, `explanation`).
- For **document** input, `output_mode` must be `'single'` and `examples` isn't supported. Document input is Preview.
- Returns an object whose `labels` array holds the categories. On error it returns `NULL` and other rows still complete. With `return_error_details => TRUE` it returns an object with `value` and `error`.
- Best results come from plain English, mutually exclusive, descriptive categories.

**`AI_EXTRACT`**
- Two input forms: `text` or `file` (not both in one call). `responseFormat` says what to extract. It can be an object of questions, an array of questions or labels, or a JSON schema (including `'type': 'array'` for lists).
- File formats include PDF, PNG, PPT/PPTX, DOC/DOCX, JPEG, TIFF, HTML, TXT, EML, BMP, GIF, WEBP and MD. Files must be under **100 MB**.
- Page limits: **1,000 pages with cross-region inference enabled**, **125 pages without it**. Without cross-region inference, a file it can't process **fails the statement**. With it, the `error` field is set for that file and the statement continues.
- `FL_FILTER_PAGES` as the `file` argument limits extraction to chosen pages.
- `scores => TRUE` adds scores. `citation => TRUE` adds source locations (page numbers and bounding boxes for documents). **Citations require cross-region inference.** Passing `NULL` for `citation` is a compile error.
- `scale_factor` (1.0 to 4.0, default 1.0) applies only without cross-region inference.

**`AI_PARSE_DOCUMENT`**
- Reads a staged document (as a `FILE` from `TO_FILE`) and returns a JSON string. Use `PARSE_JSON` to read fields. It returns `NULL` on failure.
- `mode`: **`OCR`** (default, text only), **`LAYOUT`** (text with layout and tables, as Markdown), **`AGENTIC`** (also interprets charts and diagrams).
- `extract_images` needs `LAYOUT` mode. `page_split` works only for PDF, PowerPoint and Word. `page_filter` (zero-based, start inclusive, end exclusive) **implies `page_split`**. Don't combine `page_filter` with `FL_FILTER_PAGES`.
- Billing is per page processed.

**Multimodal.** Documents use `AI_COMPLETE`, `AI_PARSE_DOCUMENT`, `AI_EXTRACT`. Images use `AI_COMPLETE`, `AI_CLASSIFY`, `AI_EMBED`, `AI_EXTRACT`, `AI_SIMILARITY`, `AI_FILTER`. Audio and video use `AI_COMPLETE` and `AI_TRANSCRIBE`. Files are on internal or external stages.


[Back to contents](#contents)


### 5.5.6 Cortex cost management

**What you pay for**
- Credits depend on **tokens** (about four characters of text each) or pages. Rates are in the Service Consumption Table.
- **Input and output tokens** are billed for `AI_COMPLETE`, `AI_CLASSIFY`, `AI_FILTER`, `AI_AGG`, `AI_SUMMARIZE` and `AI_TRANSLATE`. For `AI_SIMILARITY` and `AI_EMBED`, **only input tokens**. `AI_EXTRACT` and `AI_REDACT` bill input and output.
- Several functions add their own prompt, so billed tokens exceed the text you pass.
- `AI_CLASSIFY` labels, descriptions and examples count as input tokens **for every record**, not once per call.
- `AI_PARSE_DOCUMENT` bills **per page**. `AI_EXTRACT` counts each page as **970 tokens**, plus the `responseFormat` as input. Audio is **50 tokens per second**. `AI_COUNT_TOKENS` incurs compute only.
- Warehouse time still counts. Use a warehouse **no larger than MEDIUM**. A larger one costs more with no speed gain.

**Where to look**

| Source | Use |
|--------|-----|
| `ACCOUNT_USAGE.CORTEX_AI_FUNCTIONS_USAGE_HISTORY` | Telemetry for all AI functions called in SQL. Latency up to **5 minutes**. Hourly windows, so one long query gives several rows. `IS_COMPLETED` is true only on the last row |
| `ACCOUNT_USAGE.CORTEX_FUNCTIONS_USAGE_HISTORY` and `CORTEX_FUNCTIONS_QUERY_USAGE_HISTORY` | Credits and tokens per call and per query (cost page). Query history groups by model. No granular data for REST API requests |
| `METERING_DAILY_HISTORY` with `SERVICE_TYPE = 'AI_SERVICES'` | Daily credits for AI services |
| `CORTEX_REST_API_USAGE_HISTORY` | REST API requests, tokens and credits |

**Controls (the Account Usage cost page)**
1. **Monitor first.** Query credits by function, model and user. Use `QUERY_TAG` for cost attribution by project or team.
2. **Account-level alert.** An alert runs a check against a credit threshold and a stored procedure sends email through a **notification integration** (`TYPE = EMAIL`). Each recipient must be in `ALLOWED_RECIPIENTS` and be the verified `EMAIL` of a Snowflake user. A state table stops repeat alerts in the same month.
3. **Per-user monthly limits.** Revoke `SNOWFLAKE.CORTEX_USER` from `PUBLIC` and grant it only through a custom `AI_FUNCTIONS_USER_ROLE`. A table holds each user's budget. An **hourly task** revokes the role from users over budget and a **monthly task** restores it. Any other role that includes `CORTEX_USER` would bypass the limit.
4. **Runaway queries.** A task finds queries whose credits across hourly windows exceed a threshold and cancels them. The role needs **`OPERATE` on the warehouses**, or the cancel fails. **Credits already used are not refunded.** The example sums the last 48 hours.
- Best practices on the page: start with monitoring, set low initial limits, use query tags, review regularly, test alerts, allow for the view's latency.

[Back to contents](#contents)


### 5.5.7 REST APIs

The guide's "Use the Rest API" bullet doesn't say which API. Three are documented in the pages read.

| API | Purpose | Where covered |
|-----|---------|---------------|
| REST API for unstructured data support | `GET /api/files/<url path>` downloads a staged file from a scoped or file URL. Needs an OAuth token or key-pair token, and the client must allow redirects | [1.2.11](../domain_1/d1-data-loading-and-ingestion-concept.md#1211-unstructured-data-urls-and-directory-tables) |
| Cortex REST API | Low-latency LLM inference | Below |
| UDF REST API | Manage and run UDFs | Below |

**Cortex REST API.** Endpoints `/api/v2/cortex/v1/chat/completions` (OpenAI-compatible, all models), `/api/v2/cortex/v1/messages` (Anthropic-compatible, Claude only) and `/api/v2/cortex/v1/responses` (preview, OpenAI models on AWS only). It authenticates with a **programmatic access token (PAT)**. Usage is in `CORTEX_REST_API_USAGE_HISTORY`.

**UDF REST API**
- Base path `/api/v2/databases/{database}/schemas/{schema}/user-defined-functions`.

| Method and path | Action |
|-----------------|--------|
| `GET` on the collection | List UDFs |
| `POST` on the collection | Create a UDF |
| `GET /{nameWithArgs}` | Fetch a UDF |
| `DELETE /{nameWithArgs}` | Delete a UDF |
| `POST /{name}:execute` | Execute a UDF |
| `POST /{nameWithArgs}:rename` | Rename a UDF |

[Back to contents](#contents)


### 5.5.8 Quick-reference for 5.5

| Topic | Fact |
|-------|------|
| URL types, directory tables, file functions | Covered in Domain 1, 1.2.11 |
| URL for a shared secure view | Created when a consumer queries the view |
| File argument to a function the caller doesn't own | Pass a scoped URL (file injection) |
| Java UDF vs procedure file read | UDF takes an `InputStream`, procedure uses `SnowflakeFile` |
| Semantic view query | `SELECT` on the view only. `SEMANTIC_VIEW(...)` clause or `AGG()` form |
| `AI_CLASSIFY` | 2 or more categories, over 20 may hurt accuracy, document input is single-label |
| `AI_EXTRACT` pages | 1,000 with cross-region inference, 125 without. Citations need cross-region inference |
| `AI_PARSE_DOCUMENT` modes | `OCR` (default), `LAYOUT`, `AGENTIC` |
| Cortex default access | `CORTEX_USER` is granted to `PUBLIC` |
| Per-user limit | Revoke from `PUBLIC`, grant through a custom role, hourly and monthly tasks |
| Runaway cancel | Needs `OPERATE` on the warehouse. No refund |
| Warehouse size for AI functions | No larger than MEDIUM |

[Back to contents](#contents)


### 5.5 open items and flags

- **Which REST API.** The guide doesn't say. Section 5.5.7 lists three. The REST API for unstructured data support is already in Domain 1 and fits section 5.5 best. I did not read the UDF REST API reference page (the path I tried returned 404), only its introduction.
- **Two usage views.** The cost-considerations page points to `CORTEX_FUNCTIONS_USAGE_HISTORY` and `CORTEX_FUNCTIONS_QUERY_USAGE_HISTORY`. The Account Usage cost page uses `CORTEX_AI_FUNCTIONS_USAGE_HISTORY`, and the governance page says that view's data begins **1/5/2026**. They may be an old and a new view. I did not confirm that.
- **Access roles.** The AI functions overview says `USE AI FUNCTIONS` plus `CORTEX_USER` or `AI_FUNCTIONS_USER`. The `AI_CLASSIFY` page mentions only `CORTEX_USER`. I did not read the privileges page to settle it.
- **Not read:** `AI_COMPLETE`, `AI_SENTIMENT`, `AI_AGG`, `AI_TRANSCRIBE` and `AI_FILTER` argument details, the semantic view `CREATE` syntax and YAML specification, the Cortex Analyst and Agents pages, the Python and Scala file-reading handler pages (only the Java page was read), and the external-function pages (section 5.2).
- **"Run text analytics in data pipelines".** The pages read describe the functions. I found no page that shows them inside dynamic tables, streams or tasks, so I haven't described that pattern.
- **Preview features.** Document input to `AI_CLASSIFY` and the Responses API are Preview on the pages read.
