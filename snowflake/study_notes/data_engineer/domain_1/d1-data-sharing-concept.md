# Domain 1: Data Movement, data sharing (SnowPro Advanced: Data Engineer, DEA-C02)

Weight: **28%**. Domain 1 notes are split across 8 files: [d1-load-data-concept.md](d1-load-data-concept.md) (1.1: load data); [d1-ingest-data-formats-concept.md](d1-ingest-data-formats-concept.md) (1.2: ingest data of various formats); [d1-troubleshoot-ingestion-concept.md](d1-troubleshoot-ingestion-concept.md) (1.3: troubleshoot data ingestion); [d1-streams-and-tasks-concept.md](d1-streams-and-tasks-concept.md) (1.4.1 to 1.4.12: streams and tasks); [d1-continuous-pipelines-concept.md](d1-continuous-pipelines-concept.md) (1.4.13 to 1.4.26: dynamic tables, Snowpipe and developer tools); [d1-connectors-concept.md](d1-connectors-concept.md) (1.5: connectors); this file, 1.6: data sharing and consumption; [d1-tables-and-data-operations-concept.md](d1-tables-and-data-operations-concept.md) (1.7: tables and data operations). A section is added only after it is approved. The contents table below lists only the sections in this file.

## Contents

| Section | Topic | Status |
|---------|-------|--------|
| 1.6 | [Design and build data sharing and data consumption solutions](#16-design-and-build-data-sharing-and-data-consumption-solutions) | Approved |

---

## 1.6 Design and build data sharing and data consumption solutions

The study guide lists: evaluate a data share or a clone, implement a data share (including auto-fulfillment), create and manage views, implement row-level filtering, share through the Snowflake Marketplace, share through a listing, and use Streamlit to build data applications. Each is a subsection below.

**Sections in 1.6**

- [1.6.1 Choosing a sharing mechanism](#161-choosing-a-sharing-mechanism)
- [1.6.2 Share or clone](#162-share-or-clone)
- [1.6.3 Create and manage a direct share](#163-create-and-manage-a-direct-share)
- [1.6.4 What goes into a share](#164-what-goes-into-a-share)
- [1.6.5 Consume a share](#165-consume-a-share)
- [1.6.6 Reader accounts](#166-reader-accounts)
- [1.6.7 Sharing across regions and clouds](#167-sharing-across-regions-and-clouds)
- [1.6.8 Auto-fulfillment](#168-auto-fulfillment)
- [1.6.9 Views: create and manage](#169-views-create-and-manage)
- [1.6.10 Row-level filtering](#1610-row-level-filtering)
- [1.6.11 Listings](#1611-listings)
- [1.6.12 Snowflake Marketplace](#1612-snowflake-marketplace)
- [1.6.13 Streamlit in Snowflake](#1613-streamlit-in-snowflake)
- [1.6.14 Quick-reference for 1.6](#1614-quick-reference-for-16)
- [1.6 open items and flags](#16-open-items-and-flags)

### 1.6.1 Choosing a sharing mechanism

| Mechanism | Who can receive | Cross-region and cloud | Charge for data | Public on Marketplace | Usage metrics |
|-----------|-----------------|------------------------|-----------------|-----------------------|---------------|
| **Listing** | One or more accounts in any region | Yes, with auto-fulfillment | Optional | Optional | Yes |
| **Direct share** | One or more accounts **in your region** | No (use replication, 1.6.7) | No | No | No |
| **Data Exchange** | A group of accounts you invite and manage | Per the page, not covered | | | Views in the Data Sharing Usage schema |
| **Clean room** | Another party that must not see raw data | | | | |
| **Reader account** | Someone with no Snowflake account | Same region as the provider | Provider pays | No | |

- The first two rows come from the comparison table on "Data sharing and collaboration in Snowflake". The page's table has only listings and direct shares.
- A listing is "an enhanced method of Secure Data Sharing". It packages a share (or a Native App) with metadata.
- A direct share can be converted to a listing. Existing consumers keep access.
- A **clean room** lets the provider define which analyses can run against shared data. Consumers don't get direct access to the data. Listings, direct shares and Data Exchange all give direct access.
- **Open Data Sharing** shares open table formats (Apache Iceberg, Delta Lake) across regions, clouds and engines, and non-Snowflake consumers can read Snowflake-managed Iceberg tables through the Iceberg REST Catalog API.
- Sharing exists only between Snowflake accounts. For anyone else, use a reader account.

[Back to contents](#contents)

### 1.6.2 Share or clone

| | Share | Clone |
|--|-------|-------|
| What it is | A named object that exposes your objects to other accounts. No data is copied or transferred | A new database, schema or table (a zero-copy copy) that initially shares micro-partitions with its source |
| Writable | **No.** Everything in a share is read-only for consumers | **Yes.** A clone is writable and independent of its source |
| Freshness | Live. New and modified rows are visible at once to consumers who already have access | A snapshot. Changes to the source or clone are not reflected in the other |
| Storage | Consumer pays none. **Provider pays storage.** Consumer pays only for warehouse compute | A clone adds storage only when you change data in it. Each change creates micro-partitions owned by the clone |
| Audience | Other accounts (and reader accounts) | You, in your own account |
| Time Travel | Not supported on an imported database | Can clone as of a point in time with `AT` or `BEFORE` |
| Cloning it | Consumers **cannot clone** an imported database or its schemas and tables | Clones can be cloned, with no limit on the chain |

Clone behaviors that decide scenario answers:
- Cloning a database or schema is recursive. Only objects the cloning role has privileges on are cloned.
- The clone of a database or schema carries privileges granted on the **child** objects, but not privileges granted on the container itself. `CREATE ... CLONE` doesn't copy grants unless you add `COPY GRANTS` (which copies everything except `OWNERSHIP`).
- A cloned table has **no load history** of the source, so files already loaded into the source can be loaded again into the clone.
- A cloned table with a clustering key starts with **Automatic Clustering suspended**.
- Tasks and alerts in a cloned database or schema are **suspended**. Unconsumed stream records in the clone are inaccessible.
- Pipes that reference an internal stage are **not cloned**. Pipes that reference an external stage are cloned. A cloned pipe is paused (`AUTO_INGEST = FALSE`) or `STOPPED_CLONED` (`AUTO_INGEST = TRUE`).
- External tables are not cloned. Hybrid tables can be cloned for databases but not for schemas.
- Table stages of cloned tables are empty. Named internal stages are cloned only with `INCLUDE INTERNAL STAGES`, which uses the COPY FILES service and incurs compute and transfer charges.
- `IGNORE TABLES WITH INSUFFICIENT DATA RETENTION` skips tables whose Time Travel history no longer covers the `AT | BEFORE` point.
- DDL on source child objects during a clone (rename, drop and recreate) can produce name conflicts or missing changes.

Rule of thumb from the pages: use a **share** to give other accounts read-only, live access without copying. Use a **clone** for a writable, independent copy in your own account, such as dev or test. Clone considerations at table level continue in 1.7.

[Back to contents](#contents)

### 1.6.3 Create and manage a direct share

**Privileges (provider)**

| Task | Required |
|------|----------|
| Create a share | `CREATE SHARE` on the account (the creating role owns the share). Only `ACCOUNTADMIN` has it by default |
| Grant objects to a share | The object privilege `WITH GRANT OPTION` on each object, plus `OWNERSHIP` on the share or `MANAGE GRANTS` |
| Add or remove consumer accounts | `OWNERSHIP` on the share **and** the global `MANAGE SHARE TARGET` privilege |
| Override edition or HIPAA restriction | `OVERRIDE SHARE RESTRICTIONS` (`ACCOUNTADMIN` by default) plus `OWNERSHIP` on the share or `CREATE SHARE` |

- `CREATE SHARE` does **not** include the ability to add accounts. Roles that already had `CREATE SHARE` when `MANAGE SHARE TARGET` was introduced received it automatically. Roles granted `CREATE SHARE` now must be granted `MANAGE SHARE TARGET` explicitly.
- Operating on an object in a schema needs at least one privilege on its parent database and schema.
- Preparing objects to share can use any role. Giving `CREATE SHARE` to other roles lets them expose anything they own or have privileges on.
- Consumer-side: `IMPORT SHARE` (and `CREATE DATABASE`) or `ACCOUNTADMIN`.

**Steps in SQL**

```sql
CREATE SHARE sales_s;                                  -- 1. empty share
-- 2. Option 1: through a database role
CREATE DATABASE ROLE sales_db.dr1;
GRANT USAGE ON DATABASE sales_db TO DATABASE ROLE sales_db.dr1;
GRANT USAGE ON SCHEMA sales_db.aggregates_eula TO DATABASE ROLE sales_db.dr1;
GRANT SELECT ON TABLE sales_db.aggregates_eula.aggregate_1 TO DATABASE ROLE sales_db.dr1;
GRANT USAGE ON DATABASE sales_db TO SHARE sales_s;
GRANT DATABASE ROLE sales_db.dr1 TO SHARE sales_s;
-- 2. Option 2: directly to the share
GRANT USAGE ON DATABASE sales_db TO SHARE sales_s;
GRANT USAGE ON SCHEMA sales_db.aggregates_eula TO SHARE sales_s;
GRANT SELECT ON TABLE sales_db.aggregates_eula.aggregate_1 TO SHARE sales_s;
SHOW GRANTS TO SHARE sales_s;                          -- confirm contents
ALTER SHARE sales_s ADD ACCOUNTS = xy12345, yz23456;   -- 3. add consumers
SHOW SHARES;                                           -- kind = OUTBOUND, "to" lists accounts
```

- Grant container privileges first (database, then schema, then objects). Grant `USAGE` on the database **before** adding accounts, or the add fails.
- `ALTER SHARE ... ADD ACCOUNTS` for an account that doesn't exist **succeeds without any change**. Verify spelling.
- `DESCRIBE SHARE` lists the objects in a share. `SHOW SHARES` lists shares and their target accounts. **`SHOW GRANTS OF SHARE` lists only accounts that have created a database from the share**, and is empty if none have.
- Add a share's accounts at any time. The share is visible at once.
- A direct share is enabled for resharing **within the consumer's organization only** (1.6.5).

**Maintaining a share**

| Action | Effect |
|--------|--------|
| Add an object (`GRANT ... TO SHARE`) | Instantly available to consumers who already created a database. Also needs the schema in the share first |
| Remove an object (`REVOKE ... FROM SHARE`) | Instantly unavailable. Can be added back without consumer action |
| Remove an account | The consumer's imported database is **invalidated at once**. Re-adding the account does **not** restore it. They must create a new database from the share |
| Drop the share | All imported databases are invalidated. Recreating a share with the same name is a **new** share. Consumers must create new databases |
| New or recreated object in a granted database | **Not** automatically in the share. Drop and recreate counts as new. Run `GRANT ... TO SHARE` again |

- Removing individual objects is gentler than dropping the share.
- Snowsight can't add or remove external tables, secure materialized views or secure UDFs to a share, and can't add a secure view that references other databases. Use SQL.
- A direct share can be created in Snowsight under Data sharing, External sharing (account locators in the same region only).

**Share restrictions.** By default Snowflake blocks sharing from **Business Critical (or higher)** to a lower edition, and from **HIPAA** to non-HIPAA accounts. To allow it for a direct share:

```sql
GRANT OVERRIDE SHARE RESTRICTIONS ON ACCOUNT TO ROLE sysadmin;
ALTER SHARE my_share ADD ACCOUNTS = consumerorg.consumeraccount SHARE_RESTRICTIONS = FALSE;
```

With Tri-Secret Secure, data access from consumer accounts is treated as access from inside your own account. Listings have their own opt-in restriction (1.6.11).

[Back to contents](#contents)

### 1.6.4 What goes into a share

**Sharable objects:** databases, tables, dynamic tables, external tables, Iceberg tables (externally managed and managed), externally managed Delta Lake tables, views (regular, secure, secure materialized, semantic), Cortex Search services, UDFs (secure and non-secure, depending on handler language), and models of type `USER_MODEL`, `CORTEX_FINETUNED` or `DOC_AI`. Everything is read-only for the consumer.

**Option 1 vs option 2 for granting**

| | Database role granted to the share | Privileges granted directly to the share |
|--|------------------------------------|-------------------------------------------|
| Consumer access | Grant each shared database role to account roles. Different groups can see different subsets | One `IMPORTED PRIVILEGES` grant. All or nothing |
| Multiple source databases | **Not possible.** `REFERENCE_USAGE` can't be granted to a database role | Possible with `REFERENCE_USAGE` |
| Future grants | **Not supported** on a shared database role | Not applicable |
| Mixing | One share can include both. Consumers use `IMPORTED PRIVILEGES` for the directly granted objects | |

Creating the database role needs the global `CREATE DATABASE` and `CREATE SHARE` privileges. The page has a separate section on renaming shared database roles, which I did not read.

**Secure by default.** Only **secure views** are allowed in a default share. Adding a standard view returns an error. To share non-secure views, create or alter the share with `SECURE_OBJECTS_ONLY = FALSE`. This keeps the optimizer benefits of a standard view but can expose data through optimizer reordering (1.6.9).

```sql
CREATE OR REPLACE SHARE allow_non_secure_views SECURE_OBJECTS_ONLY = FALSE;
ALTER SHARE secure_views_only SET SECURE_OBJECTS_ONLY = FALSE;
ALTER VIEW secure_view2 UNSET SECURE;
```

**Rules for secure objects in a share**
- A secure object that references tables by full name must reference the database of the share.
- **Do not use `CURRENT_USER` or `CURRENT_ROLE`** in a shared secure object. In a consumer account they return `NULL` (the provider doesn't control the consumer's users or roles). Use `CURRENT_ACCOUNT()` to authorize by consumer account.
- Validate with `ALTER SESSION SET SIMULATED_DATA_SHARING_CONSUMER = <account>;`. It supports secure views and secure materialized views, not secure UDFs.
- Define clustering keys on large base tables behind shared secure objects.
- Typical pattern: a **private schema** with the base table and a **mapping table** (the table has an `access_id` column, the mapping table maps `access_id` to consumer accounts), and a **public schema** with the secure view. Share only the public schema and the view. The mapping table is needed only to serve different rows to different consumer accounts.

**Multiple databases.** A secure view can reference objects in several databases of the **same account**. Extra steps: `GRANT REFERENCE_USAGE ON DATABASE <referenced_db> TO SHARE <share>` for **each** referenced database (not the one holding the view), before granting `SELECT` on the view. You can grant `USAGE` on only **one** database per share. A secure view that calls a UDF in another database needs a **secure** UDF. Database roles can't be used.

**Streams on shared objects.** Consumers can create streams on shared tables and secure views in their own databases. The provider must run `ALTER TABLE ... SET CHANGE_TRACKING = TRUE` (a consumer can't enable it) and should extend `DATA_RETENTION_TIME_IN_DAYS`, because a stream on a shared table doesn't extend retention. Not supported: append-only streams on secondary shared objects, and modifying a stream in another account. A secure view over a stream is an anti-pattern.

**Tags.** A provider can share a tag and its references: tag in the same database as the tagged objects, `GRANT READ ON TAG ... TO SHARE` (or to a database role) plus `USAGE` on the tag's schema. Consumers see them with `SHOW TAGS`, `SYSTEM$GET_TAG`, `TAG_REFERENCES` and `TAG_REFERENCES_ALL_COLUMNS`. Not through Snowsight or the Account Usage views. Shared tags are read-only.

**Other limits on shared data:** storage lifecycle policies aren't supported on shared tables. Auto-fulfillment lists secure views over a directory table of an **internal** stage (not external) as supported.

[Back to contents](#contents)

### 1.6.5 Consume a share

```sql
SHOW SHARES;                                   -- kind = INBOUND, database_name empty until imported
DESC SHARE xy12345.sales_s;                    -- objects, prefixed until a database exists
CREATE DATABASE snow_sales FROM SHARE xy12345.sales_s;
```

- Role needs `IMPORT SHARE` and `CREATE DATABASE`, or use `ACCOUNTADMIN`.
- **One database per share** per account, and a share can be consumed only once per account.
- Initially **only the role that created the database** can access it.

**Granting access to the imported database**

| Provider used | Consumer does |
|---------------|---------------|
| Objects granted to the share directly | `GRANT IMPORTED PRIVILEGES ON DATABASE snow_sales TO ROLE r2;` Granting role must own the database or hold `MANAGE GRANTS` |
| Database roles | `SHOW DATABASE ROLES IN DATABASE c1;` then `GRANT DATABASE ROLE c1.r1 TO ROLE analyst;` Create the database with a role that has `CREATE DATABASE` and `IMPORT SHARE` |

**Limits on an imported database:** read-only, no clone, no Time Travel, no editing the database comment, no storage lifecycle policies, can't be replicated, and resharing only when allowed (`resharing_settings` column of `SHOW DATABASES`).

**Resharing a direct share.** Allowed only within **your own organization**. The consumer creates a **secure view** in its own database over the imported data (objects from an imported database can't be attached to a share directly), grants `SELECT` on the view to a new share, and adds accounts in the same organization. Only tables, dynamic tables and views can be reshared. UDFs and UDTFs can't. Cross-region resharing of direct shares isn't supported. Use listings. The reshared view must be owned by the role that creates the outgoing share. Policy enforcement is `RESHARER`.

**Policy-protected shared data.** A provider can write a masking policy or row access policy that calls `IS_DATABASE_ROLE_IN_SESSION` and share the database role (database role in the same database as the protected table, granted to the share). When the consumer creates the database, the shared database roles are granted to the creating role. To read the data, the consumer must have the mounted database **active** (`USE DATABASE mounted_db`, or use the fully qualified name). Without it, queries can't satisfy the policy.

**Streams** on shared tables and views work if the provider enabled change tracking (1.6.4). Consume stream records within the retention period to avoid staleness.

[Back to contents](#contents)

### 1.6.6 Reader accounts

A reader account (formerly "read-only account") lets a provider share data with someone who has no Snowflake account.

```sql
USE ROLE ACCOUNTADMIN;
CREATE MANAGED ACCOUNT reader_acct1 ADMIN_NAME = admin1, ADMIN_PASSWORD = '...', TYPE = READER;
SHOW MANAGED ACCOUNTS;
DROP MANAGED ACCOUNT reader_acct1;
```

- Needs `ACCOUNTADMIN` or the global `CREATE ACCOUNT` privilege.
- Same **edition and region** as the provider account. Allow up to **five minutes** for provisioning, then add the account to a share and configure it.
- A reader account **consumes only from the provider account that created it**, never from others.
- The **provider pays** all credits used in the reader account, and warehouses there have no cap. Set a resource monitor.
- Default limit of **75** reader accounts. After dropping one, a replacement can't be created for **7 days** (retention period of deleted reader accounts). Dropping deletes all objects and can't be undone.
- Provider handles support. Reader users have no support agreement.

| Not allowed in a reader account | Notes |
|---------------------------------|-------|
| Load or change data | `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `COPY INTO <table>`, `CREATE STAGE`, `CREATE PIPE` |
| Create policies, shares, services | `CREATE MASKING POLICY`, `CREATE ROW ACCESS POLICY`, `CREATE SHARE`, `CREATE MODEL`, `CREATE SERVICE`, `CREATE IMAGE REPOSITORY`, `CREATE STREAMLIT` |
| Dynamic tables | Refresh fails ("Operation is not supported in reader account"), so `CREATE DYNAMIC TABLE` fails with the default `INITIALIZE = ON_CREATE` |
| Data metric functions | |
| Unload with a storage integration | `COPY INTO <location>` with connection credentials works |

Allowed: querying shared data and operations such as creating materialized views. The `READER_ACCOUNT_USAGE` schema in the `SNOWFLAKE` database reports on reader accounts. Reader accounts can be paired across regions with Client Redirect (Business Critical or higher).

[Back to contents](#contents)

### 1.6.7 Sharing across regions and clouds

A direct share works only for accounts in the **same region**. Two ways to cross regions and clouds. Both are unavailable in the People's Republic of China.

**A. Replication groups (manual).** Cross-region sharing uses replication.

1. An **organization administrator** enables replication for the source and the target accounts. The target account must exist in the other region and be linked to your organization.
2. In the source account (`ACCOUNTADMIN`):
   ```sql
   CREATE REPLICATION GROUP my_rg
     OBJECT_TYPES = databases, shares
     ALLOWED_DATABASES = db1
     ALLOWED_SHARES = share1
     ALLOWED_ACCOUNTS = acme.account_2;
   ```
3. In the target account: `CREATE REPLICATION GROUP my_rg AS REPLICA OF acme.account1.my_rg;`, then `ALTER REPLICATION GROUP my_rg REFRESH;`.
4. Add local consumers: `ALTER SHARE share1 ADD ACCOUNTS = consumer_org.consumer_account_name;` Accounts must be local to the target region.

- One copy of the data **per region**, not per consumer.
- Set `REPLICATION_SCHEDULE` on the **primary** group to automate refresh.
- If the database was replicated on its own before, disable database replication before adding it to a group.
- A secure view over several databases needs all those databases in the same replication group.
- To replicate only a subset (rows), copy the subset into a new database with streams and tasks and replicate that. Replication is per database.
- Check data residency rules before replicating.

**B. Listings with Cross-Cloud Auto-Fulfillment** (1.6.8). Snowflake does the replication.

[Back to contents](#contents)

### 1.6.8 Auto-fulfillment

Auto-fulfillment replicates the data product of a **listing** to other regions on demand. A data product is a share or an application package. It isn't available on trial accounts.

**How it works**
- Snowflake manages a **secure share area (SSA)**, one per organization in each commercial region. VPS environments and government regions each get a separate SSA.
- **Private listings** are fulfilled after the specified consumers get the listing. **Public Marketplace listings** are fulfilled after a consumer in that region gets the listing. The first request creates the copy in the SSA of that region.
- If the product already exists in the region, consumers get it instantly.
- The database is fulfilled only once per region, even if several listings use it.
- For a **private** listing, Snowsight detects a consumer in another region and enables auto-fulfillment. You can't manually replicate private listings.
- For **free and limited-trial Marketplace** listings you can use auto-fulfillment or replicate manually. **Paid** listings use auto-fulfillment.

**Enable and privileges**
```sql
-- ORGADMIN
SELECT SYSTEM$ENABLE_GLOBAL_DATA_SHARING_FOR_ACCOUNT('<account_name>');
SELECT SYSTEM$IS_GLOBAL_DATA_SHARING_ENABLED_FOR_ACCOUNT('<account_name>');
-- ACCOUNTADMIN, after enablement
GRANT MANAGE LISTING AUTO FULFILLMENT ON ACCOUNT TO ROLE listing_admin;
```
- Roles that can set it up: `ORGADMIN`, `ACCOUNTADMIN` (after enablement), or a custom role with `MANAGE LISTING AUTO FULFILLMENT`. Any of them also needs `OWNERSHIP` or `MODIFY` on the listing.
- Add a data product to the listing first. Auto-fulfillment can be configured while the listing is draft or published.
- `SYSTEM$DISABLE_GLOBAL_DATA_SHARING_FOR_ACCOUNT` turns it off.

**Region availability for a Marketplace listing:** **All regions** (default, includes future regions) or **Custom regions** (paid listings default to custom, in supported regions). Fulfillment method **Automatic** (default) or **Manual**. Refresh interval must be **at least 1 minute and no longer than 8 days**.

**Refresh types**

| Type | How | Notes |
|------|-----|-------|
| Trigger-based | `SYSTEM$TRIGGER_LISTING_REFRESH` | SQL only. For example after an ETL run. Also usable once for an out-of-schedule refresh |
| Interval-based | Interval from 1 minute to 8 days | SQL or Provider Studio. Each completion triggers the next |
| Schedule-based | Cron expression | SQL or Provider Studio |

- **Interval-based and schedule-based can't run together.** If both are set, one overrides the other.
- For a **share**, the refresh applies to the database behind the listing. Several listings on one database share the same refresh settings.
- For an **application package**, refresh is set **at account level** and applies to every application package from the account: `ALTER ACCOUNT SET LISTING_AUTO_FULFILLMENT_REPLICATION_REFRESH_SCHEDULE = '60 MINUTES';`. This does not affect listings with shares. The schedule in a region starts from when a consumer there first requests the product.
- For application packages, `LISTING_AUTO_REFRESH` (default `TRUE`) replicates on every release directive change. With `FALSE`, schedule a refresh or call the trigger function.

**Granularity.** The refresh type is **`SUB_DATABASE`** by default (object level: tables and views are fulfilled on demand). `SUB_DATABASE_WITH_REFERENCE_USAGE` supports account-level scheduling for application packages. **`FULL_DATABASE` is deprecated.**

**Listings that span databases:** grant `USAGE` on the main database, `REFERENCE_USAGE` on the referenced database, `USAGE` on the schema, `SELECT` on the view to the share. Supported references: a view over another database's table or view, policies stored in another database, tags stored in another database. Granting `REFERENCE_USAGE` on a database already used by another auto-fulfilled listing moves the affected listings into the **account-level group**, which shares one refresh schedule. One grant can change the refresh schedule of other listings.

**Constraints and considerations**
- Only supported objects can be in or referenced by the data product. The page lists support per product (share or application package), but the tick marks are missing from the fetched text, so I don't reproduce the matrix. Object types named: table, open table (Iceberg, Delta Lake), regular, materialized, secure and semantic views, secure view with `REFERENCE_USAGE`, secure view over an internal-stage directory table, Cortex Knowledge Extensions, Cortex Agents, dynamic table, database roles, SQL UDF/UDTF (regular and secure), stored procedure ("not used by sharing"), masking and row access policies.
- A **compatibility check** runs when a data product is added. For private listings it runs only if the listing is saved as a draft before accounts are added.
- Default **10 TB** limit on the data product size. An account administrator can raise it with an account parameter.
- Duplicate database names in the source (for example dev and prod accounts) get a prefix in the SSA.
- Accounts signed up through AWS, Google Cloud or Azure Marketplace can create SSAs only in those clouds. Fulfilling outside that cloud fails.
- A masking policy set through an **account-level** tag isn't considered. Sharing scope is database, schema and table.
- **Tri-Secret Secure** needs Snowflake Support to enable it for the SSAs.
- You can't remove a region once a consumer has accessed the product there. Consumers must drop the database or app first, or you delete the listing.
- Snowflake emails failed refreshes **daily** to the email address on the listing. `LISTING_REFRESH_HISTORY` returns 14 days per target region. Consumers can use `AVAILABLE_LISTING_REFRESH_HISTORY`.

**Cost.** Charges for compute (copying and syncing), storage in each SSA, and cross-region data transfer (egress). Costs are attributed to the SSA of each region that has active consumers. The refresh interval, database size, change rate, number of regions and the cloud of the destination all matter. Unlike manual replication, auto-fulfillment needs no separate account in each region. The **Egress Cost Optimizer (ECO)** can reduce transfer cost.

[Back to contents](#contents)

### 1.6.9 Views: create and manage

**Types**

| View | Result | Notes |
|------|--------|-------|
| Standard (non-materialized) | Query runs when referenced. Nothing is stored | Most common |
| Materialized | Results stored and maintained | Costs storage and maintenance. Restrictions apply (1.4.18) |
| Secure | Either of the above defined `SECURE` | Better privacy and sharing, possible slower queries |
| Recursive | A non-materialized view that references itself | `RECURSIVE` keyword or a recursive CTE |

Views help with modular code, with exposing a subset of a table (grant the view without granting the table), and with performance (materialized).

**`CREATE VIEW` options worth knowing**

```sql
CREATE [ OR REPLACE ] [ SECURE ] [ { [ LOCAL | GLOBAL ] TEMP | TEMPORARY | VOLATILE } ] [ RECURSIVE ] VIEW [ IF NOT EXISTS ] v
  [ ( col [ COMMENT '...' ] , ... ) ]
  [ WITH ROW ACCESS POLICY p ON ( col, ... ) ]
  [ CHANGE_TRACKING = { TRUE | FALSE } ]
  [ COPY GRANTS ]  [ COPY = ( { COMMENTS | TAGS | GRANTS } , ... ) ]
  AS <select>;
```

- A **column list is required** when any view column is an expression.
- If the table name has no schema, it is assumed to be in **the same schema as the view** (not the session schema).
- `COPY GRANTS` (with `OR REPLACE`) keeps all privileges except `OWNERSHIP`. Without it, the new view loses explicit grants and gets future grants of the schema. Copying happens in the same transaction.
- `CHANGE_TRACKING = TRUE` adds hidden columns to the source table, so streams and `CHANGES` can read the view.
- `TEMPORARY` views exist for the session only. A temporary view with the same name as an existing view hides it for that session, and dropping it drops the temporary view only.
- Row access, masking and projection policies, tags and aggregation or join policies can be set on views and view columns.
- `CREATE OR ALTER VIEW` follows the same limits as `ALTER VIEW`.
- Convert with `ALTER VIEW v SET SECURE` and `ALTER VIEW v UNSET SECURE` (also on `ALTER MATERIALIZED VIEW`).

**Why secure**
1. Optimizations on a standard view can need access to the base data, so user code (such as a UDF, or a predicate engineered to fail) can reveal hidden rows. Example: `WHERE 1/iff(color = 'Purple', 0, 1) = 1` throws a divide-by-zero error if purple rows exist. A secure view's own `WHERE` runs before the user's predicates.
2. The definition of a standard view is visible to other users. For a secure view, only the owning role sees `SHOW VIEWS` text, `GET_DDL` and the Information Schema `VIEWS` definition. `IMPORTED PRIVILEGES` on the `SNOWFLAKE` database or a shared database, `ACCOUNTADMIN` and the `SNOWFLAKE.OBJECT_VIEWER` database role (least privilege) can read it through Account Usage `VIEWS`.

- Use secure views when the view is for **data privacy**, not for query convenience. They can be slower.
- Check with the `IS_SECURE` column (Information Schema or Account Usage `VIEWS`) or `SHOW VIEWS` / `SHOW MATERIALIZED VIEWS`.
- Query Profile does not show the internals of a secure view, even to the owner. Scanned bytes and partitions aren't exposed.
- Error messages for secure objects can be redacted.

**Secure view pitfalls**
- **Sequence-generated columns** (IDs) exposed in a view let users infer the volume of hidden rows. Don't expose them, use `UUID_STRING`, or obfuscate.
- **Query timing** can still hint at data volume. For extremely sensitive cases, materialize a table per role.
- `CURRENT_ROLE` and `CURRENT_USER` return `NULL` when the view is shared. Use `CURRENT_ACCOUNT` (1.6.4).

[Back to contents](#contents)

### 1.6.10 Row-level filtering

Four patterns appear in the pages. Pick by who the consumer is.

| Pattern | Use when | Key gotcha |
|---------|----------|------------|
| Row access policy (RAP) | Filter rows by role, user or mapping table in your own account. Needs Enterprise Edition or higher | Evaluated with the **policy owner's** rights |
| Secure view with `CURRENT_ROLE` and an access table | Per-role rows without RAP | Returns `NULL` for the role if shared |
| Secure view with `CURRENT_ACCOUNT` and a mapping table | Different rows for different **consumer accounts** in a share | Test with `SIMULATED_DATA_SHARING_CONSUMER` |
| RAP with `IS_DATABASE_ROLE_IN_SESSION` and a shared database role | Share a table with a policy | Consumer must have the mounted database active |

**Row access policy basics**
- A schema-level object. It applies to `SELECT` and to rows read by `UPDATE`, `DELETE` and `MERGE`. It does **not** stop inserts, nor updates and deletes of rows the user can see.
- The body returns `BOOLEAN`. Rows where it returns `TRUE` are returned. The policy runs as a **dynamic secure view** (visible in `EXPLAIN` as `DynamicSecureView`, without policy details).
- It applies even to the object owner.
- Evaluation uses the **policy owner's** role, so a user needn't have access to the mapping table the policy reads.

```sql
CREATE OR REPLACE ROW ACCESS POLICY security.sales_policy
AS (sales_region varchar) RETURNS BOOLEAN ->
  'sales_executive_role' = CURRENT_ROLE()
  OR EXISTS (SELECT 1 FROM salesmanagerregions
             WHERE sales_manager = CURRENT_ROLE() AND region = sales_region);

ALTER TABLE sales ADD ROW ACCESS POLICY security.sales_policy ON (region);
ALTER VIEW v1 ADD ROW ACCESS POLICY rap_v1 ON (empl_id);
CREATE TABLE sales (...) WITH ROW ACCESS POLICY sales_policy ON (region);
```

- Use `IS_ROLE_IN_SESSION` (account roles) or `IS_DATABASE_ROLE_IN_SESSION` (database roles) when the role hierarchy matters. A plain `CURRENT_ROLE()` test misses inherited roles.
- Store a mapping table in the same database as the protected table, especially with `IS_DATABASE_ROLE_IN_SESSION`.
- `CURRENT_DATABASE` and `CURRENT_SCHEMA` in a policy body return the database and schema of the **protected table**.
- To update a policy without unprotecting the table, use `ALTER ROW ACCESS POLICY`. The table stays protected. `GET_DDL` or `DESCRIBE ROW ACCESS POLICY` shows the body.
- Find assignments with `POLICY_REFERENCES` (Information Schema table function or Account Usage view). Simulate with `POLICY_CONTEXT`.

**Privileges**

| Task | Privilege |
|------|-----------|
| Create | `CREATE ROW ACCESS POLICY` on the schema (the schema owner has it) |
| Apply or remove on a table or view | Global `APPLY ROW ACCESS POLICY`, or `OWNERSHIP` on the object plus `APPLY` on the policy |
| Alter or drop | `OWNERSHIP` on the policy (or on the schema, to drop) |

- **Future grants on row access policies aren't supported.** Grant `APPLY ROW ACCESS POLICY` to a custom role instead.
- The page recommends giving policy ownership to a custom role rather than `SECURITYADMIN`, because the policy runs with the owner's rights (least privilege).
- Management can be centralized, hybrid or decentralized.

**Interactions and limits**

| Topic | Behavior |
|-------|----------|
| RAP and masking policy | RAP is evaluated **first**. The same column can't be in both signatures |
| Table and view policies | Table policy first, then view, left to right through nested views |
| `CHANGES` clause on a view with a RAP | **Not supported** |
| External table as a mapping table | Not supported. A RAP can go on the external table's `VALUE` column, and on a view for virtual columns |
| Materialized views | Can't create an MV on a table with a RAP, and can't add a RAP to a table that has an MV. A RAP can go directly on an MV. For a base-table RAP, use a dynamic table |
| Streams | A RAP can't be attached to a stream. The table's policy is applied when the stream reads it |
| `CREATE TABLE ... AS SELECT` | New table holds only the filtered rows. No policy on the new table |
| `CREATE TABLE ... LIKE` | Empty table, no policy |
| Cloning a schema | Policies are cloned. A cloned table maps to the cloned policy if in the same schema or database, otherwise keeps the foreign reference |
| Replication | Supported. Fails if a target account has a lower edition, or a dangling reference exists |
| Time Travel | Mapping tables are read at query time, not at the Time Travel point |
| Counts and stats | `COUNT(*)` and `MAX` shortcuts aren't used, so they can be slower and reflect only visible rows |

**Performance guidelines:** fewer policy arguments, simple `CASE` conditions instead of mapping-table lookups, replace mapping-table subqueries with a **memoizable function**, cluster large tables on policy columns, consider search optimization, and test with realistic queries, not `COUNT(*)`.

**Sharing and RAP**
- If a provider's policy calls `CURRENT_ROLE`, `CURRENT_USER` or a secure UDF, the function returns `NULL` in the consumer account. Use `CURRENT_ACCOUNT()` or `IS_DATABASE_ROLE_IN_SESSION` with a shared database role.
- Consumers **can't apply a policy** to a shared table or view. They import the database and create a local view.
- A consumer can't query a shared table whose policy reads a mapping table from a **different provider's** share.
- A provider can't create a policy in a **reader account**.
- A policy that calls an external function can't be assigned to a shared table, and a shared table's policy can't be changed to call one.

**Tag-based RAP** (Enterprise Edition or higher): `ALTER TAG <tag> SET ROW ACCESS POLICY <policy>`. Any table or view carrying the tag, or inheriting it from its schema or database, is protected. Policy arguments map to columns by **name and data type**, or through signature aliases.

[Back to contents](#contents)

### 1.6.11 Listings

A listing is an enhanced form of Secure Data Sharing: it packages a share or a Native App with metadata (title, description, sample SQL) and offers it privately or on the Marketplace. Providers must accept the Provider and Consumer Terms (not required for free or paid off-platform private listings, which need a different acknowledgement). A provider profile is needed to offer paid listings or listings on the Marketplace.

**Availability and access**

| | Options |
|--|---------|
| Availability | **Private** (specific accounts, any region, not on the Marketplace) or **public** (Marketplace) |
| Access | **Free** (full product immediately), **limited trial** (Marketplace only, 1 to 90 days, then request full access), **paid** (Snowflake pricing models) |

- Limited trial suits customer-specific data and licensing or regulatory limits. The provider then offers a free private listing or a paid private listing (if enabled for paid private listings).
- Paid listings: provider needs a Stripe Express account, and paid listings are only available in certain regions.
- Pricing plans and offers allow several SKUs per paid listing. They don't apply to organizational listings. For listings that include pricing plans and offers, a listing can't be converted to another type (for example limited trial to paid), and a consumer can't convert a Native App from one listing type to another.
- Open clients (Spark and others through the Iceberg REST Catalog API) can be added with the `open_sharing` manifest field and external consumers. They see only Snowflake-managed Iceberg tables.
- **Organizational listings** share within an organization. They use the `CREATE ORGANIZATION LISTING` privilege and have no pricing.

**Product types:** **Secure Share** (one secure share per listing), **Native App** (including Declarative Sharing), **Connected App** (external SaaS, must be a public paid listing). Choose before publishing. You can't replace the share or app of a published listing, but you can change objects inside the share.

**V1 and V2 listings:** V1 uses `targets: accounts: [...]` in the manifest and lacks pricing plans and offers. V2 uses `external_targets` (organizations, accounts and roles) and `locations`, and supports more features. Marketplace V2 for VPS is in preview.

**Create and publish**

| Task | Required |
|------|----------|
| Create a listing | Global `CREATE LISTING` (+ `CREATE SHARE`, and the privileges to grant objects) |
| Modify a listing | `OWNERSHIP` or `MODIFY` on the listing |
| Publish | `OWNERSHIP` on the listing, **the publishing role must own the attached share or application package**, and an approved provider profile |
| Configure auto-fulfillment | `MODIFY` on the listing + `MANAGE LISTING AUTO FULFILLMENT` on the account |

- The share's `OWNERSHIP` can't be transferred. If different roles own the share and the listing, grant `MODIFY` on the listing to the role that owns the share.
- Custom roles need an `ORGADMIN` to delegate privileges to `ACCOUNTADMIN` first, which then grants them.
- A SQL example:
  ```sql
  CREATE EXTERNAL LISTING sales_listing
  SHARE sales_s AS
  $$
    title: "Sales data"
    description: "Daily sales data"
    listing_terms:
      type: "OFFLINE"
    targets:
      accounts: ["<org.account>"]
  $$ PUBLISH = FALSE REVIEW = FALSE;
  ```
- In Snowsight: Marketplace, Provider Studio, Create Listing, then Specified Consumers (private) or Snowflake Marketplace (public). Selecting database objects creates a secure share. Selecting an existing share attaches it.
- **Private listing:** publish with the Publish button. After publishing, **you can't change the share**. Edits to a published private listing take effect immediately.
- **Marketplace listing:** Submit for Approval, then Snowflake approves or denies (email to business and technical contacts), then Publish. After the first publish, approved changes publish automatically unless set to manual. Editing creates a **new draft**. Region availability and business needs changes need no approval. A new published version replaces the previous one.
- **Convert a direct share to a listing:** existing consumers keep access, usage analytics start at publish, you can't convert to paid if there are active consumers. For remote consumers, they drop the imported database and get the listing, creating a database of the same name.
- **Consumer:** Snowsight Data sharing, External sharing for private listings, or Marketplace. Needs `ACCOUNTADMIN` or a role with `CREATE DATABASE` and `IMPORT SHARE`. Click **Get**, optionally name the database and add roles. In another region, **Request** triggers auto-fulfillment.
- **Listing share restrictions** are opt-in, unlike direct shares. `ALTER ACCOUNT SET ENABLE_LISTING_SHARE_RESTRICTIONS = TRUE` (account level, `ACCOUNTADMIN`) or per listing. Applies to private external listings, not organization-wide targets, organizational listings or public listings. Doesn't revoke access of existing consumers.
- **Provider usage metrics** are available for private, Data Exchange and Marketplace listings in Provider Studio.

**Data Exchange.** A hub for a **selected group** you invite. A Data Exchange Admin account (`ACCOUNTADMIN`) manages members and designates each as provider, consumer or both. Must be requested from Snowflake Support. Use listings to reach arbitrary consumers.

[Back to contents](#contents)

### 1.6.12 Snowflake Marketplace

- Where providers publish and consumers discover, access and (for paid listings) pay for data, native apps and other products. Available to all Snowflake accounts on AWS, Google Cloud and Azure, **except Azure Government** (planned). Not available in the People's Republic of China.
- Providers share **live** data without copies or pipelines and without maintaining a relationship with each consumer. Consumers get data instantly and updated continually, and can join it with their own data.
- Every Marketplace listing goes through **review and approval** before publishing.
- Marketplace use needs acceptance of additional terms. Private connectivity requires a CNAME record to reach it.
- To get a free Marketplace listing: Marketplace, Snowflake Marketplace, Get, (optional) database name and roles, Get. The consumer role needs `CREATE DATABASE` and `IMPORT SHARE`.
- Providers can attach a notebook to a Marketplace listing (and to private and internal-Marketplace listings) as a usage example.
- VPS: VPS providers can't create monetized listings.

[Back to contents](#contents)

### 1.6.13 Streamlit in Snowflake

Streamlit in Snowflake (SiS) runs an open-source Streamlit app inside Snowflake without moving data or code out. The app is a **schema-level `STREAMLIT` object** governed by RBAC. It works with Snowpark, UDFs, stored procedures and Native Apps.

**Runtimes**

| | Warehouse runtime | Container runtime |
|--|-------------------|-------------------|
| Instance | A personal instance per viewer, on demand | One dedicated instance **shared** by all viewers |
| Compute | A virtual warehouse runs app code and queries | A compute pool node runs app code. A warehouse runs queries |
| Python | 3.9, 3.10, 3.11 | 3.11 |
| Streamlit version | 1.22+ (limited selection) | 1.50+ |
| Packages | Snowflake Conda channel (`environment.yml`) | PyPI and others (`pyproject.toml` or `requirements.txt`) through an external access integration |
| Caching | Single session | Shared across sessions unless session-scoped |
| Idle behavior | WebSocket expires about **15 minutes** after the last activity. Sleep timer available | Server ends after **three days** of viewer inactivity, then the pool suspends |
| Access model | Owner's rights, stored procedure restrictions | Owner's rights by default, optional restricted caller's rights |
| Billing | Warehouse time while active | Compute pool |

- On `SYSTEM_COMPUTE_POOL_CPU`, Snowflake runs three apps per node. Otherwise one app takes a node.
- Apps created with `ROOT_LOCATION` use only the warehouse runtime and have more limits.
- The query warehouse resumes and suspends by its own `AUTO_RESUME` and `AUTO_SUSPEND`.
- Limits: no external stages, no `.so` files, warehouse runtime has a 32 MB limit on a data item (the row label was lost in the fetched text, container runtime is configurable) and a 200 MB file uploader limit, and when a database is replicated the apps are replicated but their compute pools, warehouses, integrations, secrets and roles are not.

**Create**

```sql
CREATE STAGE IF NOT EXISTS my_db.my_schema.my_stage;
PUT file:///path/streamlit_app.py @my_db.my_schema.my_stage/app AUTO_COMPRESS = FALSE OVERWRITE = TRUE;
CREATE STREAMLIT my_app FROM '@my_db.my_schema.my_stage/app'
  MAIN_FILE = 'streamlit_app.py'
  RUNTIME_NAME = 'SYSTEM$ST_CONTAINER_RUNTIME_PY3_11'   -- omit with COMPUTE_POOL for warehouse runtime
  COMPUTE_POOL = my_compute_pool
  QUERY_WAREHOUSE = my_warehouse;
ALTER STREAMLIT my_app ADD LIVE VERSION FROM LAST;
```

**Privileges to create:** `CREATE STREAMLIT` on the schema, `READ` on the stage with the source, `USAGE` on the warehouse, `USAGE` on the compute pool (container runtime), `USAGE` on external access integrations (also needed to install packages from PyPI), `USAGE` on secrets (warehouse runtime), and `CREATE STAGE` only with `ROOT_LOCATION`.

**Owner's rights**
- The app runs with the **owner's** privileges, owner's warehouse, and the database and schema it was created in. Not the caller's.
- Viewers need `USAGE` on the database, the schema and the app. In a schema with **managed access**, `USAGE` on the app must be granted manually.
- Anything the owner's role can use is available to the app for viewers, even without `WITH GRANT`.
- Warehouse-runtime apps run as a stored procedure, so owner's-rights stored procedure restrictions apply (some functions, `ALTER USER`, `SHOW`/`DESCRIBE`/`LIST`). Container apps aren't subject to these.
- **Restricted caller's rights** (Preview): container runtime only, Streamlit 1.53.1+. An admin with `MANAGE CALLER GRANTS` grants caller grants such as `GRANT CALLER SELECT ON TABLE ... TO ROLE app_developer`. Use `st.connection("snowflake")` for owner's rights and `st.connection("snowflake-callers-rights")` for restricted caller's rights in the same app.

**Row access policies in apps**
- Grant the app owner role the global **`READ SESSION`** privilege to use context functions such as `CURRENT_USER`.
- `CURRENT_ROLE()` in a policy returns the **app owner's role**, so the page says you can't use row access policies that call `CURRENT_ROLE` in a Streamlit in Snowflake app. Use `CURRENT_USER`.
- In container runtimes, owner's-rights connections return the owner's context. Restricted caller's rights connections return the **viewer's** context, which suits user-targeted policies.

**Sharing apps**
- Two URL types: **app-builder** (shows Snowsight elements, Edit and Share) and **app-viewer** (no Snowsight chrome). To confine users to viewer URLs, an admin sets the `ALLOWED_INTERFACES` user property.
- Share with a role or directly with a user (user-based access control needs all secondary roles enabled). Two levels: **View and share** (`USAGE WITH GRANT OPTION`) and **View only**.
- `GRANT USAGE ON STREAMLIT db.schema.app TO ROLE ...` plus `USAGE` on the database and schema.
- A reader account can't create Streamlit apps (1.6.6).

**Cost.** Container runtime: compute pool charges. Warehouse runtime: the code warehouse is billed while a WebSocket is open. Ways to reduce: suspend manually, close tabs, set a **custom sleep timer**.

[Back to contents](#contents)

### 1.6.14 Quick-reference for 1.6

| Question | Answer |
|----------|--------|
| Share with an account in another region | Listing with auto-fulfillment, or a replication group of databases and shares |
| Share with no Snowflake account | Reader account (`CREATE MANAGED ACCOUNT ... TYPE = READER`). Provider pays |
| Writable copy in my account | Clone |
| Read-only live data for other accounts, no copy | Share |
| Consumer cloned an imported database | Not supported. Also no Time Travel |
| Add accounts to a share | `ALTER SHARE ... ADD ACCOUNTS`. Needs `OWNERSHIP` on the share and `MANAGE SHARE TARGET` |
| Share fails: standard view | `SECURE_OBJECTS_ONLY = FALSE`, or use a secure view |
| New table added to a shared database is invisible | Grant it to the share explicitly |
| Consumer lost access after account was removed and re-added | They must create a new database from the share |
| Different consumer groups see different objects | Database roles granted to the share |
| Share data from two databases | Secure view, `REFERENCE_USAGE` per referenced database, not database roles |
| Secure view shows NULL role in consumer | `CURRENT_ROLE` and `CURRENT_USER` return NULL. Use `CURRENT_ACCOUNT` |
| Test a share's secure view before sharing | `SIMULATED_DATA_SHARING_CONSUMER` |
| Consumer can't create a stream on shared table | Provider hasn't enabled change tracking |
| Business Critical to Enterprise sharing blocked | `OVERRIDE SHARE RESTRICTIONS` and `SHARE_RESTRICTIONS = FALSE` |
| Auto-fulfillment on-demand refresh | `SYSTEM$TRIGGER_LISTING_REFRESH` |
| Auto-fulfillment max interval | 8 days. Minimum 1 minute. Interval and schedule can't both be set |
| Enable auto-fulfillment | `ORGADMIN` runs `SYSTEM$ENABLE_GLOBAL_DATA_SHARING_FOR_ACCOUNT` |
| Auto-fulfillment size limit | 10 TB by default |
| Row access policy and masking policy on one column | Not allowed. RAP runs first |
| RAP can't see mapping table | Fine. It runs with the policy owner's rights |
| Policy on `CURRENT_ROLE` in a shared table | NULL in consumer. Use `IS_DATABASE_ROLE_IN_SESSION` with a shared database role |
| Streamlit app shows owner data to every viewer | Owner's rights are the default. Use restricted caller's rights (container) |
| Streamlit policy on `CURRENT_USER` fails | Grant `READ SESSION` to the app owner role |
| Idle Streamlit costs | Warehouse: ~15-minute WebSocket, add a sleep timer. Container: compute pool suspends after three days idle |

[Back to contents](#contents)

### 1.6 open items and flags

- **Table in 1.6.1 is partly mine.** The source table has only listings and direct shares. I added Data Exchange, clean room and reader account rows from other paragraphs and left cells blank where the pages are silent.
- **Share versus clone.** No page compares them directly. 1.6.2 combines the sharing intro, the `CREATE ... CLONE` reference, and "Cloning considerations". The statement that a clone lives in your own account is my reading of how the commands work, and I did not find a page that says cloning across accounts is impossible.
- **Database roles and `USAGE`.** The database roles page says granting `USAGE` on the parent database to a database role is "not necessary" because it is implicit at creation. Its own example and the provider page still show `GRANT USAGE ON DATABASE ... TO DATABASE ROLE`. Both are valid.
- **Renaming shared database roles.** The page has a section on renaming that I did not read to the end.
- **Auto-fulfillment supported objects.** The support table lost its tick marks in the fetched text, so the object-by-product matrix is not reliable. Confirm before relying on a specific object type.
- **10 TB limit parameter.** The page links to an account parameter that raises the limit and the name did not come through. I did not guess it.
- **Marketplace navigation.** Pages say both "Data sharing, Internal sharing" and "Data sharing, External sharing" for the Shared with you view.
- **Not read:** `CREATE SHARE`, `ALTER SHARE`, `GRANT ... TO SHARE`, `CREATE LISTING` and `ALTER LISTING` references, the listing manifest reference, pricing models and offers, Egress Cost Optimizer, monitoring and usage views, replication reference pages, declarative sharing, Open Data Sharing detail, secure UDF page (read later for [Domain 5, 5.1.8](../domain_5/d5-udfs-concept.md#518-secure-udfs)), organizational listings pages, `CREATE ROW ACCESS POLICY` reference, memoizable function example (partly), Streamlit getting started, dependency management, external access, secrets, embedding, security overview, sleep timer, and the troubleshooting pages for auto-fulfillment (only the first entry).
- **Streamlit.** The page text for `ADD LIVE VERSION FROM LAST` was cut off after "before users with only USAGE privilege on the Streamlit". I assume it means the live version is what such users see. Check before relying on it.
- **Edition.** Row access policies require Enterprise Edition or higher. Tag-based RAP likewise. The share restriction logic uses Business Critical as the boundary.
