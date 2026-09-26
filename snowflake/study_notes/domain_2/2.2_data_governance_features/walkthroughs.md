# Domain 2: Governance Features — End-to-End Walkthroughs

This is the companion to `domain_2_data_governance.md`. Where that file explains *what* each feature is, this file walks through each command **end-to-end**: setup → apply → **what the user actually sees** (before/after), plus how to verify and clean up.

> Convention used below:
> - 🟢 `ADMIN`-type role = privileged / authorized user
> - 🔵 `ANALYST` / `MARKETING` etc. = restricted / unauthorized user
> - Output blocks show the **actual result set** a user would see in Snowsight/CLI.

---

## Shared Setup (used by several examples)

```sql
USE ROLE ACCOUNTADMIN;
CREATE DATABASE IF NOT EXISTS gov_demo;
CREATE SCHEMA IF NOT EXISTS gov_demo.hr;
USE SCHEMA gov_demo.hr;

CREATE OR REPLACE TABLE employees (
  emp_id     INT,
  full_name  STRING,
  email      STRING,
  region     STRING,
  salary     NUMBER
);

INSERT INTO employees VALUES
  (1, 'Alice Kamau',   'alice@corp.com',   'EMEA', 120000),
  (2, 'Brian Otieno',  'brian@corp.com',   'APAC',  95000),
  (3, 'Carla Mendez',  'carla@corp.com',   'EMEA', 110000),
  (4, 'David Wanjiru', 'david@corp.com',   'AMER', 105000);

-- Two demo roles
CREATE ROLE IF NOT EXISTS analyst;   -- restricted
CREATE ROLE IF NOT EXISTS hr_admin;  -- privileged
GRANT USAGE ON DATABASE gov_demo TO ROLE analyst;
GRANT USAGE ON SCHEMA gov_demo.hr TO ROLE analyst;
GRANT SELECT ON TABLE employees TO ROLE analyst;
-- (repeat grants for hr_admin)
```

**Baseline — what everyone sees before any policy:**

```sql
SELECT emp_id, full_name, email, salary FROM employees;
```
```
+--------+---------------+------------------+--------+
| EMP_ID | FULL_NAME     | EMAIL            | SALARY |
|--------+---------------+------------------+--------|
|      1 | Alice Kamau   | alice@corp.com   | 120000 |
|      2 | Brian Otieno  | brian@corp.com   |  95000 |
|      3 | Carla Mendez  | carla@corp.com   | 110000 |
|      4 | David Wanjiru | david@corp.com   | 105000 |
+--------+---------------+------------------+--------+
```
We'll now progressively lock this down and show how the output changes per role.

---

## 1. Object Tagging — End to End

### Step 1: Create the tag
```sql
USE ROLE ACCOUNTADMIN;
CREATE TAG gov_demo.hr.pii
  ALLOWED_VALUES 'name', 'email', 'phone'
  COMMENT = 'Marks columns holding personal data';
```
> `ALLOWED_VALUES` constrains what strings the tag can hold — setting an out-of-list value later will error.

### Step 2: Apply the tag to columns
```sql
ALTER TABLE employees MODIFY COLUMN full_name SET TAG gov_demo.hr.pii = 'name';
ALTER TABLE employees MODIFY COLUMN email     SET TAG gov_demo.hr.pii = 'email';
```

### Step 3: What you see when inspecting tags
```sql
SELECT * FROM TABLE(
  gov_demo.INFORMATION_SCHEMA.TAG_REFERENCES('gov_demo.hr.employees.email', 'COLUMN')
);
```
```
+----------+-------------+------------+-------------------------------+
| TAG_NAME | TAG_VALUE   | LEVEL      | OBJECT_NAME                   |
|----------+-------------+------------+-------------------------------|
| PII      | email       | COLUMN     | EMAIL                         |
+----------+-------------+------------+-------------------------------+
```

Account-wide view (note: `ACCOUNT_USAGE` has latency, up to ~2 hours):
```sql
SELECT tag_name, tag_value, object_name, column_name
FROM SNOWFLAKE.ACCOUNT_USAGE.TAG_REFERENCES
WHERE tag_name = 'PII';
```
```
+----------+-----------+-------------+-------------+
| TAG_NAME | TAG_VALUE | OBJECT_NAME | COLUMN_NAME |
|----------+-----------+-------------+-------------|
| PII      | name      | EMPLOYEES   | FULL_NAME   |
| PII      | email     | EMPLOYEES   | EMAIL       |
+----------+-----------+-------------+-------------+
```

**Point driven home:** Tagging by itself does **not** change or hide data — the `SELECT` still shows everything. Tags are *metadata*. Their power comes when a **policy** references them (Section 4) or when you use them to **find** sensitive data.

### Sensitive Data Classification (auto-discovery)
```sql
-- Ask Snowflake to analyze the table and propose categories
SELECT SYSTEM$CLASSIFY('gov_demo.hr.employees', {'auto_tag': true});
```
What you get back (abridged JSON):
```json
{
  "classification_result": {
    "FULL_NAME": { "semantic_category": {"value":"NAME"},
                   "privacy_category": {"value":"IDENTIFIER"} },
    "EMAIL":     { "semantic_category": {"value":"EMAIL"},
                   "privacy_category": {"value":"IDENTIFIER"} },
    "SALARY":    { "privacy_category": {"value":"SENSITIVE"} }
  }
}
```
> With `auto_tag: true`, Snowflake attaches system tags (`SNOWFLAKE.CORE.SEMANTIC_CATEGORY`, `SNOWFLAKE.CORE.PRIVACY_CATEGORY`) automatically — turning discovery straight into governance metadata.

---

## 2. Dynamic Data Masking — End to End

### Step 1: Create the masking policy
```sql
USE ROLE ACCOUNTADMIN;
CREATE MASKING POLICY gov_demo.hr.email_mask AS (val STRING) RETURNS STRING ->
  CASE
    WHEN CURRENT_ROLE() IN ('HR_ADMIN','ACCOUNTADMIN') THEN val
    ELSE REGEXP_REPLACE(val, '.+@', '****@')   -- partial mask
  END;
```

### Step 2: Attach it to the column
```sql
ALTER TABLE employees MODIFY COLUMN email
  SET MASKING POLICY gov_demo.hr.email_mask;
```

### Step 3: What each role sees — **same query, different output**

🟢 Privileged user:
```sql
USE ROLE hr_admin;
SELECT full_name, email FROM employees;
```
```
+---------------+------------------+
| FULL_NAME     | EMAIL            |
|---------------+------------------|
| Alice Kamau   | alice@corp.com   |
| Brian Otieno  | brian@corp.com   |
+---------------+------------------+
```

🔵 Restricted user:
```sql
USE ROLE analyst;
SELECT full_name, email FROM employees;
```
```
+---------------+------------------+
| FULL_NAME     | EMAIL            |
|---------------+------------------|
| Alice Kamau   | ****@corp.com    |
| Brian Otieno  | ****@corp.com    |
+---------------+------------------+
```

**Point driven home:** The masking is applied **at query time** on the *same underlying data*. Nothing is copied or altered on disk; the policy decides per-role what to reveal. The `analyst` cannot bypass it — even `SELECT email FROM employees WHERE email = 'alice@corp.com'` still returns the masked value.

### Verify where a policy is used
```sql
SELECT policy_name, ref_entity_name, ref_column_name
FROM TABLE(gov_demo.INFORMATION_SCHEMA.POLICY_REFERENCES(
  POLICY_NAME => 'gov_demo.hr.email_mask'));
```

---

## 3. Tag-Based Masking — End to End (scaling masking with tags)

Instead of attaching a policy per column, attach **one policy to a tag**; every column carrying the tag is protected automatically.

### Step 1: Policy that reads the tag's value
```sql
CREATE MASKING POLICY gov_demo.hr.pii_mask AS (val STRING) RETURNS STRING ->
  CASE
    WHEN CURRENT_ROLE() IN ('HR_ADMIN','ACCOUNTADMIN') THEN val
    ELSE '***MASKED***'
  END;
```

### Step 2: Bind the policy to the tag (once)
```sql
ALTER TAG gov_demo.hr.pii SET MASKING POLICY gov_demo.hr.pii_mask;
```

### Step 3: Result — any tagged column is now masked automatically
Because `full_name` and `email` already carry the `pii` tag (Section 1), no per-column `ALTER` is needed.

🔵 `analyst` now sees:
```
+---------------+---------------+
| FULL_NAME     | EMAIL         |
|---------------+---------------|
| ***MASKED***  | ***MASKED***  |
+---------------+---------------+
```

**Point driven home:** Tag a **new** column `phone` with `pii` tomorrow and it is instantly masked — governance scales through classification, not manual policy attachment.

---

## 4. External Tokenization — End to End (conceptual flow)

External tokenization stores **tokens** instead of raw values and detokenizes at query time via an **external function**.

```sql
-- 1. External function that calls your tokenization provider (via API integration)
CREATE EXTERNAL FUNCTION detokenize(v STRING) RETURNS STRING
  API_INTEGRATION = token_api
  AS 'https://<endpoint>/detokenize';

-- 2. Masking policy that detokenizes only for authorized roles
CREATE MASKING POLICY tok_mask AS (val STRING) RETURNS STRING ->
  CASE WHEN CURRENT_ROLE() = 'HR_ADMIN' THEN detokenize(val) ELSE val END;

ALTER TABLE employees MODIFY COLUMN email SET MASKING POLICY tok_mask;
```

What's stored on disk vs. what each role sees:
```
Stored value (all users, at rest):   TOK_9f83a1c...
HR_ADMIN sees (detokenized):          alice@corp.com
ANALYST sees (raw token):             TOK_9f83a1c...
```

**Point driven home:** Unlike dynamic masking, the *raw sensitive value never lives in Snowflake* — only tokens do. Detokenization is an outbound call for authorized users.

---

## 5. Row Access Policies — End to End

### Step 1: Mapping table (who can see which region)
```sql
CREATE OR REPLACE TABLE gov_demo.hr.role_region_map (role_name STRING, region STRING);
INSERT INTO gov_demo.hr.role_region_map VALUES
  ('ANALYST','EMEA'),           -- analyst limited to EMEA
  ('HR_ADMIN','EMEA'), ('HR_ADMIN','APAC'),
  ('HR_ADMIN','AMER');          -- hr_admin sees all
```

### Step 2: Create and attach the policy
```sql
CREATE ROW ACCESS POLICY gov_demo.hr.region_rap AS (region STRING) RETURNS BOOLEAN ->
  EXISTS (
    SELECT 1 FROM gov_demo.hr.role_region_map m
    WHERE m.role_name = CURRENT_ROLE() AND m.region = region
  );

ALTER TABLE employees ADD ROW ACCESS POLICY gov_demo.hr.region_rap ON (region);
```

### Step 3: Same query, different **rows**

🟢 `hr_admin` — all rows:
```sql
SELECT emp_id, full_name, region FROM employees;
```
```
| 1 | Alice Kamau   | EMEA |
| 2 | Brian Otieno  | APAC |
| 3 | Carla Mendez  | EMEA |
| 4 | David Wanjiru | AMER |
```

🔵 `analyst` — only EMEA rows:
```sql
SELECT emp_id, full_name, region FROM employees;
```
```
| 1 | Alice Kamau  | EMEA |
| 3 | Carla Mendez | EMEA |
```
Even `SELECT COUNT(*) FROM employees` returns **2** for the analyst and **4** for hr_admin.

**Point driven home:** Row policies filter **rows** (horizontal), masking filters **columns/values** (vertical). Combine both and the analyst sees *only EMEA rows* with *email masked* — full cell-level control from a single shared table.

---

## 6. Differential Privacy — End to End (what changes in results)

A privacy policy adds **noise** so individuals can't be re-identified from aggregate queries.

```sql
-- Attach a differential privacy policy (privileged setup)
ALTER TABLE employees SET AGGREGATION POLICY gov_demo.hr.dp_policy;
```

What the analyst experiences:
```sql
-- Allowed: aggregate over many rows
SELECT region, AVG(salary) FROM employees GROUP BY region;
```
```
+--------+-------------+
| REGION | AVG(SALARY) |     <- values are slightly noised each run
|--------+-------------|
| EMEA   |    114732   |     (true 115000 ± noise)
| APAC   |     95210   |
+--------+-------------+
```
```sql
-- Blocked / heavily noised: query that isolates one person
SELECT salary FROM employees WHERE full_name = 'Alice Kamau';
```
```
Result is suppressed or returns noised output — a single individual
cannot be reliably singled out.
```

**Point driven home:** The analyst can still do **population-level analytics**, but cannot reverse-engineer any **one person's** value. Repeating the same aggregate returns slightly different numbers — that's the injected noise.

---

## 7. Encryption Key Management & Tri-Secret Secure — What you can observe

Encryption is **automatic and transparent** — there is no `SELECT` that shows ciphertext to end users. What you *can* do is observe the key hierarchy behavior:

```sql
-- Manually trigger rekeying of older data (Enterprise+; must be enabled)
ALTER ACCOUNT SET PERIODIC_DATA_REKEYING = TRUE;
```
Effect (conceptual): after ~1 year, data still encrypted with an old key is **re-encrypted** with a fresh key. Users notice **nothing** — queries work identically; only the underlying key changed.

**Tri-Secret Secure — the observable difference:**
```
Normal:  Snowflake key ── unlocks ──> your data
Tri-Secret: (Snowflake key + YOUR KMS key) ── both required ──> your data

If you DISABLE your KMS key in AWS/Azure/GCP:
   SELECT * FROM employees;
   -> queries FAIL — data is unreadable until you re-enable your key.
```

**Point driven home:** Tri-Secret Secure gives you a real **kill switch**. Revoking your customer-managed key makes the data undecryptable, even to Snowflake.

---

## 8. Alerts & Notifications — End to End

### Step 1: Notification integration (email)
```sql
CREATE NOTIFICATION INTEGRATION email_alerts
  TYPE = EMAIL
  ENABLED = TRUE
  ALLOWED_RECIPIENTS = ('governance-team@corp.com');
```

### Step 2: Create an alert (condition + action + schedule)
```sql
CREATE ALERT high_credit_alert
  WAREHOUSE = admin_wh
  SCHEDULE = '60 MINUTE'
  IF (EXISTS (
      SELECT 1 FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY
      WHERE start_time > DATEADD('hour', -1, CURRENT_TIMESTAMP())
      GROUP BY warehouse_name HAVING SUM(credits_used) > 50
  ))
  THEN CALL SYSTEM$SEND_EMAIL(
     'email_alerts', 'governance-team@corp.com',
     'High credit usage', 'A warehouse exceeded 50 credits in the last hour.'
  );

ALTER ALERT high_credit_alert RESUME;   -- alerts start SUSPENDED
```

### Step 3: What the recipient sees
```
From:    no-reply@snowflake.net
To:      governance-team@corp.com
Subject: High credit usage
Body:    A warehouse exceeded 50 credits in the last hour.
```

Check alert runs:
```sql
SELECT name, state, scheduled_time, condition_result
FROM TABLE(gov_demo.INFORMATION_SCHEMA.ALERT_HISTORY())
ORDER BY scheduled_time DESC;
```
```
| NAME              | STATE     | SCHEDULED_TIME      | CONDITION_RESULT |
|-------------------+-----------+---------------------+------------------|
| HIGH_CREDIT_ALERT | CONDITION_MET | 2026-09-23 17:00 | true          |  <- action fired
| HIGH_CREDIT_ALERT | SCHEDULED     | 2026-09-23 16:00 | false         |  <- no action
```

**Point driven home:** Condition true → action runs (email sent). Condition false → nothing happens but the check is still logged. Alerts must be explicitly `RESUME`d.

---

## 9. Data Lineage & Access History — End to End

### Access History — who read what
```sql
SELECT
  query_start_time,
  user_name,
  bo.value:objectName::STRING   AS object_read,
  col.value:columnName::STRING  AS column_read
FROM SNOWFLAKE.ACCOUNT_USAGE.ACCESS_HISTORY,
  LATERAL FLATTEN(base_objects_accessed) bo,
  LATERAL FLATTEN(bo.value:columns) col
WHERE bo.value:objectName::STRING = 'GOV_DEMO.HR.EMPLOYEES'
ORDER BY query_start_time DESC;
```
```
+---------------------+-----------+-----------------------+-------------+
| QUERY_START_TIME    | USER_NAME | OBJECT_READ           | COLUMN_READ |
|---------------------+-----------+-----------------------+-------------|
| 2026-09-23 18:20:11 | JDOE      | GOV_DEMO.HR.EMPLOYEES | EMAIL       |
| 2026-09-23 18:20:11 | JDOE      | GOV_DEMO.HR.EMPLOYEES | SALARY      |
| 2026-09-23 17:55:02 | ANALYST1  | GOV_DEMO.HR.EMPLOYEES | FULL_NAME   |
+---------------------+-----------+-----------------------+-------------+
```

### Column lineage — where a column's data came from
```sql
SELECT * FROM TABLE(SNOWFLAKE.CORE.GET_LINEAGE(
  'GOV_DEMO.HR.EMPLOYEES', 'TABLE', 'DOWNSTREAM'));
```
```
+-----------------------------+----------------------------------+-----------+
| SOURCE_OBJECT               | TARGET_OBJECT                    | DIRECTION |
|-----------------------------+----------------------------------+-----------|
| GOV_DEMO.HR.EMPLOYEES       | GOV_DEMO.HR.V_EMEA_STAFF (VIEW)  | DOWNSTREAM|
| GOV_DEMO.HR.V_EMEA_STAFF    | GOV_DEMO.RPT.HEADCOUNT (TABLE)   | DOWNSTREAM|
+-----------------------------+----------------------------------+-----------+
```
In Snowsight this renders as a **visual graph** (boxes and arrows) you can click through.

**Point driven home:** Access History answers *"who touched this sensitive column and when?"* (audit), while lineage answers *"if I change this table, what downstream reports break, and where did this data originate?"* (impact analysis).

---

## Cleanup (optional)

```sql
USE ROLE ACCOUNTADMIN;
ALTER TABLE gov_demo.hr.employees DROP ALL ROW ACCESS POLICIES;
ALTER TABLE gov_demo.hr.employees MODIFY COLUMN email UNSET MASKING POLICY;
ALTER TAG gov_demo.hr.pii UNSET MASKING POLICY;
DROP DATABASE gov_demo;
DROP ROLE analyst;
DROP ROLE hr_admin;
```

---

## Mental Model Recap

| Feature | You run… | The user sees… | Key takeaway |
|---------|----------|----------------|--------------|
| Object Tagging | `CREATE/SET TAG` | *No change to data* | Metadata; enables policies & discovery |
| Dynamic Masking | `CREATE MASKING POLICY` + `SET` | Masked column values per role | Same data, different reveal at query time |
| Tag-based Masking | `ALTER TAG SET MASKING POLICY` | All tagged columns masked | Masking scales via classification |
| External Tokenization | External fn + policy | Token vs. detokenized value | Raw value never stored in Snowflake |
| Row Access Policy | `ADD ROW ACCESS POLICY` | Fewer **rows** per role | Horizontal filtering |
| Differential Privacy | aggregation/privacy policy | Noised aggregates; individuals hidden | Analytics yes, re-identification no |
| Encryption / Tri-Secret | automatic / `PERIODIC_DATA_REKEYING` | Nothing (transparent) | Customer key = kill switch |
| Alerts & Notifications | `CREATE ALERT` + integration | Email/webhook when condition met | Condition → action, must RESUME |
| Lineage / Access History | query `ACCOUNT_USAGE` / `GET_LINEAGE` | Audit table + visual graph | Who accessed / where data flows |

> ⚠️ **Verify before exam/production:** exact function names (e.g., `SYSTEM$CLASSIFY` vs `EXTRACT_SEMANTIC_CATEGORIES`), `GET_LINEAGE` availability, and edition requirements change over time. Confirm against current Snowflake docs.
