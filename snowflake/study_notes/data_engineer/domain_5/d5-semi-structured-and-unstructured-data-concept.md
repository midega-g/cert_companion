# Domain 5: Data Transformation, part 2 (SnowPro Advanced: Data Engineer, DEA-C02)

Weight: **25%**. Part 1 is [d5-functions-and-procedures-concept.md](d5-functions-and-procedures-concept.md) (5.1 now, 5.2 and 5.3 to come). Part 2 will cover 5.4 to 5.7. This draft contains **5.4 and 5.5**. Sections 5.6 and 5.7 will be added after them.

In the study guide's two-column layout, the bullets "Use the Rest API", "Use semantic views", the Cortex features and "Use Cortex LLM for cost management" continue section 5.5 at the top of the right column. They are covered here.

## Contents

| Section | Topic | Status |
|---------|-------|--------|
| 5.4 | [Handle and transform semi-structured data](#54-handle-and-transform-semi-structured-data) | Draft for approval |
| 5.5 | [Handle and process unstructured data](#55-handle-and-process-unstructured-data) | Draft for approval |

---

## 5.4 Handle and transform semi-structured data

The study guide lists: traverse and transform semi-structured data to structured data, and transform structured data to semi-structured data. The linked functions are `ARRAY_AGG`, `OBJECT_CONSTRUCT` and `TRY_PARSE_JSON`.

Domain 1 already covers the storage side: the three types, the 128 MB limit, VARIANT versus flattened columns, SQL NULL versus JSON null, subcolumnarization and `STRIP_NULL_VALUES`. See [1.2.6](../domain_1/d1-data-loading-and-ingestion-concept.md#126-semi-structured-data-in-variant) and [1.1.4](../domain_1/d1-data-loading-and-ingestion-concept.md#114-preparing-data-files). These notes cover querying and transforming.

**Sections in 5.4**

- [5.4.1 Types and accessing elements](#541-types-and-accessing-elements)
- [5.4.2 Traversing with path notation](#542-traversing-with-path-notation)
- [5.4.3 FLATTEN and LATERAL](#543-flatten-and-lateral)
- [5.4.4 Parsing and checking JSON](#544-parsing-and-checking-json)
- [5.4.5 Structured to semi-structured: building values](#545-structured-to-semi-structured-building-values)
- [5.4.6 Handling nulls](#546-handling-nulls)
- [5.4.7 Higher-order functions](#547-higher-order-functions)
- [5.4.8 Quick-reference for 5.4](#548-quick-reference-for-54)
- [5.4 open items and flags](#54-open-items-and-flags)

### 5.4.1 Types and accessing elements

| Type | Holds | Access |
|------|-------|--------|
| VARIANT | Any type, including OBJECT and ARRAY | `::` cast, `TO_VARIANT`, `CAST` |
| OBJECT | Key-value pairs. Each key is a VARCHAR and each value is a VARIANT | `obj['key']` or `obj:key` |
| ARRAY | Ordered elements, each a VARIANT. Elements can have different types | `arr[0]`, `ARRAY_SLICE(arr, from, to)` |

- Array indexes start at **0**. Reading past the end returns **NULL**. `ARRAY_SLICE` returns from the start index up to but **not including** the end index. A slice past the end returns an empty array.
- Nesting is allowed: `arr[0][0]`.
- An object key shouldn't be an empty string, and neither key nor value should be NULL. Snowflake doesn't support explicitly typed objects in this type (structured types are separate).
- Insert VARIANT data with `INSERT INTO ... SELECT PARSE_JSON(...)`. `TO_VARIANT` also can't be used directly in `INSERT ... VALUES`. Use `INSERT INTO ... SELECT`.
- **Sparse arrays** can have gaps. Missing positions are `undefined`, and an `undefined` element is different from a NULL element. A NULL in an array is a defined element.
- OBJECT and ARRAY constants: `{ 'a': 1::VARIANT }` and `[ 1, 'two', NULL ]`.
- A function that extracts a value, `GET(variant, key_or_index)`, returns NULL if either argument is NULL.

[Back to contents](#contents)


### 5.4.2 Traversing with path notation

Use `:` after the column name for the first level, then `.` or `[]`.

| Style | Example | Note |
|-------|---------|------|
| Dot | `src:salesperson.name` | The `:` is needed for the first element |
| Bracket | `src['salesperson']['name']` | Element names go in **single quotes** |
| Array index | `src:vehicle[0].price` | Zero-based. Selects one occurrence |
| Quoted name | `src:"company name"` | Needed when the key isn't a valid identifier (blanks, starts with a digit, special characters) |
| Function | `GET_PATH(src, 'vehicle[0].make')` | Same as the path syntax, a chain of `GET` calls. Handles irregular paths |

- The **column name is case-insensitive** but **element names are case-sensitive**. `src:salesperson.name` and `SRC:salesperson.name` are the same. `SRC:Salesperson.Name` is not.
- `:`, `.` and `[]` always return a **VARIANT**. Strings come back **in double quotes**. Cast to remove them: `src:dealership::VARCHAR`. Cast numbers before arithmetic: `src:vehicle[0].price::NUMBER * 0.10`.
- Retrieving **all** occurrences of a repeating element needs `FLATTEN`. The path syntax returns one.
- A path works on a staged file directly: `SELECT S.$1:root[0].employees[0].firstName FROM @stage/file (file_format => 'my_json_format') S`.
- `TYPEOF(variant)` returns the stored type, such as `BOOLEAN`, `DECIMAL`, `ARRAY`, `OBJECT`.

[Back to contents](#contents)


### 5.4.3 FLATTEN and LATERAL

`FLATTEN` is a table function. It turns a VARIANT, OBJECT or ARRAY into rows, which converts semi-structured data to a relational shape.

`FLATTEN(INPUT => expr [, PATH => 'p'] [, OUTER => bool] [, RECURSIVE => bool] [, MODE => 'OBJECT'|'ARRAY'|'BOTH'])`

| Argument | Default | Effect |
|----------|---------|--------|
| `INPUT` | Required | Must be VARIANT, OBJECT or ARRAY |
| `PATH` | Empty path | Which element inside the input to flatten |
| `OUTER` | `FALSE` | `FALSE` omits inputs that are empty or can't be reached. `TRUE` returns **one row** with NULL in `KEY`, `INDEX` and `VALUE` |
| `RECURSIVE` | `FALSE` | `TRUE` expands all sub-elements. `FALSE` expands only the element at `PATH` |
| `MODE` | `BOTH` | Flatten only objects, only arrays, or both |

**Output columns**

| Column | Meaning |
|--------|---------|
| `SEQ` | Sequence number of the input record. Not gap-free or ordered |
| `KEY` | Key, for objects or maps. NULL for arrays |
| `PATH` | Path to the element |
| `INDEX` | Index, for arrays. NULL otherwise |
| `VALUE` | The element's value (a VARIANT) |
| `THIS` | The element being flattened, useful in recursion |

- Columns from the source table are available and are **repeated** for every output row.
- With `OUTER => TRUE`, a zero-row expansion of an empty compound shows NULL in `THIS`, which tells it apart from a missing or wrong-kind path.
- Typical query: `SELECT value:name::string FROM car_sales, LATERAL FLATTEN(INPUT => src:customer)`.
- **Nested arrays** need one `LATERAL FLATTEN` per level, and the second one refers to the first one's output (`vm.value:extras`).

**LATERAL**
- In a `FROM` clause, `LATERAL` lets an inline view refer to columns from a table expression that comes **before** it. It behaves like a correlated subquery run **once for each left-hand row**. No `ON` clause is needed. The output has only the rows from the inline view.
- Needed to **chain table functions** on nested data and to call a UDTF with row-specific arguments.
- For a **single-level** array, `TABLE(FLATTEN(...))` without `LATERAL` gives the same result.
- The inline view can't be a plain table reference. It must be a subquery or a table function.

**Uses beyond flattening one array**
- Filter on key-value pairs: `FROM pets a, LATERAL FLATTEN(input => a.v) b WHERE b.value LIKE '%dog%'`.
- List the distinct key names and paths in unknown data with `RECURSIVE => TRUE`, using the `PATH` and `KEY` output columns and `TYPEOF(value)`. The page applies `REGEXP_REPLACE` to `PATH` to turn array indexes such as `[0]` into `[]`, so array elements group into one path.
- Flatten a staged file in `CREATE TABLE AS SELECT`. `FLATTEN` is not allowed inside a `COPY INTO` transform (see [1.1.10](../domain_1/d1-data-loading-and-ingestion-concept.md#1110-simple-transformations-during-load)).

[Back to contents](#contents)


### 5.4.4 Parsing and checking JSON

| Function | Behavior |
|----------|----------|
| `PARSE_JSON(string [, parameter])` | Parses a JSON string into a VARIANT. NULL in gives NULL out. The string `'null'` gives a JSON null, not SQL NULL. Empty or whitespace-only strings return NULL, not an error. Input up to **64 MB compressed** |
| `TRY_PARSE_JSON(string [, parameter])` | Same, but returns **NULL when the input isn't valid JSON** instead of raising an error |
| `CHECK_JSON(string)` | Returns **NULL when the input is valid JSON or NULL**. Returns the error message when it isn't valid |
| `TO_JSON(variant)` | VARIANT to a JSON string (VARCHAR). A JSON null returns the string `"null"`. Key order isn't predictable |
| `TO_OBJECT(expr)` | Returns the OBJECT for a VARIANT holding an object. NULL for NULL or JSON null. Other input is an error |
| `TO_VARIANT(expr)` | Any value to a VARIANT |

- **Duplicate keys.** The optional parameter is `'s'` (strict, the default) or `'d'`. By default a duplicate key in a JSON object raises an error. With `'d'`, the object keeps **one** instance with the **last** value.
- Use `TRY_PARSE_JSON` when bad rows should not fail a load or a transformation. Use `CHECK_JSON` to find the bad rows and read the error.
- `TO_JSON` and `PARSE_JSON` are almost inverses.

[Back to contents](#contents)


### 5.4.5 Structured to semi-structured: building values

| Function | Result |
|----------|--------|
| `OBJECT_CONSTRUCT(k1, v1, k2, v2, ...)` | An OBJECT. Keys are VARCHAR. `OBJECT_CONSTRUCT(*)` uses column names as keys |
| `OBJECT_CONSTRUCT_KEEP_NULL(...)` | Same, but **keeps** pairs whose value is SQL NULL |
| `ARRAY_CONSTRUCT(a, b, ...)` | An ARRAY of N elements. SQL NULLs stay as elements |
| `ARRAY_CONSTRUCT_COMPACT(...)` | Same, without NULLs (named on the pages but not read) |
| `ARRAY_AGG([DISTINCT] expr) [WITHIN GROUP (ORDER BY ...)]` | Aggregate: pivots the values of many rows into **one array**. Also a window function with `OVER` |
| `OBJECT_AGG(key, value)` | Aggregate: one OBJECT per group. Key must be VARCHAR and value a VARIANT |
| `OBJECT_INSERT(obj, key, value [, updateFlag])` | Adds a key. An existing key raises an error unless `updateFlag` is TRUE, which updates it |
| `OBJECT_PICK(obj, key1, key2, ...)` or `(obj, array_of_keys)` | New OBJECT with only the listed keys. Missing keys are ignored |
| `ARRAY_FLATTEN(array_of_arrays)` | Concatenates inner arrays into one. NULL if the input or any element is NULL. Error if an element isn't an array |
| `ARRAY_COMPACT(array)` | Removes NULL and missing values |
| `ARRAY_TO_STRING(array, separator)` | Casts the elements to strings and joins them |

- **`OBJECT_CONSTRUCT` drops a pair when the key or value is SQL NULL.** A JSON null (`PARSE_JSON('null')`) is kept. To keep SQL NULL values use `OBJECT_CONSTRUCT_KEEP_NULL`.
- The object's key order isn't preserved.
- With `*`, you can narrow the columns with `ILIKE` (one pattern) or `EXCLUDE`. **They can't be combined** in one call. Both are valid only in a `SELECT` list or `GROUP BY`.
- `ARRAY_AGG`:
  - Without `WITHIN GROUP (ORDER BY ...)` the **element order is unpredictable**. An `ORDER BY` outside it orders output rows, not array elements.
  - **NULL values are omitted.** An empty input gives an empty array.
  - With `DISTINCT` and `WITHIN GROUP`, both must name the **same column**, or it errors.
  - A number in `WITHIN GROUP (ORDER BY 1)` is a constant, **not a column position**.
  - `LIMIT` is not supported in the window form.
  - The result is capped by the 128 MB array limit. Domain 1 notes this for `ARRAY_AGG(OBJECT_CONSTRUCT(*))` over `INFER_SCHEMA` output.
- `OBJECT_AGG`: NULL keys or values are ignored. A **duplicate key in a group raises an error**. As a window function it supports no `ORDER BY` and no explicit frame.
- Common pattern: `OBJECT_CONSTRUCT` per row, then `ARRAY_AGG` per group, builds a JSON array of records.

[Back to contents](#contents)


### 5.4.6 Handling nulls

The two kinds of NULL, and how storage treats them, are in [1.2.6](../domain_1/d1-data-loading-and-ingestion-concept.md#126-semi-structured-data-in-variant). Functions to work with them:

| Task | Use |
|------|-----|
| JSON null to SQL NULL | `STRIP_NULL_VALUE(variant)`, or cast to a string (`TO_CHAR`, `TO_VARCHAR`) |
| Test for a JSON null | `IS_NULL_VALUE(variant)`. TRUE only for JSON null. For a missing value it returns NULL, and it differs from `IS NULL` |
| Remove JSON nulls when loading | `STRIP_NULL_VALUES = TRUE` in the JSON file format |
| Build an array holding both | `ARRAY_CONSTRUCT(1, NULL, PARSE_JSON('null'))` shows `undefined` for SQL NULL and `null` for JSON null |

- A key that is missing from an object returns SQL NULL when you read it.

[Back to contents](#contents)


### 5.4.7 Higher-order functions

`FILTER`, `TRANSFORM` and `REDUCE` take an array and a **lambda expression**. They avoid `LATERAL FLATTEN` and UDFs for array logic.

- A lambda has the form `a -> a * 2` or `(x INT, y INT) -> (x + y)`. The argument is on the left of `->`.
- Examples: `a -> a:value > 50` (filter), `a -> UPPER(a)`.
- It can reference table columns. **Lambda arguments take priority** over column names when names clash.
- **Limits.** A lambda can't stand alone and must be **anonymous**. It can call built-in functions (not aggregate or window functions), **SQL UDFs**, and uncorrelated scalar subqueries. It can't call UDFs in other languages, reference Snowflake Scripting variables, CTEs, arguments of a surrounding UDF, or correlated subqueries.

[Back to contents](#contents)


### 5.4.8 Quick-reference for 5.4

| Need | Use |
|------|-----|
| One value from a nested path | `col:a.b[0]::TYPE` |
| All items in an array, one row each | `LATERAL FLATTEN(INPUT => col:arr)` |
| Items in an array inside an array | Two `LATERAL FLATTEN` calls |
| Keep a row whose array is empty | `OUTER => TRUE` |
| All keys and paths of unknown JSON | `FLATTEN(..., RECURSIVE => TRUE)` |
| Bad JSON must not fail the query | `TRY_PARSE_JSON`, or find them with `CHECK_JSON` |
| JSON string with repeated keys | `PARSE_JSON(s, 'd')`, last value wins |
| Row to JSON object | `OBJECT_CONSTRUCT(*)` |
| Keep SQL NULL fields | `OBJECT_CONSTRUCT_KEEP_NULL` |
| Many rows to one array, ordered | `ARRAY_AGG(x) WITHIN GROUP (ORDER BY y)` |
| Key-value rows to one object | `OBJECT_AGG(k, v)`. Duplicate key is an error |
| Change an existing key's value | `OBJECT_INSERT(obj, key, value, TRUE)` |
| JSON null to SQL NULL | `STRIP_NULL_VALUE`, or `TO_VARCHAR` |
| Filter or map an array without FLATTEN | `FILTER`, `TRANSFORM`, `REDUCE` |

[Back to contents](#contents)


### 5.4 open items and flags

- **Not read:** `ARRAY_CONSTRUCT_COMPACT`, `ARRAY_SLICE` and `ARRAY_SIZE` pages, the `FILTER`, `TRANSFORM` and `REDUCE` pages (only the overview in the querying page), `OBJECT_CONSTRUCT_KEEP_NULL_STRUCTURED`, structured-type flattening, `XMLGET` and XML handling, `VARIANT` loading from Avro, ORC and Parquet, the JSON basics tutorial, and the search optimization service for semi-structured data.
- **Two pages not fetched.** The study guide's "Semi-Structured Data" link and the "Querying arrays" page returned 404 at the paths I tried. I used the introduction, considerations, querying and data types pages instead.
- **`TO_VARIANT` in `INSERT`.** The function page says it can't be used directly in `INSERT`. Another page says to use `INSERT ... SELECT` for VARIANT. They agree, but I didn't test it.
- **Considerations page on "null" storage.** It says JSON null is "stored as a string containing the word null". `PARSE_JSON('null')` still compares as a real value. Domain 1 repeats the first wording.

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
- UDFs process staged files serially, UDTFs in parallel (see [5.1.1](d5-functions-and-procedures-concept.md#511-udf-variations-languages-and-handler-location)).

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
