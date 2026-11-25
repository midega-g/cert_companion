# Domain 5: Data Transformation, Snowpark transformations (SnowPro Advanced: Data Engineer, DEA-C02)

Weight: **25%**. Domain 5 has sections 5.1 to 5.7. Notes are split by topic across these files: [d5-udfs-concept.md](d5-udfs-concept.md) (5.1 UDFs; 5.2 and 5.3 to come); [d5-semi-structured-data-concept.md](d5-semi-structured-data-concept.md) (5.4 semi-structured data); [d5-unstructured-data-and-cortex-concept.md](d5-unstructured-data-and-cortex-concept.md) (5.5 unstructured data, semantic views, Cortex, REST API); this file, 5.7 Snowpark for data transformations. Section 5.6 will get its own file. A section is added only after it is approved. The contents table below lists only the sections in this file.

## Contents

| Section | Topic | Status |
|---------|-------|--------|
| 5.7 | [Use Snowpark for data transformations](#57-use-snowpark-for-data-transformations) | Draft for approval |

---

## 5.7 Use Snowpark for data transformations

The study guide lists: understand Snowpark architecture, query and filter data using the Snowpark library, perform data transformations using Snowpark (for example, aggregations), and manipulate Snowpark DataFrames. The guide's resource list names the "Snowpark API", "Working with DataFrames" and "Handler writing in Snowpark" pages. The examples below use **Snowpark Python**, which is the language the DataFrame guide covers in depth. Java and Scala have their own guides that I did not read.

UDFs, UDTFs and UDAFs written with Snowpark are in [5.1.5](d5-udfs-concept.md#515-snowpark-udfs). Snowpark stored procedures belong to 5.3 and are not covered here yet.

**Sections in 5.7**

- [5.7.1 Snowpark architecture and pushdown](#571-snowpark-architecture-and-pushdown)
- [5.7.2 Sessions and setup](#572-sessions-and-setup)
- [5.7.3 Lazy evaluation: transformations and actions](#573-lazy-evaluation-transformations-and-actions)
- [5.7.4 Constructing DataFrames](#574-constructing-dataframes)
- [5.7.5 Querying and filtering: columns, expressions and identifiers](#575-querying-and-filtering-columns-expressions-and-identifiers)
- [5.7.6 Joins and combining DataFrames](#576-joins-and-combining-dataframes)
- [5.7.7 Aggregations and derived columns](#577-aggregations-and-derived-columns)
- [5.7.8 Semi-structured data in DataFrames](#578-semi-structured-data-in-dataframes)
- [5.7.9 Saving results, views, concurrency and pandas](#579-saving-results-views-concurrency-and-pandas)
- [5.7.10 Quick-reference for 5.7](#5710-quick-reference-for-57)
- [5.7 open items and flags](#57-open-items-and-flags)

### 5.7.1 Snowpark architecture and pushdown

- Snowpark is a library for **querying and processing data in Snowflake without moving the data** to the system where your application code runs. Libraries exist for **Java, Python and Scala**.
- **All computation runs inside Snowflake.** There is no separate cluster outside Snowflake. Scale and compute management are handled by Snowflake, on the elastic and serverless engine.
- **Pushdown for all operations**, including Snowflake UDFs. Snowpark pushes the data transformation and heavy lifting to Snowflake, so it can work with data of any size.
- The client builds a **SQL statement from native language constructs** (for example the `select` method instead of the string `'select column_name'`). You can still pass a SQL string, but native constructs give code completion and type checking.
- The core abstraction is the **DataFrame**: a relational dataset that is **evaluated lazily**. Building one does not retrieve data. An **action** sends the generated SQL to Snowflake. Delaying execution lets Snowpark batch many operations into one and **reduces the data transferred** between client and Snowflake.
- **UDFs can be created inline.** In Python you can pass a lambda to `udf`. Snowpark pushes the code to the server, so it runs where the data is and Snowflake can parallelize it.
- You can write Snowpark code in a **local environment** (Jupyter, VS Code, IntelliJ) or in a **Python worksheet** in Snowsight. For a stored procedure that automates work in Snowflake, the Python guide points to Python worksheets.
- A Snowpark **stored procedure can be scheduled as a task** to build a pipeline.

**Compared with the Snowflake Connector for Spark** (the page lists these benefits of Snowpark)

| Snowpark | Detail |
|----------|--------|
| Language-specific libraries | Patterns built for each language, no loss of performance or functionality |
| Local authoring | Jupyter, VS Code, IntelliJ |
| Pushdown | All operations, including Snowflake UDFs |
| No separate cluster | All computation runs in Snowflake |

[Back to contents](#contents)

### 5.7.2 Sessions and setup

- Every Snowpark app needs a **`Session`** (`from snowflake.snowpark import Session`). It authenticates with the **same mechanisms and parameters as the Snowflake Connector for Python** (account, user, role, warehouse, database, schema, and so on).
- **Dictionary of parameters:** `Session.builder.configs(connection_parameters).create()`. The `role`, `warehouse`, `database` and `schema` entries are optional.
- **`connections.toml`:** define a named connection, then `Session.builder.config("connection_name", "myconnection").create()`.
- The `account` value is the **account identifier without the `snowflakecomputing.com` suffix**.
- **SSO in a browser:** add `"authenticator": "externalbrowser"` to the parameters. Other options listed: the default authenticator, MFA, key pair, a proxy server and OAuth.
- **`session.close()`** cancels any queries that are still running on that session.
- **In a Python worksheet** the handler (for example `main`) receives a `Session` object. Use it to create DataFrames. A DataFrame returned from `main` shows as a table when the return type is **Table**. A `list` of `Row` from `collect` needs **Variant**. Other values that cast to a string use **String**.
- **Install:** `pip install snowflake-snowpark-python` or `conda install snowflake-snowpark-python`. For pandas methods add `[pandas]` or install `pandas` and `pyarrow`. **Snowflake Notebooks come with Snowpark for Python preinstalled.**
- **Python versions** listed as generally available: 3.9 (deprecated), 3.10, 3.11, 3.12, 3.13 and 3.14. This query shows what your account has: `SELECT DISTINCT runtime_version FROM SNOWFLAKE.INFORMATION_SCHEMA.PACKAGES WHERE language = 'python'`.
- **Logging:** by default Snowpark logs `INFO` messages to stdout. Change the level with Python's `logging.basicConfig(level=logging.DEBUG)`.

[Back to contents](#contents)

### 5.7.3 Lazy evaluation: transformations and actions

**The three steps** the DataFrame guide gives: construct a DataFrame from a source, specify the transformations, then run an action to retrieve the data.

- **Transformation methods** (`select`, `filter`, `join`, `sort`, `group_by` and so on) **return a new DataFrame** and do not change the original. They only define the SQL and **do not retrieve data**.
- You can **chain** transformations. The order matters, because each call works on the DataFrame returned by the previous call. In Snowpark you may need `select` and `filter` in a different order from SQL's `SELECT` and `WHERE`.
- An **action** evaluates the DataFrame and sends the SQL to Snowflake.

| Class | Action | What it does |
|-------|--------|--------------|
| `DataFrame` | `collect` | Returns the result as a `list` of `Row` objects |
| `DataFrame` | `count` | Returns the number of rows |
| `DataFrame` | `show` | Prints rows to the console. Default limit is **10 rows** (`show(20)` for 20) |
| `DataFrameWriter` | `save_as_table` | Writes the DataFrame to a table. No separate `collect` is needed |

- **`schema` property needs no action.** It returns a `StructType` of `StructField` objects. Column names are normalized: unquoted identifiers come back in **uppercase**, quoted ones keep their exact case.
- **`explain()`** prints the list of queries that would run to evaluate the DataFrame. It prints the **query execution plan** only if a single SELECT, DML or DDL statement will run.
- **`session.sql(...)`** also returns a DataFrame and also runs only on an action.

[Back to contents](#contents)

### 5.7.4 Constructing DataFrames

| Source | Call |
|--------|------|
| Table, view or **stream** | `session.table("name")` |
| Specified values | `session.create_dataframe([1, 2, 3, 4])`, optionally with `schema=["a", "b"]`, `Row(...)` objects or a `StructType` |
| A range | `session.range(1, 10, 2)` gives 1, 3, 5, 7, 9. Chain `.to_df("a")` to name the column |
| Files in a stage | `session.read.json("@stage/file")`, `.csv(...)` and so on, through a `DataFrameReader` |
| A SQL statement | `session.sql("SELECT ...")` |

- `create_dataframe([1, 2, 3, 4]).to_df("a")` creates one column. `create_dataframe([[1, 2, 3, 4]], schema=[...])` creates one row with four columns.
- The `table` method and `read` property give better syntax highlighting, error highlighting and code completion than `sql`, even though `sql` can run the same SELECT.

**Reading staged files with `DataFrameReader`**

1. Get the reader from `session.read`.
2. For **CSV**, set a schema with `.schema(StructType([StructField(...), ...]))`. Other formats such as **JSON are read as a single VARIANT column named `$1`**, so no schema is needed.
3. Set file format options with `option(name, value)` (chainable) or `options({...})` (a dictionary). Names and values follow `CREATE FILE FORMAT`. Copy options from `COPY INTO <table>` are allowed too, but they **can make the execution strategy more expensive**.
4. Call the format method (for example `csv("@stage/path")`).
5. Transform, then run an action. Nothing is read before the action.

- To reach a JSON path use `sql_expr("$1:color")`. `sql_expr` does not interpret the string. It lets you use SQL snippets Snowpark does not support yet.
- **`session.file.put`** (client apps outside Snowflake) uploads local files to an internal stage. It does not insert the contents into a table. After upload, use `session.read` or `COPY INTO` to query or load.
- **`session.sql` and transformations.** `filter`, `select` and so on work only if the underlying statement is a **SELECT**. For something like `ls @my_stage` a `filter` fails with a SQL compilation error.

[Back to contents](#contents)

### 5.7.5 Querying and filtering: columns, expressions and identifiers

- **`filter`** keeps matching rows: `df.filter(col("id") == 1)`. Expressions work too: `(col("a") + col("b")) < 10` is `WHERE a + b < 10`.
- **`select`** chooses columns: `select(col("id"), col("name"))`. You can also pass strings (`select("id", "name")`), `df["id"]` or `df.id`.
- **`col`** (from `snowflake.snowpark.functions`) creates a `Column` object. `Column` objects can sit in filters, projections and join conditions.
- **Alias:** `(col("b") * 10).as_("c")` or `.alias("c")` is `SELECT b * 10 AS c`.
- **`lit(5)`** makes a `Column` for a literal, for example `col("num_items") > lit(5)`.
- **`cast`** converts a column. For example `lit(0.05).cast(DecimalType(5, 2))` gives NUMBER(5,2).
- **`DataFrame.col("name")`** (`df1.col("name")`) refers to a column in a specific DataFrame. Use it when two DataFrames share a column name.

**Identifiers and quoting**

- Snowflake treats a name as **uppercase** unless it is in double quotes. `col("id123")` and `col("ID123")` are the same column.
- **Column names:** Snowpark adds the double quotes for you if the name does not meet the identifier rules (for example `col("3rdID")` or `col("id with space")`). If you already quoted the name, it adds none.
- **Table names:** you must quote a name that is not a valid identifier, for example `session.table('"10tablename"')` or `session.table("\"10tablename\"")`.
- A quoted identifier is **case-sensitive**. `col("id with space")` works. `col("ID WITH SPACE")` fails with `invalid identifier '"ID WITH SPACE"'`.
- A double quote inside a quoted identifier is written as two double quotes, for example `"name_with_""air""_quotes"`.

[Back to contents](#contents)

### 5.7.6 Joins and combining DataFrames

- **Join on a condition:** `df_lhs.join(df_rhs, df_lhs.col("key") == df_rhs.col("key"))`.
- **Join on a shared column name:** `df_lhs.join(df_rhs, ["key"])`. The result has one `KEY` column.
- **Combine conditions** with `&`. The `|` and `~` operators work the same way.
- **Overlapping column names.** If both sides have the same column name and you join on a condition, Snowpark **adds a random prefix** to the overlapping columns (for example `l_av5t_KEY`). To control the names:
  - Rename with `alias` in a following `select`.
  - Or pass `lsuffix="_left", rsuffix="_right"` to `join` to get `KEY_LEFT` and `KEY_RIGHT`.
- **Self-join.** Joining a DataFrame with itself **fails** (`SnowparkJoinException`), because the column references cannot be resolved. Make a copy with `copy.copy(df)` and join the DataFrame to its copy.
- **`union_all(other)`** returns all rows from both DataFrames **including duplicates**. Both DataFrames must have the **same number of columns**. In the example the result keeps the column names of the first DataFrame (`A`, `B`) even though the second used `C` and `D`.

[Back to contents](#contents)

### 5.7.7 Aggregations and derived columns

- **`group_by(...)`** defines the groups and returns a **`RelationalGroupedDataFrame`**. It is like SQL `GROUP BY`. It does not compute anything until you call an aggregation method such as **`agg`**.
- **With no columns** (`df.group_by()` or `df.group_by([])`) the whole DataFrame is one group.
- You can group by column names, `Column` objects or a list of them. Literals work too: `group_by(["a", lit("snow")])`.
- **`agg(...)`** returns a DataFrame with the computed aggregates. It accepts:
  - A `Column`, such as `sum_("b")`. Import aggregate functions from `snowflake.snowpark.functions` (the example renames `sum` and `max` to `sum_` and `max_` so they do not shadow Python's).
  - A **tuple** of (column or column name, aggregate function name), such as `(col("*"), "count")`.
  - A list of those.
  - A **dictionary** mapping column names to aggregate function names.
- The function name in a tuple or dictionary must be a **valid Snowflake aggregate function**.
- **Several aggregates at once:** `df.group_by("a").agg(sum_("b").alias("sum_b"), max_("b").alias("max_b"))`.
- **Shortcuts on the grouped DataFrame:** `df.group_by("a").median("b")`, or `df.group_by("a").function("avg")("b")` for any aggregate by name.
- **Default column names.** An un-aliased aggregate is named after the expression, for example `SUM(B)`. Use `alias` to name it.
- **`sort("a")`** orders the result. The page examples call `sort` after `agg`.
- **`with_column(name, expr)`** adds a column, or **replaces** a column with the same name. `keep_column_order=True` keeps the original column position when replacing. Its second argument can also be a UDTF call that produces one column.

**Example: aggregate and save**

```python
df = session.table("transaction_customer1")
df_agg = (df.filter((col("value") > 0) & col("category").is_not_null())
            .with_column("month", month(col("date")))
            .group_by(col("category"), col("month"))
            .agg(sum_("value").alias("total_value")))
df_agg.write.save_as_table("aggregate_customers", mode="append")
```

[Back to contents](#contents)

### 5.7.8 Semi-structured data in DataFrames

[5.4](d5-semi-structured-data-concept.md) covers the SQL side. This section is the DataFrame side, from the same guide.

- **Field of an OBJECT** (or a VARIANT holding one): `col("src")["dealership"]`.
- **Element of an ARRAY:** `col("src")["vehicle"][0]`. Chain brackets to go deeper: `df["src"]["vehicle"][0]["price"]`.
- For irregular field names or paths use **`get`**, **`get_ignore_case`** or **`get_path`** (for example `get_path(col("src"), lit("vehicle[0].make"))`).
- **Values come back as strings, with their JSON double quotes.** Call **`cast`** (for example `.cast(StringType())`) to get a real type.
- **Flatten an array of objects into rows:** `df.join_table_function("flatten", col("src")["customer"])`. It is equivalent to the SQL `FLATTEN` function. Output columns include `SEQ`, `KEY`, `PATH`, `INDEX`, `VALUE` and `THIS`. Select fields from `VALUE`, cast them and rename them with `as_`.
- Reading staged JSON gives a single VARIANT column `$1` (see 5.7.4).

[Back to contents](#contents)

### 5.7.9 Saving results, views, concurrency and pandas

**Saving data**

- **`df.write.mode("overwrite").save_as_table("table1")`.** Get a `DataFrameWriter` with `write`, set the mode with `mode`, then call `save_as_table`. This statement runs on its own without `collect`. The aggregation example above passes `mode="append"` straight to `save_as_table`.
- **`create_or_replace_view("db.schema.view")`** creates a **persistent view** immediately. Drop it yourself when you no longer need it.
- **`create_or_replace_temp_view`** creates a **temporary view** that exists only in the session that created it.

**Concurrency** (needs Snowpark Python **1.24 or later** and server version **8.46 or later**)

- **Thread-safe `Session` objects** let several threads submit queries on the same session, for example to filter and aggregate several tables at the same time or to run several `COPY INTO` commands.
- Inside Snowflake (for example in a stored procedure) the Snowpark Python server releases the Python **GIL** before submitting queries, so queries from several threads can run in parallel.
- **Async jobs** are the other option. They avoid waiting without managing a thread pool. The two can be combined.
- **Limits:** one session's threads **do not support concurrent transactions**, so use separate sessions for that. Do not change session settings (database, schema, warehouse, or client settings such as `cte_optimization_enabled` and `sql_simplifier_enabled`) while other threads are active. Use separate sessions if threads need different settings.

**pandas**

- **`to_pandas()`** returns the DataFrame as a pandas DataFrame. It needs pandas 1.0.0 or later and PyArrow.
- **Snowpark DataFrames vs pandas on Snowflake**

| Choose pandas on Snowflake if you | Choose Snowpark DataFrames if you |
|-----------------------------------|-----------------------------------|
| Prefer pandas or have pandas code | Prefer Spark or have Spark code |
| Do interactive analysis and exploration | Do batch processing with limited iteration |
| Want operations executed immediately | Are comfortable with lazy evaluation |
| Want consistent, ordered data | Accept unordered data |
| Accept slower performance for an easier API | Care more about performance than ease of use |

- Snowpark DataFrames are modeled on **PySpark**. They operate on the original data source and **do not keep order**. pandas on Snowflake is modeled on **pandas**. It works on a snapshot and keeps order and positional indexing.

[Back to contents](#contents)

### 5.7.10 Quick-reference for 5.7

| Topic | Fact |
|-------|------|
| Where Snowpark code runs | Inside Snowflake. Pushdown for all operations, no separate cluster |
| Evaluation | Lazy. Transformations return new DataFrames. Actions run the SQL |
| Actions | `collect`, `count`, `show` (10 rows default), `save_as_table` |
| No action needed | `schema` property. `save_as_table` runs on its own |
| Session | `Session.builder.configs(dict).create()` or `.config("connection_name", ...)`. `close()` cancels running queries |
| Account value | Account identifier without `snowflakecomputing.com` |
| Read CSV | Needs `schema(StructType(...))` |
| Read JSON | One VARIANT column `$1` |
| `session.sql` | Transformations work only on SELECT statements |
| Identifiers | Uppercase unless quoted. Quoted means case-sensitive |
| Column quoting | Snowpark adds quotes for non-conforming column names. Table names must be quoted by you |
| Join, shared column | `join(other, ["key"])` gives one key column |
| Join, overlapping names | Random prefix, unless you use `alias` or `lsuffix` and `rsuffix` |
| Self-join | Fails. Use `copy.copy(df)` |
| `union_all` | Keeps duplicates, same number of columns required |
| `group_by()` with no columns | One group for the whole DataFrame |
| `agg` input | `Column`, `(col, "func")` tuple, list, or dict. Function must be a Snowflake aggregate |
| `with_column` | Adds, or replaces a column of the same name |
| Semi-structured | `col["field"]`, `col[0]`, `get_path`. Cast values. `join_table_function("flatten", ...)` |
| Views | `create_or_replace_view` persistent. `create_or_replace_temp_view` session only |
| Concurrency | Thread-safe sessions need Snowpark Python 1.24+ and server 8.46+. No concurrent transactions on one session |

[Back to contents](#contents)

### 5.7 open items and flags

- **Language scope.** I read the Python pages. The Java and Scala developer guides were not read, so method names and behaviors there may differ.
- **Not read:** the stored procedure and UDF Snowpark pages (`creating-sprocs`, `creating-udfs`) beyond the overview, the Python worksheets page, the API reference for `sort`, `drop`, `distinct`, `pivot`, `unpivot`, `na`, `sample` and `limit`, window functions (`Window`), async jobs, `DataFrame.queries`, and the "Handler writing in Snowpark" page the study guide lists.
- **Aggregations beyond the examples.** The DataFrame guide does not have an aggregation section. I used the `group_by` and `agg` API reference pages. `pivot`, `rollup`, `cube` and window functions were not read.
- **"Understand Snowpark architecture."** The Snowflake pages I read describe pushdown, lazy evaluation and the client library. I found no page called "architecture". Check whether the exam expects more (for example the server-side Python sandbox or the packages model).
- **`join` types.** The `how` parameter (inner, left, and so on) was not read. The examples use the default.
- **`save_as_table` modes.** The guide points to the API reference for modes. I only saw `overwrite` and `append`.
- **Python versions.** The setup page lists 3.9 as deprecated and goes up to 3.14, and gives client version dependencies (1.5.0, 1.5.1, 1.9.0). Check the current list before the exam.
- **Scope of async jobs.** The concurrency page mentions async jobs but does not describe the API.
