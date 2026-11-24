# Domain 5: Data Transformation, UDFs (SnowPro Advanced: Data Engineer, DEA-C02)

Weight: **25%**. Domain 5 has sections 5.1 to 5.7. Notes are split by topic across these files: this file, 5.1 UDFs; 5.2 and 5.3 to come; [d5-semi-structured-data-concept.md](d5-semi-structured-data-concept.md) (5.4 semi-structured data); [d5-unstructured-data-and-cortex-concept.md](d5-unstructured-data-and-cortex-concept.md) (5.5 unstructured data, semantic views, Cortex, REST API); [d5-snowpark-transformations-concept.md](d5-snowpark-transformations-concept.md) (5.7 Snowpark for data transformations). Section 5.6 will get its own file. A section is added only after it is approved. The contents table below lists only the sections in this file.

Where Domain 1 already covers a topic, these notes link to it instead of repeating it. In particular, the `CREATE FUNCTION` options (`STRICT`, volatility, `NOT NULL`) and the procedure versus UDF comparison are in [Domain 1, 1.4.22](../domain_1/d1-continuous-pipelines-concept.md#1422-udfs-and-stored-procedures).

## Contents

| Section | Topic | Status |
|---------|-------|--------|
| 5.1 | [Define user-defined functions (UDFs) and outline how to use them](#51-define-user-defined-functions-udfs-and-outline-how-to-use-them) | Draft for approval |

---

## 5.1 Define user-defined functions (UDFs) and outline how to use them

The study guide lists: Snowpark UDFs (Java, Python, Scala), secure UDFs, SQL UDFs, JavaScript UDFs, UDTFs and UDAFs.

**Sections in 5.1**

- [5.1.1 UDF variations, languages and handler location](#511-udf-variations-languages-and-handler-location)
- [5.1.2 SQL UDFs](#512-sql-udfs)
- [5.1.3 JavaScript UDFs](#513-javascript-udfs)
- [5.1.4 Java, Python and Scala UDFs, including vectorized UDFs](#514-java-python-and-scala-udfs-including-vectorized-udfs)
- [5.1.5 Snowpark UDFs](#515-snowpark-udfs)
- [5.1.6 User-defined table functions (UDTFs)](#516-user-defined-table-functions-udtfs)
- [5.1.7 User-defined aggregate functions (UDAFs)](#517-user-defined-aggregate-functions-udafs)
- [5.1.8 Secure UDFs](#518-secure-udfs)
- [5.1.9 Creating, granting and calling](#519-creating-granting-and-calling)
- [5.1.10 Quick-reference for 5.1](#5110-quick-reference-for-51)
- [5.1 open items and flags](#51-open-items-and-flags)

### 5.1.1 UDF variations, languages and handler location

A UDF extends the built-in functions. It always returns a value, so it suits calculations that you reuse. The logic lives in a **handler**. You create the UDF with SQL (`CREATE FUNCTION`), the Snowpark API, the Snowflake CLI, the Snowflake Python API, or the REST API.

**Variations**

| Variation | What it does |
|-----------|--------------|
| UDF (scalar) | One output row, with a single column, for each input row |
| UDAF | Takes values across many rows and returns one value (sum, average, estimates) |
| UDTF | Returns a table for each input row |
| Vectorized UDF | Receives batches of rows as a pandas DataFrame and returns a pandas array or Series |
| Vectorized UDTF | Receives batches as a pandas DataFrame and returns tabular results |

**Handler languages, location and sharing**

| Language | Handler location | Shareable (Secure Data Sharing) | Variations listed |
|----------|------------------|---------------------------------|-------------------|
| SQL | In-line only | Yes | UDF, UDTF |
| JavaScript | In-line only | Yes | UDF, UDTF |
| Java | In-line or staged | No (limits apply) | UDF, UDTF |
| Python | In-line or staged | No (limits apply) | UDF, UDAF, UDTF, vectorized UDF, vectorized UDTF |
| Scala | In-line or staged | No (limits apply) | UDF |

- Java, Python and Scala UDFs aren't plainly "no" for sharing. The overview marks them "No" with a footnote that points to a page of limits on sharing each language. I did not read those limit pages.
- Supported versions on the pages read: **Java 11, 17, 21**. **Scala 2.12, 2.13**. **Python 3.9 (deprecated), 3.10, 3.11, 3.12, 3.13, 3.14**. Set `RUNTIME_VERSION` in `CREATE FUNCTION` for Python and Scala. These lists change with releases.
- Handler code can sit in-line in the `CREATE FUNCTION` statement or on a stage. Java, Python and Scala take staged code through `IMPORTS` and (for Java and Scala) `TARGET_PATH`. `TARGET_PATH` can't overwrite an existing file. When you drop the UDF you must also `REMOVE` the JAR.
- In-line code uses `$$ ... $$` or single quotes. Use `$$` when the body contains single quotes.
- If handler code calls `CURRENT_DATABASE` or `CURRENT_SCHEMA`, it gets the database and schema that **contain the UDF**, not the session's.
- A handler can reach external network locations through **external network access** (`EXTERNAL_ACCESS_INTEGRATIONS`). It can record logs, traces and metrics to an event table. The role needs `USAGE` on the integration and `READ` on any secret it uses.
- Several UDFs can share a name. A function is identified by its **name plus argument types**. If a function has optional arguments (`DEFAULT`), you can't define another function with the same name and a different signature.
- Functions that read staged files: UDTFs can process multiple files in parallel, UDFs process them **serially**. If a query calls a UDF on staged files and also queries a view that calls **any** UDF or UDTF, the query fails.
- Create-time options such as `STRICT`, volatility and `NOT NULL` are in [1.4.22](../domain_1/d1-continuous-pipelines-concept.md#1422-udfs-and-stored-procedures).

[Back to contents](#contents)

### 5.1.2 SQL UDFs

- The body is a **SQL expression**. A scalar SQL UDF returns one value. Declared `RETURNS TABLE (...)`, it returns rows.
- Handler is always in-line. The page's example omits `LANGUAGE`: `CREATE FUNCTION area_of_circle(radius FLOAT) RETURNS FLOAT AS $$ pi() * radius * radius $$`.
- Scalar functions have a limit of **500 input arguments**.
- **Privileges are the owner's.** An unqualified table in the body is resolved in the **schema that contains the function**. The **owner** needs privileges on the objects the body references. The caller needs only `USAGE` on the function. This lets you expose a count from a table the caller can't query.
- The `NOT NULL` clause isn't enforced and `STRICT` isn't supported for SQL UDFs. See [1.4.22](../domain_1/d1-continuous-pipelines-concept.md#1422-udfs-and-stored-procedures).
- **Memoizable UDFs.** Add `MEMOIZABLE` to a scalar SQL UDF to cache its result.
  - Aim: speed up complex queries, such as repeated lookups into mapping tables in a **row access policy or masking policy**. The policy owner replaces the mapping-table subquery with the memoizable function.
  - Needs the `USE_CACHED_RESULT` session parameter set to `TRUE`.
  - Arguments must be constants of string, numeric, date/time or boolean types. No columns or semi-structured types.
  - Return a scalar type such as `BOOLEAN`. Don't return `OBJECT` or `VARIANT`. Be careful with `ARRAY` (cache size limit). Don't reference another memoizable function.
  - Cache limit is **10 KB** per function for the session. Past that, the function is not cached and acts as a normal UDF.
  - No cache reuse when the referenced table changes, access control on the table changes, the function calls a nondeterministic function, or it calls an external function or a non-SQL UDF.
  - `CHILD_QUERIES_WAIT_TIME` in `ACCOUNT_USAGE.QUERY_HISTORY` records the cached lookup time.

[Back to contents](#contents)

### 5.1.3 JavaScript UDFs

- Handler is in-line. Declared `LANGUAGE JAVASCRIPT`. The body is the function body, so use `return`.
- **Argument names are uppercase in the JavaScript code.** `CREATE FUNCTION add5(n DOUBLE) ... AS 'return N + 5;'` works. `return n + 5;` fails **at run time**, because the identifier `n` can't be resolved. To use a lowercase name, create the argument with double quotes (`"n"`).
- UDF and argument names must be legal JavaScript identifiers: start with a letter or `$`, then alphanumerics, `$` or `_`, and not a reserved word.
- Snowflake **does not validate JavaScript at creation**. A bad body is found when the UDF is called.
- **Type behavior**
  - All JavaScript numbers are doubles. A JavaScript UDF can't accept or return an integer except through conversion.
  - Dates and timestamps become JavaScript `Date` objects, equal to `TIMESTAMP_LTZ(3)`. Precision beyond milliseconds is lost. A `TIMESTAMP_NTZ` stops behaving as wall-clock time. A `TIMESTAMP_TZ` loses its time zone.
  - `BINARY` becomes `Uint8Array`.
  - `VARIANT`, `OBJECT` and `ARRAY` become native JavaScript objects and arrays, and back. Returned objects and arrays have size and depth limits.
- **NULL handling.** SQL `NULL` becomes JavaScript `undefined`. A returned `undefined` becomes SQL `NULL`. For non-variant types a returned `null` also gives SQL `NULL`. With `VARIANT`, JavaScript `null` maps to JSON `null`, and an `undefined` inside an object or array drops that element.
- A scalar JavaScript UDF has a limit of 500 input arguments. Recursion is allowed.
- JavaScript UDFs are shareable (see 5.1.1). Tabular JavaScript UDFs exist too (5.1.6).

[Back to contents](#contents)

### 5.1.4 Java, Python and Scala UDFs, including vectorized UDFs

**Python handler**
- Handler is a function (scalar) or a class (UDTF, UDAF). `CREATE FUNCTION ... LANGUAGE PYTHON RUNTIME_VERSION = '3.12' HANDLER = 'addone_py' AS $$ def addone_py(i): return i+1 $$;`
- Packages come from `PACKAGES = (...)`. Staged files and libraries come from `IMPORTS`.
- An exception thrown from the handler stops processing, and the query fails with an error message.

**Java handler:** `LANGUAGE JAVA`, `HANDLER = 'TestFunc.echoVarchar'` (class and method), optional `TARGET_PATH = '@~/testfunc.jar'` for the compiled JAR. With in-line Java, `TARGET_PATH` names where the compiled JAR is written.

**Scala handler:** `LANGUAGE SCALA`, `RUNTIME_VERSION = 2.12` or `2.13`. Scala UDFs support only scalar functions (the `TABLE` return type isn't supported for Scala UDFs).

**Vectorized Python UDFs**
- The function receives a **batch of rows as a pandas DataFrame** and returns a batch (pandas array or Series). You call it like any other Python UDF.
- Benefits: faster when your code works on batches, and less code when calling pandas-based libraries.
- Mark the handler in one of two ways: import `vectorized` from the `_snowflake` module and use `@vectorized(input=pandas.DataFrame)`, or set the attribute `handler._sf_vectorized_input = pandas.DataFrame`.
- Columns in the DataFrame are positional (`df[0]`, `df[1]`).
- Each call has a time limit of **180 seconds**. A DataFrame holds up to a few thousand rows. You can set a target batch size to stay inside the limit.
- No guarantee of which handler instance sees which batch.
- Vectorized UDFs are for Python. Snowpark supports them too (5.1.5).

[Back to contents](#contents)

### 5.1.5 Snowpark UDFs

You write the function on the client in Java, Python or Scala. Snowpark **uploads the code to an internal stage** and runs it **on the server, where the data is**. Data isn't moved to the client.

**Python (Snowpark)**
- **Anonymous UDF**: `udf(lambda x: x+1, return_type=IntegerType(), input_types=[IntegerType()])`. It lasts while the variable is in scope in the session.
- **Named UDF**: pass `name=` to `udf` or to `session.udf.register`. Needed to call it by name (`call_udf`) or from a later session.
- **Temporary by default.** A named UDF created with `register` or `udf` is **temporary** for the session. For a **permanent** UDF set `is_permanent=True` and also set `stage_location` (for example `@my_stage`). `replace=True` overwrites an existing UDF.
- Use `register` instead of `udf` when the code might run in several sessions. It avoids errors where the default `Session` can't be found.
- `session.udf.register_from_file` creates a UDF from a Python source file, local or on a stage.
- **Dependencies**
  - `session.add_import(...)` uploads local files, directories or zip files, or refers to a staged file. It accepts an `import_path` for the Python import name.
  - `session.add_packages(...)` and `session.add_requirements(path)` set **session-level** Anaconda packages. `@udf(packages=[...])` sets **UDF-level** packages and overrides the session ones.
  - To keep versions steady in production, create a **permanent** UDF (dependencies resolve once, at registration). For a temporary UDF, pin versions in the package spec (`"xgboost==1.5.0"`).
- A UDF created with `CREATE FUNCTION` can be called from Snowpark, and a Snowpark UDF can be called from SQL.
- Vectorized UDFs and UDTFs are available in Snowpark Python. The Snowpark page says they improve machine-learning inference.
- Snowpark can also create UDTFs (5.1.6) and UDAFs (5.1.7).

[Back to contents](#contents)

### 5.1.6 User-defined table functions (UDTFs)

A UDTF returns a set of rows (zero, one or many) with one or more columns for each input row. It sits in the `FROM` clause: `SELECT ... FROM TABLE(my_udtf(args))`.

- Limits: **500 input arguments and 500 output columns**.
- **SQL UDTF**: `RETURNS TABLE (col type, ...)`. The body must be a `SELECT`. The output columns must match the `RETURNS` list in number and type. At least one output column is required.
- **JavaScript and Java UDTFs** exist. The overview lists JavaScript UDTFs as in-line and shareable.
- **Python UDTF**: the handler is a **class** with these methods.

| Method | Required | Purpose |
|--------|----------|---------|
| `__init__(self)` | Optional | Set up state once **per partition**, before `process`. Can't output rows and takes only `self` |
| `process(self, *args)` | **Required** | Called per input row. Returns rows as tuples (`yield` or return an iterable) |
| `end_partition(self)` | Optional | Called after the last row of a partition. Returns rows as tuples |

- Partition the input with `TABLE(my_udtf(col1, col2) OVER (PARTITION BY col1))`. State kept in `__init__` lives for one partition.
- An exception from any method stops processing and the query fails.
- Very large partitions can make `end_partition` time out. The Snowpark page says to contact Snowflake Support to adjust the threshold.
- Code placed outside the class (before the class declaration) runs once before partition handling begins.
- Snowpark: register a UDTF with the same API as a UDF. The handler is a class and you give the output schema.
- UDTFs can process staged files in parallel, UDFs can't (5.1.1).

[Back to contents](#contents)

### 5.1.7 User-defined aggregate functions (UDAFs)

A UDAF takes values from many rows and returns one value. The page covers **Python** UDAFs, and Snowpark Python can create them too. They are not available in the People's Republic of China.

- Create with `CREATE AGGREGATE FUNCTION name(args) RETURNS type LANGUAGE PYTHON RUNTIME_VERSION = ... HANDLER = 'ClassName' AS $$ ... $$`. The `AGGREGATE` keyword is required.
- The handler is a class. Each aggregate state is built in child nodes, serialized and sent to a parent node to be merged.

| Method | Required | Purpose |
|--------|----------|---------|
| `__init__` | Yes | Initialize the internal state |
| `aggregate_state` | Yes | Return the current state. Must have the `@property` decorator. The state must be picklable. For complex state use a Python data class |
| `accumulate` | Yes | Add a new input row to the state |
| `merge` | Yes | Combine two intermediate states |
| `finish` | Yes | Produce the final result from the state |

- **Limits**
  - Serialized `aggregate_state` is at most **64 MB**.
  - You can't call a UDAF as a **window function** (no `OVER`).
  - It can't be used with `WITHIN GROUP`. The query fails.
  - `IMMUTABLE` isn't supported, so all aggregate functions are `VOLATILE` by default.
- Use `GROUP BY` as with built-in aggregates: `SELECT item, python_sum(price) FROM sales GROUP BY item`.

[Back to contents](#contents)

### 5.1.8 Secure UDFs

Add `SECURE` to `CREATE FUNCTION`, `ALTER FUNCTION` or `CREATE PROCEDURE`. Secure procedures follow the same pattern. Two goals: hide the definition and protect the data.

**Hide the definition**
- Unauthorized users (those without a role that **owns** the function) can't see the body, the list of imports, the handler name or the packages list.
- They still see parameter types, return type, handler language, null handling and volatility.
- The hiding applies to `SHOW FUNCTIONS`, `SHOW USER FUNCTIONS`, `DESCRIBE FUNCTION`, the `FUNCTIONS` Information Schema view, **Query Profile** and `GET_DDL`. For procedures, `SHOW PROCEDURES`, `DESCRIBE PROCEDURE` and the `PROCEDURES` view.
- `SECURE` has **no effect** on access to stages named in `IMPORTS`.
- For Java, Python and Scala handlers, secure functions run in **separate sandboxes** with no shared resources.
- Error messages for secure objects may be redacted.
- Check with `SHOW FUNCTIONS LIKE '...'`. The `IS_SECURE` column is `Y` or `N`.

**Protect the data**
- Regular UDFs benefit from optimizer pushdown, which reorders filters. A general filter might run before the filter that secures the data, and a user could deduce hidden rows. A **secure UDF is not given those optimizations**, so users can't indirectly reach the underlying data.
- **Trade-off: slower queries.** Make a UDF secure only when it protects sensitive data. Don't use `SECURE` for query convenience.
- If one object type (UDFs) is secure, secure other access paths to the same table (views) as well.
- Avoid pitfalls even with secure UDFs:
  - Don't expose **sequence-generated IDs**. A user can estimate the number of hidden rows from the gaps. Use `UUID_STRING()` or obfuscate the IDs.
  - Snowflake doesn't show scanned bytes or partitions for queries with secure functions. Run time can still hint at data size. In very high-security cases, materialize a separate table per role.
- **Sharing.** With a secure UDF shared to another account, `CURRENT_ROLE` and `CURRENT_USER` return **`NULL`**. Use **`CURRENT_ACCOUNT`** to authorize rows for a given consumer account.
- With masking policies, the column, the UDF and the masking policy must have matching data types.

[Back to contents](#contents)

### 5.1.9 Creating, granting and calling

**Privileges to create** (Domain 1's `CREATE FUNCTION` detail is in [1.4.22](../domain_1/d1-continuous-pipelines-concept.md#1422-udfs-and-stored-procedures))

| Object | Privilege |
|--------|-----------|
| Database | `USAGE` |
| Schema | `USAGE` and `CREATE FUNCTION` |
| Stage with handler code, libraries or read files | `USAGE` (external) or `READ` (internal) |
| External access integration | `USAGE` |
| Secret | `READ`, plus `USAGE` on its schema |

- The **owner** needs `USAGE` on the database and schema and the same stage access. Callers need `USAGE` on the function (`GRANT USAGE ON FUNCTION my_udf(number, number) TO ROLE r`). `CREATE FUNCTION` doesn't also allow creating data metric functions (those need `CREATE DATA METRIC FUNCTION`).
- `COPY GRANTS` with `CREATE OR REPLACE` copies all privileges **except OWNERSHIP** to the replacement.
- `OR REPLACE` and `IF NOT EXISTS` can't be used together. `CREATE OR REPLACE` is atomic (one transaction).
- You can't set `LOG_LEVEL` or `TRACE_LEVEL` in `CREATE FUNCTION`. Use `ALTER FUNCTION` or `CREATE OR ALTER FUNCTION`.
- If there's no active warehouse at creation, the UDF is created but isn't validated, and Snowflake says so.
- `CREATE OR ALTER FUNCTION` can't change `LANGUAGE`, `HANDLER`, volatility, null handling, `TARGET_PATH` or the input arguments. It can't switch a function and a procedure, a temporary and a permanent function, or a regular and an external function.

**Calling**
- Same as built-in functions in a `SELECT`. You can pass arguments **by position, by name** (`first_arg => 'one'`), or mixed. **Positional arguments must come before named ones.** Don't put double quotes around a named argument. Named arguments can pick between overloads that have different argument names.
- Snowpark, the Snowflake CLI, the Snowflake Python API and the REST API can also run UDFs.

[Back to contents](#contents)

### 5.1.10 Quick-reference for 5.1

| Topic | Fact |
|-------|------|
| In-line only handlers | SQL and JavaScript (and both are shareable) |
| Staged handlers | Java, Python, Scala |
| Scalar UDF argument limit | 500. UDTF: 500 in, 500 out |
| SQL UDF owner | Owner's privileges decide table access. Caller needs `USAGE` on the function |
| JavaScript argument names | Uppercase in code, unless created with double quotes |
| JavaScript validation | Not at creation. Errors appear at call time |
| JavaScript `NULL` | SQL `NULL` is `undefined` |
| Memoizable function | Scalar SQL UDF, `MEMOIZABLE`, 10 KB cache per session, needs `USE_CACHED_RESULT` |
| Vectorized Python UDF | pandas DataFrame in, 180-second limit, `_snowflake.vectorized` or `_sf_vectorized_input` |
| Snowpark UDF persistence | Temporary unless `is_permanent=True` and `stage_location` set |
| UDTF Python methods | `__init__` (optional), `process` (required), `end_partition` (optional) |
| UDAF Python methods | `__init__`, `aggregate_state` (property), `accumulate`, `merge`, `finish`, all required |
| UDAF limits | 64 MB state, no window use, no `WITHIN GROUP`, no `IMMUTABLE` |
| `SECURE` | Hides definition. Disables pushdown-type optimizations. Slows queries |
| Shared secure UDF | `CURRENT_ROLE` and `CURRENT_USER` return `NULL`. Use `CURRENT_ACCOUNT` |

[Back to contents](#contents)

### 5.1 open items and flags

- **Placement of the REST API, semantic views and Cortex items.** In the guide's two-column layout these bullets sit at the top of the right column. They are not 5.1. The notes on them are held outside this file until the section is confirmed.
- **Sharing limits for Java, Python and Scala UDFs.** The overview marks them "No" with footnotes. I did not read the limitation pages.
- **Not read:** the language-specific limitation pages for each UDF language, handler design constraints, data type mapping pages, Java and Scala UDTF pages, the vectorized UDTF page, Python UDF performance and global-state sections, and the Artifact Repository packages section.
- **Python versions.** The pages list 3.9 as deprecated and go up to 3.14. Check the current list before the exam.
- **Domain 1 cross-reference.** 1.4.22 in the Domain 1 notes says UDF depth is "also in Domain 3 of the study guide". The study guide places UDFs in **5.1**. 1.4.22 also says the secure UDF page was not read. 5.1.8 covers it.
