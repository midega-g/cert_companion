# Subdomain 3.3: Connectors & Integrations — End-to-End Walkthroughs

Companion to `concepts.md`. Each item is shown **end-to-end**: setup → command → **what you actually see** (connection output, integration properties, staged repo files). Because integrations require a paired cloud/Git-side step, those are shown too.

> Convention:
> - 🟢 = success
> - Output blocks show the **actual command result or connection behavior**.

---

## 1. Python Connector — End to End

### Step 1: Install and connect
```bash
pip install snowflake-connector-python
```
```python
import snowflake.connector

conn = snowflake.connector.connect(
    account='xy12345.us-east-1',
    user='jdoe',
    password='***',          # or private_key for key-pair auth
    warehouse='analyst_wh',
    database='sales_db',
    schema='public',
    role='analyst',
)
cur = conn.cursor()
cur.execute("SELECT COUNT(*) FROM orders")
print(cur.fetchone())
```
🟢 What you see:
```
(128,)
```

### pandas helper (connector feature drivers don't have)
```python
from snowflake.connector.pandas_tools import write_pandas
write_pandas(conn, my_dataframe, 'ORDERS')   # bulk-load a DataFrame
```

**Point driven home:** The **connector** adds Python-native conveniences (`write_pandas`, `fetch_pandas_all`) on top of raw connectivity — that's what distinguishes a *connector* from a generic *driver*.

---

## 2. JDBC / ODBC Drivers — End to End

### JDBC connection string (used by Java tools)
```
jdbc:snowflake://xy12345.us-east-1.snowflakecomputing.com/?
     warehouse=analyst_wh&db=sales_db&schema=public&role=analyst
```
```java
Connection conn = DriverManager.getConnection(url, "jdoe", "***");
```

### ODBC (used by Tableau, Power BI, Excel)
```
[Snowflake]
Driver      = SnowflakeDSIIDriver
Server      = xy12345.us-east-1.snowflakecomputing.com
Database    = sales_db
Warehouse   = analyst_wh
Role        = analyst
```
🟢 In Tableau/Power BI you pick the Snowflake connector, enter the server + credentials, and tables appear for drag-and-drop.

**Point driven home:** Drivers implement **standards** (JDBC/ODBC), so *any* conforming BI/ETL tool connects the same way — no Snowflake-specific code required.

---

## 3. Storage Integration (AWS S3) — End to End

### Step 1: Create the integration (Snowflake side)
```sql
USE ROLE ACCOUNTADMIN;
CREATE STORAGE INTEGRATION s3_int
  TYPE = EXTERNAL_STAGE
  STORAGE_PROVIDER = 'S3'
  ENABLED = TRUE
  STORAGE_AWS_ROLE_ARN = 'arn:aws:iam::123456789012:role/snowflake-s3-role'
  STORAGE_ALLOWED_LOCATIONS = ('s3://my-bucket/orders/');
```

### Step 2: Get the values to trust (the crucial handshake)
```sql
DESC INTEGRATION s3_int;
```
```
+---------------------------+-------------------------------------------------+
| property                  | property_value                                  |
|---------------------------+-------------------------------------------------|
| STORAGE_AWS_IAM_USER_ARN  | arn:aws:iam::999:user/snowflake-abc             |  <- put in trust policy
| STORAGE_AWS_EXTERNAL_ID   | XY12345_SFCRole=2_a1b2c3...                      |  <- put in trust policy
| STORAGE_ALLOWED_LOCATIONS | s3://my-bucket/orders/                          |
+---------------------------+-------------------------------------------------+
```
> **AWS side:** edit the IAM role's trust policy to allow that `IAM_USER_ARN` to assume it, with `sts:ExternalId` = the `EXTERNAL_ID`. This is the two-way handshake.

### Step 3: Use it in a stage — no credentials in SQL
```sql
CREATE STAGE orders_stage
  URL = 's3://my-bucket/orders/'
  STORAGE_INTEGRATION = s3_int
  FILE_FORMAT = (TYPE = CSV);

LIST @orders_stage;
```
🟢
```
+---------------------------+------+-------------------------------+
| name                      | size | last_modified                 |
|---------------------------+------+-------------------------------|
| orders_stage/f1.csv       | 250  | 2026-09-23 19:10:00           |
+---------------------------+------+-------------------------------+
```

**Point driven home:** The stage references the **integration**, not keys. Credentials never appear in SQL, and the same `s3_int` can back many stages. Note `STORAGE_ALLOWED_LOCATIONS` blocks access to buckets outside the allowed list.

---

## 4. API Integration (external function) — End to End

### Step 1: Create the API integration
```sql
USE ROLE ACCOUNTADMIN;
CREATE API INTEGRATION aws_api_int
  API_PROVIDER = aws_api_gateway
  API_AWS_ROLE_ARN = 'arn:aws:iam::123456789012:role/snowflake-apigw-role'
  API_ALLOWED_PREFIXES = ('https://abc123.execute-api.us-east-1.amazonaws.com/prod/')
  ENABLED = TRUE;
```

### Step 2: Fetch trust values, then create the external function
```sql
DESC INTEGRATION aws_api_int;   -- returns API_AWS_IAM_USER_ARN + API_AWS_EXTERNAL_ID to trust on AWS

CREATE EXTERNAL FUNCTION sentiment(text STRING)
  RETURNS VARIANT
  API_INTEGRATION = aws_api_int
  AS 'https://abc123.execute-api.us-east-1.amazonaws.com/prod/sentiment';
```

### Step 3: Call it like any SQL function
```sql
SELECT review_id, sentiment(review_text) AS score FROM reviews LIMIT 3;
```
🟢
```
+-----------+------------------+
| REVIEW_ID | SCORE            |
|-----------+------------------|
| 1         | {"label":"POS"}  |  <- computed by external Lambda via API Gateway
| 2         | {"label":"NEG"}  |
+-----------+------------------+
```

**Point driven home:** The API integration holds the **auth to the gateway**; the external function just names the endpoint. Snowflake assumes the IAM role to call your API — no keys in the function definition.

---

## 5. Git Integration — End to End

### Step 1: API integration for the Git host
```sql
USE ROLE ACCOUNTADMIN;
CREATE API INTEGRATION git_api_int
  API_PROVIDER = git_https_api
  API_ALLOWED_PREFIXES = ('https://github.com/my-org')
  ENABLED = TRUE;
```

### Step 2: (Private repo) store a token as a secret
```sql
CREATE SECRET github_pat
  TYPE = PASSWORD
  USERNAME = 'jdoe'
  PASSWORD = 'ghp_xxxxxxxxxxxx';   -- personal access token
```

### Step 3: Create the Git repository object
```sql
CREATE GIT REPOSITORY sql_repo
  API_INTEGRATION = git_api_int
  GIT_CREDENTIALS = github_pat
  ORIGIN = 'https://github.com/my-org/snowflake-scripts.git';
```

### Step 4: Fetch and browse the repo like a stage
```sql
ALTER GIT REPOSITORY sql_repo FETCH;
LS @sql_repo/branches/main/;
```
🟢
```
+-----------------------------------------+------+-------------------------------+
| name                                    | size | last_modified                 |
|-----------------------------------------+------+-------------------------------|
| sql_repo/branches/main/deploy.sql       | 1204 | 2026-09-23 18:00:00           |
| sql_repo/branches/main/tables/orders.sql| 640  | 2026-09-23 18:00:00           |
+-----------------------------------------+------+-------------------------------+
```

### Step 5: Run versioned SQL straight from the repo
```sql
EXECUTE IMMEDIATE FROM @sql_repo/branches/main/deploy.sql;
```
🟢
```
+----------------------------------+
| status                           |
|----------------------------------|
| Statement executed successfully. |
+----------------------------------+
```

**Point driven home:** Git integration layers on an **API integration** (+ optional secret). Once fetched, the repo behaves like a **read-only stage** you can `LS` and `EXECUTE IMMEDIATE FROM` — enabling version-controlled deployments inside Snowflake.

---

## Verify Any Integration

```sql
SHOW INTEGRATIONS;
```
```
+---------------+----------------+----------+---------+
| name          | type           | category | enabled |
|---------------+----------------+----------+---------|
| S3_INT        | EXTERNAL_STAGE | STORAGE  | true    |
| AWS_API_INT   | EXTERNAL_API   | API      | true    |
| GIT_API_INT   | GIT_HTTPS_API  | API      | true    |
+---------------+----------------+----------+---------+
```

---

## Mental Model Recap

| Item | You run/write… | You see… | Key takeaway |
|------|----------------|----------|--------------|
| Python connector | `snowflake.connector.connect(...)` | query results, `write_pandas` | Language-native conveniences |
| JDBC/ODBC driver | connection string / DSN | tables in BI tool | Standards → any tool connects |
| Storage integration | `CREATE STORAGE INTEGRATION` + `DESC` | IAM_USER_ARN + EXTERNAL_ID to trust | Credential-free stages; two-way handshake |
| API integration | `CREATE API INTEGRATION` + external fn | function returns external result | Snowflake assumes role to call API |
| Git integration | API integration + secret + `GIT REPOSITORY` | repo files as a stage | Versioned SQL via `EXECUTE IMMEDIATE FROM` |

> ⚠️ **Verify before exam/production:** exact integration property names (`STORAGE_AWS_IAM_USER_ARN`, `API_AWS_EXTERNAL_ID`), `GIT_CREDENTIALS`/secret syntax, and provider values (`git_https_api`, `aws_api_gateway`) change over time. Confirm against current Snowflake docs.
