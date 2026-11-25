# Domain 5: Data Transformation, semi-structured data (SnowPro Advanced: Data Engineer, DEA-C02)

Weight: **25%**. Domain 5 has sections 5.1 to 5.7. Notes are split by topic across these files: [d5-udfs-concept.md](d5-udfs-concept.md) (5.1 UDFs; 5.2 and 5.3 to come); this file, 5.4 semi-structured data; [d5-unstructured-data-and-cortex-concept.md](d5-unstructured-data-and-cortex-concept.md) (5.5 unstructured data, semantic views, Cortex, REST API); [d5-snowpark-transformations-concept.md](d5-snowpark-transformations-concept.md) (5.7 Snowpark for data transformations). Section 5.6 will get its own file. A section is added only after it is approved. The contents table below lists only the sections in this file.

## Contents

| Section | Topic | Status |
|---------|-------|--------|
| 5.4 | [Handle and transform semi-structured data](#54-handle-and-transform-semi-structured-data) | Draft for approval |

---

## 5.4 Handle and transform semi-structured data

The study guide lists: traverse and transform semi-structured data to structured data, and transform structured data to semi-structured data. The linked functions are `ARRAY_AGG`, `OBJECT_CONSTRUCT` and `TRY_PARSE_JSON`.

Domain 1 already covers the storage side: the three types, the 128 MB limit, VARIANT versus flattened columns, SQL NULL versus JSON null, subcolumnarization and `STRIP_NULL_VALUES`. See [1.2.6](../domain_1/d1-ingest-data-formats-concept.md#126-semi-structured-data-in-variant) and [1.1.4](../domain_1/d1-load-data-concept.md#114-preparing-data-files). These notes cover querying and transforming.

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

**Examples with expected output.** I worked these out by hand from the documented behavior and did not run them in a Snowflake account. Row order is not guaranteed without `ORDER BY`. `THIS` is left out of the outputs to keep them readable.

*1. FLATTEN an array.*

```sql
SELECT seq, key, path, index, value
FROM TABLE(FLATTEN(INPUT => PARSE_JSON('["a","b"]')));
```

| SEQ | KEY | PATH | INDEX | VALUE |
|-----|-----|------|-------|-------|
| 1 | NULL | [0] | 0 | "a" |
| 1 | NULL | [1] | 1 | "b" |

`KEY` is NULL for arrays. `VALUE` is a VARIANT, so strings keep their JSON quotes until you cast with `::string`.

*2. FLATTEN an object, then with `RECURSIVE`.*

```sql
SELECT key, path, index, value
FROM TABLE(FLATTEN(INPUT => PARSE_JSON('{"a":1,"b":[77,88]}')));
```

| KEY | PATH | INDEX | VALUE |
|-----|------|-------|-------|
| a | a | NULL | 1 |
| b | b | NULL | [77,88] |

Add `RECURSIVE => TRUE` to the same call and it also expands the array inside `b`:

| KEY | PATH | INDEX | VALUE |
|-----|------|-------|-------|
| a | a | NULL | 1 |
| b | b | NULL | [77,88] |
| NULL | b[0] | 0 | 77 |
| NULL | b[1] | 1 | 88 |

*3. LATERAL FLATTEN over a table.* Sample data:

```sql
CREATE OR REPLACE TEMPORARY TABLE orders AS
SELECT 1 AS id, PARSE_JSON('{"customer":"Ann","items":[
         {"sku":"A1","qty":2,"tags":["gift","fragile"]},
         {"sku":"B7","qty":1,"tags":["gift"]}]}') AS src
UNION ALL
SELECT 2, PARSE_JSON('{"customer":"Bob","items":[]}')
UNION ALL
SELECT 3, PARSE_JSON('{"customer":"Cy","items":[{"sku":"A1","qty":5,"tags":[]}]}');
```

```sql
SELECT o.id, o.src:customer::string AS customer, f.index,
       f.value:sku::string AS sku, f.value:qty::int AS qty
FROM orders o, LATERAL FLATTEN(INPUT => o.src:items) f
ORDER BY o.id, f.index;
```

| ID | CUSTOMER | INDEX | SKU | QTY |
|----|----------|-------|-----|-----|
| 1 | Ann | 0 | A1 | 2 |
| 1 | Ann | 1 | B7 | 1 |
| 3 | Cy | 0 | A1 | 5 |

Order 2 has an empty `items` array, so it produces **no rows** and disappears. Each source column (`id`, `customer`) is repeated for every flattened row.

*4. `OUTER => TRUE` keeps the empty order.* Change the join to `LATERAL FLATTEN(INPUT => o.src:items, OUTER => TRUE) f`:

| ID | CUSTOMER | INDEX | SKU | QTY |
|----|----------|-------|-----|-----|
| 1 | Ann | 0 | A1 | 2 |
| 1 | Ann | 1 | B7 | 1 |
| 2 | Bob | NULL | NULL | NULL |
| 3 | Cy | 0 | A1 | 5 |

*5. Nested arrays need one LATERAL FLATTEN per level.* The second call reads the first call's `value`.

```sql
SELECT o.id, i.value:sku::string AS sku, t.value::string AS tag
FROM orders o,
     LATERAL FLATTEN(INPUT => o.src:items) i,
     LATERAL FLATTEN(INPUT => i.value:tags) t
ORDER BY o.id, sku, tag;
```

| ID | SKU | TAG |
|----|-----|-----|
| 1 | A1 | fragile |
| 1 | A1 | gift |
| 1 | B7 | gift |

Order 3's `tags` array is empty, so it drops out. Add `OUTER => TRUE` to the second call to keep it with a NULL tag.

*6. LATERAL as a correlated subquery.* `LATERAL` is not limited to `FLATTEN`. The inline view runs once per left-hand row and can use that row's columns.

```sql
SELECT o.id, l.total_qty
FROM orders o,
     LATERAL (SELECT SUM(f.value:qty::int) AS total_qty
              FROM TABLE(FLATTEN(INPUT => o.src:items)) f) l
ORDER BY o.id;
```

| ID | TOTAL_QTY |
|----|-----------|
| 1 | 3 |
| 2 | NULL |
| 3 | 5 |

Here order 2 **is kept**, because an aggregate over zero rows still returns one row (NULL). That differs from example 3, where the table function itself returns zero rows.

*7. Equivalent without LATERAL (single level only).*

```sql
SELECT o.id, f.value:sku::string AS sku
FROM orders o, TABLE(FLATTEN(INPUT => o.src:items)) f;
```

Same rows as example 3 for `id` and `sku`. For nested arrays, as in example 5, use `LATERAL`.

**Uses beyond flattening one array**
- Filter on key-value pairs: `FROM pets a, LATERAL FLATTEN(input => a.v) b WHERE b.value LIKE '%dog%'`.
- List the distinct key names and paths in unknown data with `RECURSIVE => TRUE`, using the `PATH` and `KEY` output columns and `TYPEOF(value)`. The page applies `REGEXP_REPLACE` to `PATH` to turn array indexes such as `[0]` into `[]`, so array elements group into one path.
- Flatten a staged file in `CREATE TABLE AS SELECT`. `FLATTEN` is not allowed inside a `COPY INTO` transform (see [1.1.10](../domain_1/d1-load-data-concept.md#1110-simple-transformations-during-load)).

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

The two kinds of NULL, and how storage treats them, are in [1.2.6](../domain_1/d1-ingest-data-formats-concept.md#126-semi-structured-data-in-variant). Functions to work with them:

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
