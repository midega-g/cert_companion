# Domain 2: Data Governance in Snowflake

Snowflake provides industry-leading features that ensure governance for your **account**, **users**, and **data**. Governance in Snowflake is about knowing *what* data you have, *who* can see it, *how* it is protected, and *where* it came from.

This note covers the core governance features and how each one helps protect and govern data.

---

## Overview: The Governance Pillars

| Pillar | Question it answers | Features |
|--------|--------------------|----------|
| **Know your data** | What data do I have and where is sensitive data? | Object Tagging, Sensitive Data Classification, Data Lineage, Access History |
| **Protect your data** | Who can see it and how is it secured? | Data Masking (column-level), Row Access Policies, Privacy Policies, Encryption Key Management |
| **Monitor your account** | Is my account secure and compliant? | Trust Center, Alerts & Notifications |

---

## 1. Object Tagging

**What it is:** A tag is a schema-level object (a key with an optional set of allowed string values) that you assign to other Snowflake objects (tables, columns, views, warehouses, databases, etc.).

**How it governs data:**
- Enables **tracking and classification** of sensitive data (e.g., `PII = 'email'`, `cost_center = 'finance'`).
- Tags are **inherited** through the object hierarchy — a tag on a table applies to its columns; a tag on a schema applies to tables within it.
- Forms the foundation for **tag-based policies** (masking and row access), so you can protect data at scale without attaching a policy to every column individually.
- Supports **cost tracking and resource governance** (e.g., tagging warehouses by department).

**Key points:**
- Created with `CREATE TAG`, applied with `ALTER ... SET TAG`.
- A single tag can be applied to many objects; an object can have multiple tags.
- Tag associations can be queried via `ACCOUNT_USAGE.TAG_REFERENCES` and the `SNOWFLAKE.CORE` functions.

### Sensitive Data Classification
- Snowflake can **automatically analyze columns** and suggest **system tags** identifying the type of data (a *semantic category* like `NAME`, `EMAIL`, and a *privacy category* like `IDENTIFIER`, `QUASI_IDENTIFIER`, `SENSITIVE`).
- Uses functions such as `EXTRACT_SEMANTIC_CATEGORIES` and `ASSOCIATE_SEMANTIC_CATEGORY_TAGS`.
- Helps you **discover** where sensitive/PII data lives so you can apply the right protections.

---

## 2. Data Masking (Column-Level Security)

Column-level security protects the **values within a column** so that unauthorized users see obfuscated data instead of the real value.

### Dynamic Data Masking
- Uses a **masking policy** (a schema-level object) attached to a column.
- The policy contains SQL that decides, **at query time**, whether to show the real value or a masked value — typically based on the current role, execution context, or other conditions.
- Data at rest is **not changed**; masking is applied dynamically as data is read.

Example logic inside a masking policy:
```sql
CREATE MASKING POLICY email_mask AS (val STRING) RETURNS STRING ->
  CASE
    WHEN CURRENT_ROLE() IN ('ADMIN') THEN val
    ELSE '***MASKED***'
  END;
```

### External Tokenization
- Tokenizes data **before it is loaded** into Snowflake and **detokenizes at query time** for authorized users.
- Relies on **external functions** integrated with a third-party tokenization provider.
- Useful when regulations require that raw sensitive values never be stored in the database.

### Tag-Based Masking Policies
- Instead of attaching a masking policy to each column individually, you **attach the policy to a tag**.
- Any column that carries that tag is **automatically protected**.
- Scales governance: classify a column (tag it) → protection is applied automatically.

**Governance benefit:** Fine-grained, role-aware control over sensitive column values without duplicating data or building separate secure views.

---

## 3. Row-Level Security (Row Access Policies)

While masking protects *columns*, **row access policies** control which **rows** a user can see.

**What it is:** A schema-level policy containing an expression that determines, per row, whether the querying user is allowed to see that row.

**How it governs data:**
- A single table can be shared across many groups/regions/departments, with each user seeing **only their permitted rows** (e.g., a sales rep sees only their region).
- Policies can reference a **mapping table** to drive row visibility dynamically.
- Evaluated at query time; combines with masking policies for complete cell-level protection.

Example logic:
```sql
CREATE ROW ACCESS POLICY region_policy AS (region STRING) RETURNS BOOLEAN ->
  EXISTS (
    SELECT 1 FROM entitlements e
    WHERE e.role = CURRENT_ROLE() AND e.region = region
  );
```

---

## 4. Privacy Policies

### Privacy in Snowflake
- Features aimed at protecting individuals' privacy while still allowing analytics on the data.

### Differential Privacy
- Adds **statistical noise** to query results so that the presence or absence of any single individual's record cannot be determined from the output.
- Protects against **re-identification** and privacy attacks (e.g., difference/tracker attacks) while still allowing aggregate analysis.
- Implemented via **privacy policies** attached to tables/views, defining privacy budgets and constraints on what can be queried.

**Governance benefit:** Enables safe data sharing and analytics on sensitive datasets without exposing individual-level information.

---

## 5. Trust Center

**What it is:** A built-in feature (in Snowsight) that provides a **centralized view of the security posture** of your account.

**How it governs the account:**
- Runs **scanner packages** that evaluate your account against **security best practices** and surfaces risks (e.g., users without MFA, over-privileged roles, inactive users, stale credentials).
- Categorizes findings by **severity** (Critical, High, Medium, Low) with recommended remediation steps.
- Includes scanners such as the **Security Essentials** package (enabled by default) and **CIS Benchmarks** / **Threat Intelligence** packages.

**Getting started:**
- Requires appropriate privileges (e.g., the `TRUST_CENTER_ADMIN` application role) to view and manage.
- Enable additional scanner packages and set their run frequency; review the **Findings** tab regularly.

**Governance benefit:** Continuous, automated monitoring of account-level security and compliance posture.

---

## 6. Encryption Key Management

**What it is:** Snowflake **encrypts all data at rest by default** using **AES-256** and manages keys through a **hierarchical key model** with automatic key rotation and rekeying.

**Key hierarchy (top to bottom):**
1. **Root key**
2. **Account master keys**
3. **Table master keys**
4. **File keys** (encrypt the actual data files)

Each layer wraps (encrypts) the keys beneath it — this is called **hierarchical/envelope encryption**.

**Key features:**
- **Automatic key rotation** — keys are rotated on a schedule (e.g., ~30 days) so no single key protects data indefinitely.
- **Rekeying** — older data can be re-encrypted with new keys (available on higher editions).
- Encryption is **transparent** — no action needed by users.

### Tri-Secret Secure
- Combines a **customer-managed key (CMK)** — held in the cloud provider's KMS (AWS KMS, Azure Key Vault, Google Cloud KMS) — with a **Snowflake-maintained key** to create a **composite master key**.
- Data can only be decrypted when **both** keys are available.
- Gives the customer the ability to **revoke access** to their data (by disabling their key) and provides an extra layer of control for highly regulated environments.
- Available on **Business Critical** edition (and higher).

**Governance benefit:** Strong, transparent encryption with optional customer control over the key that ultimately unlocks their data.

---

## 7. Alerts and Notifications

### Snowflake Alerts
- An **alert** is a schema-level object that performs an **action when a condition is met**.
- Structure: a **condition** (a SQL query/expression) + an **action** (SQL to run) + a **schedule** (how often to check).
- Example uses: warn when warehouse credit usage exceeds a threshold, when a data-quality check fails, or when storage grows unexpectedly.
- Often paired with notification integrations to alert people, not just run SQL.

### Notifications
- Snowflake can **push messages** to external channels via a **notification integration**:
  - **Email** (to verified Snowflake users in the account).
  - **Cloud messaging**: Amazon SNS, Azure Event Grid, Google Pub/Sub, and webhooks (e.g., Slack, Teams, PagerDuty).
- Used by alerts, tasks, Snowpipe error notifications, and stored procedures (`SYSTEM$SEND_EMAIL`, `SYSTEM$SEND_SNOWFLAKE_NOTIFICATION`).

**Governance benefit:** Automated, proactive monitoring — the account can notify the right people when governance, cost, or security conditions occur.

---

## 8. Data Lineage

**What it is:** The ability to **trace how data flows and transforms** through your account — from source objects to downstream objects.

**How it governs data:**
- Shows **upstream and downstream dependencies** between objects (tables, views, etc.), viewable as a **lineage graph** in Snowsight.
- Helps with **impact analysis** (what breaks if I change this table?), **compliance/audit** (where did this sensitive column originate?), and **debugging** data pipelines.

### Access History
- The `ACCOUNT_USAGE.ACCESS_HISTORY` view records **who accessed what data and when** — including the specific columns read/written by each query.
- Provides **object dependency** and **column-level lineage** information (which columns fed into which target columns).
- Critical for **auditing**, **regulatory compliance**, and verifying that masking/row policies are effective.

**Governance benefit:** Full visibility into data movement and access, supporting audit, compliance, and trust in your data.

---

## Quick Reference Summary

| Feature | Protects / Governs | Object type | Edition notes |
|---------|-------------------|-------------|---------------|
| **Object Tagging** | Classification & tracking of data/resources | Tag (schema-level) | Enterprise+ |
| **Sensitive Data Classification** | Auto-discovery of PII/sensitive data | System tags | Enterprise+ |
| **Dynamic Data Masking** | Column values (role-aware) | Masking policy | Enterprise+ |
| **External Tokenization** | Column values (tokenized at load) | External function + policy | Enterprise+ |
| **Tag-Based Masking** | Columns automatically via tags | Tag + masking policy | Enterprise+ |
| **Row Access Policies** | Which rows a user sees | Row access policy | Enterprise+ |
| **Privacy / Differential Privacy** | Individual re-identification | Privacy policy | (Regulated/BC) |
| **Trust Center** | Account security posture | Snowsight feature | All (scanners vary) |
| **Encryption Key Management** | Data at rest (AES-256, hierarchical) | Automatic | All |
| **Tri-Secret Secure** | Customer control of decryption | CMK + Snowflake key | Business Critical+ |
| **Alerts & Notifications** | Proactive monitoring/response | Alert + notification integration | All |
| **Data Lineage / Access History** | Data flow & access auditing | Snowsight + ACCOUNT_USAGE | Enterprise+ |

---

## Reference Links (from Snowflake docs)

- Data Governance in Snowflake
- Object tagging / Sensitive data classification
- Column-level security / Dynamic data masking / External tokenization / Tag-based masking policies
- Row access policies
- Privacy in Snowflake / Differential privacy
- Trust Center / Getting started with the Trust Center
- Encryption key management / Tri-Secret Secure
- Snowflake Alerts / Notifications in Snowflake
- Data lineage / Access History
