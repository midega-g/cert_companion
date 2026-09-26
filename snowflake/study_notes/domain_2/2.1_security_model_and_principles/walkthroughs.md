# Subdomain 2.1: Security Model — End-to-End Walkthroughs

Companion to `concepts.md`. Where that file explains *what* each security feature is, this file walks through each command **end-to-end**: setup → apply → **what the user actually sees** (success/failure output), plus how to verify.

> Convention:
> - 🟢 = allowed / success
> - 🔴 = blocked / error
> - Output blocks show the **actual message or result set** a user would see.

---

## 1. Network Policies — End to End

### Step 1: Create a network rule (reusable IP grouping)
```sql
USE ROLE ACCOUNTADMIN;
CREATE NETWORK RULE corp_office_rule
  MODE = INGRESS
  TYPE = IPV4
  VALUE_LIST = ('203.0.113.0/24', '198.51.100.42');
```

### Step 2: Create a network policy that uses the rule
```sql
CREATE NETWORK POLICY corp_only
  ALLOWED_NETWORK_RULE_LIST = ('corp_office_rule')
  COMMENT = 'Only allow connections from the corporate office';
```

### Step 3: Apply it (account-wide or per user)
```sql
ALTER ACCOUNT SET NETWORK_POLICY = corp_only;
-- or, more targeted:
ALTER USER jdoe SET NETWORK_POLICY = corp_only;
```

### Step 4: What the user sees

🟢 Connecting from `203.0.113.55` (in range) — normal login, no difference.

🔴 Connecting from `8.8.8.8` (not in range):
```
Error: 390432 (08004): Incoming request with IP/Token 8.8.8.8
is not allowed to access Snowflake. Contact your local system administrator.
```
The connection is refused **before authentication** — the password/MFA prompt never even appears.

### Verify
```sql
SHOW NETWORK POLICIES;
-- See what's applied at account level:
SHOW PARAMETERS LIKE 'NETWORK_POLICY' IN ACCOUNT;
```
```
+----------------+----------+
| key            | value    |
|----------------+----------|
| NETWORK_POLICY | CORP_ONLY|
+----------------+----------+
```

**Point driven home:** Network policy is the **outermost gate**. `BLOCKED_IP_LIST` is evaluated before `ALLOWED` — so a blocked IP loses even if it's also in the allowed range.

---

## 2. Multi-Factor Authentication & Authentication Policies — End to End

### Step 1: Create an authentication policy requiring MFA
```sql
USE ROLE ACCOUNTADMIN;
CREATE AUTHENTICATION POLICY require_mfa_policy
  AUTHENTICATION_METHODS = ('PASSWORD', 'SAML')
  MFA_AUTHENTICATION_METHODS = ('PASSWORD')
  MFA_ENROLLMENT = REQUIRED;
```

### Step 2: Apply to account or user
```sql
ALTER USER jdoe SET AUTHENTICATION POLICY require_mfa_policy;
```

### Step 3: What the user sees

🟢 After entering the correct password, a **Duo push** is sent:
```
Login prompt:
  1. Username / Password  ✓
  2. "Approve sign-in?" push notification on registered device
     -> user taps Approve -> session starts
```

🔴 User not yet enrolled in MFA but policy requires it:
```
Error: Multi-factor authentication enrollment is required
by your account's authentication policy. Please enroll before signing in.
```

### Verify login attempts
```sql
SELECT user_name, event_timestamp, first_authentication_factor,
       second_authentication_factor, is_success, error_message
FROM SNOWFLAKE.ACCOUNT_USAGE.LOGIN_HISTORY
WHERE user_name = 'JDOE'
ORDER BY event_timestamp DESC;
```
```
+-----------+---------------------+------------------+-------------------+------------+
| USER_NAME | EVENT_TIMESTAMP     | FIRST_AUTH_FACTOR| SECOND_AUTH_FACTOR| IS_SUCCESS |
|-----------+---------------------+------------------+-------------------+------------|
| JDOE      | 2026-09-23 18:40:11 | PASSWORD         | DUO               | YES        |
| JDOE      | 2026-09-23 18:39:02 | PASSWORD         | NULL              | NO         |  <- no MFA
+-----------+---------------------+------------------+-------------------+------------+
```

**Point driven home:** `LOGIN_HISTORY` is your audit trail — it shows the factors used and whether MFA succeeded, which is exactly what a security reviewer checks.

---

## 3. Key-Pair Authentication & Rotation — End to End

### Step 1: Generate a key pair (client side)
```bash
# Private key (keep secret, used by the client)
openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -out rsa_key.p8 -nocrypt
# Public key (given to Snowflake)
openssl rsa -in rsa_key.p8 -pubout -out rsa_key.pub
```

### Step 2: Assign the public key to a user
```sql
USE ROLE SECURITYADMIN;
ALTER USER svc_pipeline SET RSA_PUBLIC_KEY='MIIBIjANBgkq...<contents of rsa_key.pub>...';
```

### Step 3: What the client experiences
```bash
snowsql -a <account> -u svc_pipeline --private-key-path rsa_key.p8
```
🟢 Connects with **no password prompt** — the client signs a challenge with the private key.

### Step 4: Rotation (zero downtime)
```sql
-- Add the new key as the second slot while the old one still works
ALTER USER svc_pipeline SET RSA_PUBLIC_KEY_2='MIIBIjANBgkq...<new key>...';
-- Switch clients to the new private key, confirm, then remove the old one
ALTER USER svc_pipeline UNSET RSA_PUBLIC_KEY;
```

### Verify the fingerprint in use
```sql
DESC USER svc_pipeline;   -- look for RSA_PUBLIC_KEY_FP / RSA_PUBLIC_KEY_2_FP
```
```
| property             | value                              |
|----------------------+------------------------------------|
| RSA_PUBLIC_KEY_FP    | SHA256:abc123...                   |
| RSA_PUBLIC_KEY_2_FP  | SHA256:def456...                   |  <- new key active
```

**Point driven home:** Two key slots (`RSA_PUBLIC_KEY` + `RSA_PUBLIC_KEY_2`) allow rollover without ever locking out the service account.

---

## 4. RBAC — End-to-End Grant Flow

This is the heart of subdomain 2.1: **privileges → roles → users**.

### Step 1: Build objects with SYSADMIN
```sql
USE ROLE SYSADMIN;
CREATE DATABASE sales_db;
CREATE SCHEMA sales_db.public;
CREATE TABLE sales_db.public.orders (id INT, amount NUMBER, region STRING);
CREATE WAREHOUSE analyst_wh WAREHOUSE_SIZE = XSMALL AUTO_SUSPEND = 60;
```

### Step 2: Create a custom role (USERADMIN owns role creation)
```sql
USE ROLE USERADMIN;
CREATE ROLE analyst;
```

### Step 3: Grant privileges to the role (least privilege)
```sql
USE ROLE SYSADMIN;   -- owner of the objects grants access
GRANT USAGE ON DATABASE sales_db TO ROLE analyst;
GRANT USAGE ON SCHEMA sales_db.public TO ROLE analyst;
GRANT SELECT ON TABLE sales_db.public.orders TO ROLE analyst;
GRANT USAGE ON WAREHOUSE analyst_wh TO ROLE analyst;
```

### Step 4: Grant the role to a user, and into the hierarchy
```sql
USE ROLE SECURITYADMIN;
GRANT ROLE analyst TO USER jdoe;
GRANT ROLE analyst TO ROLE SYSADMIN;   -- so admins inherit it
```

### Step 5: What the user sees

🟢 As `analyst`, read is allowed:
```sql
USE ROLE analyst; USE WAREHOUSE analyst_wh;
SELECT COUNT(*) FROM sales_db.public.orders;
```
```
+----------+
| COUNT(*) |
|----------|
|      128 |
+----------+
```

🔴 As `analyst`, write is denied (no INSERT privilege granted):
```sql
INSERT INTO sales_db.public.orders VALUES (999, 50, 'EMEA');
```
```
SQL access control error:
Insufficient privileges to operate on table 'ORDERS'
```

🔴 Missing `USAGE` on the schema produces a different, telling error:
```
SQL compilation error:
Schema 'SALES_DB.PUBLIC' does not exist or not authorized.
```

**Point driven home:** The user only ever gets what the **role** was granted. "Object does not exist or not authorized" almost always means a **missing USAGE** on the containing database/schema — not a missing table.

### Verify grants
```sql
SHOW GRANTS TO ROLE analyst;      -- privileges the role holds
SHOW GRANTS OF ROLE analyst;      -- who/what the role is granted to
SHOW GRANTS ON TABLE sales_db.public.orders;  -- everyone who can touch this table
```
```
-- SHOW GRANTS TO ROLE analyst
+-----------+-----------+---------------------------+---------+
| privilege | granted_on| name                      | grantee |
|-----------+-----------+---------------------------+---------|
| USAGE     | DATABASE  | SALES_DB                  | ANALYST |
| USAGE     | SCHEMA    | SALES_DB.PUBLIC           | ANALYST |
| SELECT    | TABLE     | SALES_DB.PUBLIC.ORDERS    | ANALYST |
| USAGE     | WAREHOUSE | ANALYST_WH                | ANALYST |
+-----------+-----------+---------------------------+---------+
```

---

## 5. Role Hierarchy & Privilege Inheritance — End to End

### Setup: two-level custom hierarchy
```sql
USE ROLE USERADMIN;
CREATE ROLE junior_analyst;
CREATE ROLE senior_analyst;

USE ROLE SECURITYADMIN;
GRANT ROLE junior_analyst TO ROLE senior_analyst;  -- senior inherits junior
GRANT ROLE senior_analyst TO ROLE SYSADMIN;        -- top of the tree
```

Grant read to junior only:
```sql
USE ROLE SYSADMIN;
GRANT SELECT ON TABLE sales_db.public.orders TO ROLE junior_analyst;
```

### What each role sees
🟢 `senior_analyst` can query the table **even though the grant was on `junior_analyst`**:
```sql
USE ROLE senior_analyst;
SELECT COUNT(*) FROM sales_db.public.orders;   -- works via inheritance
```

🔴 `junior_analyst` cannot see anything senior-only, because inheritance flows **upward only**:
```
senior_analyst  ── inherits ──►  junior_analyst's privileges   ✅
junior_analyst  ──   X    ──►  senior_analyst's privileges     ❌
```

**Point driven home:** A parent role automatically has **all** privileges of the child roles granted to it. Privileges flow **up** the hierarchy, never down.

---

## 6. Primary vs. Secondary Roles — End to End

Suppose `jdoe` holds two roles: `analyst` (can read `sales_db`) and `finance` (can read `fin_db`).

### With only a primary role
```sql
USE ROLE analyst;
SELECT * FROM fin_db.public.ledger;   -- 🔴 fails: analyst has no access
```
```
Object 'FIN_DB.PUBLIC.LEDGER' does not exist or not authorized.
```

### Activate secondary roles
```sql
USE ROLE analyst;              -- primary role
USE SECONDARY ROLES ALL;       -- add all other granted roles' privileges
SELECT * FROM fin_db.public.ledger;   -- 🟢 now works via 'finance' privileges
SELECT CURRENT_ROLE(), CURRENT_SECONDARY_ROLES();
```
```
+---------------+--------------------------+
| CURRENT_ROLE()| CURRENT_SECONDARY_ROLES()|
|---------------+--------------------------|
| ANALYST       | ["FINANCE"]              |
+---------------+--------------------------+
```

**Point driven home:** The **primary role** still governs *ownership* of anything you create; **secondary roles** just widen what you can *read/use* in the session without switching roles.

---

## 7. Revoking Access — End to End

```sql
USE ROLE SECURITYADMIN;
-- Remove a privilege
REVOKE SELECT ON TABLE sales_db.public.orders FROM ROLE analyst;
-- Remove a role from a user
REVOKE ROLE analyst FROM USER jdoe;
```

What the user sees immediately after (in a new session/role activation):
```sql
USE ROLE analyst;
SELECT * FROM sales_db.public.orders;
```
```
Object 'SALES_DB.PUBLIC.ORDERS' does not exist or not authorized.
```

**Point driven home:** Revocation takes effect on the **next** privilege evaluation. A user in an active session may need to re-activate the role (or reconnect) to feel the change.

---

## 8. Logging & Tracing — End to End

### Audit logins (security review)
```sql
SELECT user_name, client_ip, reported_client_type,
       first_authentication_factor, is_success, error_message
FROM SNOWFLAKE.ACCOUNT_USAGE.LOGIN_HISTORY
WHERE is_success = 'NO'
  AND event_timestamp > DATEADD('day', -1, CURRENT_TIMESTAMP())
ORDER BY event_timestamp DESC;
```
```
+-----------+-------------+--------------------+------------+--------------------------+
| USER_NAME | CLIENT_IP   | CLIENT_TYPE        | IS_SUCCESS | ERROR_MESSAGE            |
|-----------+-------------+--------------------+------------+--------------------------|
| JDOE      | 8.8.8.8     | SNOWFLAKE_UI       | NO         | IP not allowed by policy |
| SVC_ETL   | 10.0.0.5    | JDBC_DRIVER        | NO         | JWT token is invalid     |
+-----------+-------------+--------------------+------------+--------------------------+
```

### Audit privilege changes
```sql
SELECT * FROM SNOWFLAKE.ACCOUNT_USAGE.GRANTS_TO_ROLES
WHERE deleted_on IS NULL AND grantee_name = 'ANALYST';
```

### Application logging/tracing (event table)
```sql
-- Route log/trace output to an event table
ALTER ACCOUNT SET EVENT_TABLE = my_db.my_schema.my_events;
ALTER SESSION SET LOG_LEVEL = INFO, TRACE_LEVEL = ON_EVENT;
-- Then a procedure's logger.info(...) / trace calls land in the event table:
SELECT timestamp, resource_attributes, record_type, value
FROM my_db.my_schema.my_events ORDER BY timestamp DESC;
```

**Point driven home:** `LOGIN_HISTORY` and `GRANTS_TO_ROLES` cover **security auditing** (who tried to log in, who has what); **event tables** cover **application observability** (logs/traces/metrics from your code).

---

## Mental Model Recap

| Feature | You run… | The user sees… | Key takeaway |
|---------|----------|----------------|--------------|
| Network Policy | `CREATE NETWORK POLICY` + `ALTER ... SET` | Blocked before login prompt | Outermost gate; BLOCKED beats ALLOWED |
| MFA / Auth Policy | `CREATE AUTHENTICATION POLICY` | Duo push / enrollment required | Second factor enforced by policy |
| Key-pair | `ALTER USER SET RSA_PUBLIC_KEY` | Passwordless connect | Two slots enable zero-downtime rotation |
| RBAC grants | `GRANT <priv>/<role>` | Read works, write denied | User gets only what the role holds |
| Role hierarchy | `GRANT ROLE child TO ROLE parent` | Parent inherits child's access | Privileges flow **up** only |
| Primary/secondary | `USE SECONDARY ROLES ALL` | Wider read without role switch | Primary owns creations; secondary widens reads |
| Revoke | `REVOKE <priv>/<role>` | "not authorized" next time | Effective on next evaluation |
| Logging & tracing | query `LOGIN_HISTORY` / event table | Audit rows / log records | Security audit vs. app observability |

> ⚠️ **Verify before exam/production:** exact syntax for authentication policies, network rule vs. inline IP lists, and event-table setup evolve over time. Confirm against current Snowflake docs.
