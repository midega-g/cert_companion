# Domain 1: Data Movement, part 3 (SnowPro Advanced: Data Engineer, DEA-C02)

Weight: **28%**. These notes cover Domain 1 sections 1.1 to 1.7 and are divided into three parts. Part 1 is [concepts_part1.md](concepts_part1.md) (1.1 to 1.3). Part 2 is [concepts_part2.md](concepts_part2.md) (1.4 and 1.5). Part 3 (this file) covers 1.6 and 1.7. A section is added only after it is approved. The contents table below lists only the sections in this file.

## Contents

| Section | Topic | Status |
|---------|-------|--------|
| 1.6 | [Design and build data sharing and data consumption solutions](#16-design-and-build-data-sharing-and-data-consumption-solutions) | Approved |
| 1.7 | [Manage different types of tables and data operations](#17-manage-different-types-of-tables-and-data-operations) | Approved |

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
- **Not read:** `CREATE SHARE`, `ALTER SHARE`, `GRANT ... TO SHARE`, `CREATE LISTING` and `ALTER LISTING` references, the listing manifest reference, pricing models and offers, Egress Cost Optimizer, monitoring and usage views, replication reference pages, declarative sharing, Open Data Sharing detail, secure UDF page, organizational listings pages, `CREATE ROW ACCESS POLICY` reference, memoizable function example (partly), Streamlit getting started, dependency management, external access, secrets, embedding, security overview, sleep timer, and the troubleshooting pages for auto-fulfillment (only the first entry).
- **Streamlit.** The page text for `ADD LIVE VERSION FROM LAST` was cut off after "before users with only USAGE privilege on the Streamlit". I assume it means the live version is what such users see. Check before relying on it.
- **Edition.** Row access policies require Enterprise Edition or higher. Tag-based RAP likewise. The share restriction logic uses Business Critical as the boundary.

---

## 1.7 Manage different types of tables and data operations

The study guide lists: manage external tables, Iceberg tables and hybrid tables, perform general table management, use Horizon Catalog to federate data from external catalogs, manage schema evolution, and unload data.

**Sections in 1.7**

- [1.7.1 External tables](#171-external-tables)
- [1.7.2 Iceberg tables](#172-iceberg-tables)
- [1.7.3 Hybrid tables](#173-hybrid-tables)
- [1.7.4 General table management](#174-general-table-management)
- [1.7.5 Horizon Catalog and federating external catalogs](#175-horizon-catalog-and-federating-external-catalogs)
- [1.7.6 Schema evolution](#176-schema-evolution)
- [1.7.7 Unload data](#177-unload-data)
- [1.7.8 Quick-reference for 1.7](#178-quick-reference-for-17)
- [1.7 open items and flags](#17-open-items-and-flags)

### 1.7.1 External tables

**What it is**
- Queries files in an **external stage** as if they were a table. The stage is not managed by Snowflake. Internal stages are not supported.
- **Read-only.** No DML. You can join, create views, and build a materialized view on top (Enterprise Edition) to speed up queries.
- Any format `COPY INTO <table>` supports, **except XML**. Format types in `CREATE EXTERNAL TABLE`: `CSV | JSON | AVRO | ORC | PARQUET`.
- A file with an error during a scan is skipped and the scan continues. A query can return rows read before the error.
- The docs recommend Iceberg tables over external tables for Parquet, and Parquet Direct (preview) for Parquet files in place.

**Columns**
- Every external table has `VALUE` (VARIANT, one row per record), `METADATA$FILENAME` (includes the stage path) and `METADATA$FILE_ROW_NUMBER`. These cannot be dropped.
- `SELECT *` returns only `VALUE` plus any virtual columns.
- **Virtual columns** are expressions over `VALUE` and the pseudocolumns: `col varchar AS (value:col::varchar)`. Types must match the data when scanned.
- Add or drop columns with `ALTER TABLE ... ADD COLUMN | DROP COLUMN`.
- `CREATE EXTERNAL TABLE ... USING TEMPLATE (SELECT ARRAY_AGG(OBJECT_CONSTRUCT(...)) FROM TABLE(INFER_SCHEMA(LOCATION=>'@s', FILE_FORMAT=>'f')))` derives columns from Parquet, Avro or ORC files (CSV and JSON are preview). `OBJECT_CONSTRUCT(*)` can exceed 16 MB, so pass only `COLUMN_NAME`, `TYPE`, `NULLABLE` (and optionally `EXPRESSION`).

**Create: key parameters**

```sql
CREATE [ OR REPLACE ] EXTERNAL TABLE [ IF NOT EXISTS ] <name>
  ( <col> <type> AS <expr>, ... )
  [ PARTITION BY ( <part_col> [, ...] ) ]
  [ WITH ] LOCATION = @<ext_stage>[/path]
  [ REFRESH_ON_CREATE = { TRUE | FALSE } ]   -- default TRUE
  [ AUTO_REFRESH = { TRUE | FALSE } ]        -- default TRUE
  [ PATTERN = '<regex>' ]
  FILE_FORMAT = ( FORMAT_NAME = '<f>' | TYPE = ... )
  [ AWS_SNS_TOPIC = '<arn>' ]                -- S3 with SNS only
  [ INTEGRATION = '<notification_int>' ]     -- GCS Pub/Sub, Azure Event Grid
  [ COPY GRANTS ] [ ROW ACCESS POLICY ... ON (VALUE) ] [ TAG (...) ]
```

- `LOCATION` cannot name individual files. Use `PATTERN` for that. Neither string literals nor SQL variables are supported for `LOCATION`.
- `REFRESH_ON_CREATE = TRUE` does one metadata refresh at creation. With roughly 1 million files or more, set it `FALSE` and refresh by sub-path with `ALTER EXTERNAL TABLE ... REFRESH '<relative-path>'` until all files are registered.
- Not supported: **clustering keys, cloning, XML, Time Travel**. Integrity constraints are not enforced, including `NOT NULL`.
- Not usable: archive-tier objects that need restoration (S3 Glacier Flexible Retrieval or Deep Archive, Azure Archive). Storage versioning (S3, GCS, Azure) is not supported.
- Masking policies and row access policies work on external tables (`ROW ACCESS POLICY ... ON (VALUE)`).
- `CREATE OR REPLACE` is atomic, and equals drop plus create. It cannot be combined with `IF NOT EXISTS`.

**Partitioning (strongly recommended)**

| | Automatic | Manual |
|-|-----------|--------|
| Definition | `part_col AS <expr on METADATA$FILENAME>` with `PARTITION BY` | `PARTITION_TYPE = USER_SPECIFIED`, partition columns typed only |
| Partitions added by | Refresh evaluates the expression | `ALTER EXTERNAL TABLE ... ADD PARTITION (c = 'v') LOCATION '<path>'`, `DROP PARTITION LOCATION '<path>'` |
| `AUTO_REFRESH` | Supported | **Not supported** |
| `REFRESH`, `ADD FILES`, `REMOVE FILES` | Supported | **Not supported** (manual `REFRESH` raises a user error) |
| Typical use | Paths with date, country or similar | Syncing with another metastore (Glue, Hive) |

- The partition method cannot be changed after creation.
- Filter on partition columns in `WHERE` to prune files. All rows in the surviving files are scanned. Non-partition filters are applied after file pruning.
- File sizing for parallel scans: Parquet files 256 to 512 MB, Parquet row groups 16 to 256 MB, other formats 16 to 256 MB.

**Refresh**
- Manual: `ALTER EXTERNAL TABLE <t> REFRESH ['<relative-path>']` adds new files, updates changed files, removes files no longer in the path. Also `ADD FILES (...)` and `REMOVE FILES (...)` with paths relative to `LOCATION`.
- Only the owner (`OWNERSHIP`) or higher can run `ALTER EXTERNAL TABLE`. `REFRESH`, `ADD FILES` and `REMOVE FILES` may run inside an explicit transaction.
- Automatic: cloud event notifications. Per cloud:
  - **S3 (AWS accounts only):** Snowflake-managed SQS queue. Read its ARN from the `notification_channel` column of `SHOW EXTERNAL TABLES` and add it as an event notification target on the bucket. With SNS, set `AWS_SNS_TOPIC`. Snowflake usually uses one SQS queue per AWS region per account. Amazon SQS is not supported as a VPC endpoint, so VPS and PrivateLink customers face a limitation.
  - **GCS:** Pub/Sub subscription plus a **notification integration**, referenced by `INTEGRATION = '<name>'`.
  - **Azure:** Event Grid subscription plus a notification integration, referenced by `INTEGRATION`.
- The S3 sequence is: create stage, create table, manual `REFRESH`, configure the event notification, manual `REFRESH` again, then grants. For GCS and Azure the sequence puts the integration before the table, then one manual `REFRESH`.
- `AUTO_REFRESH = TRUE` is **not** supported for S3-compatible storage, for Delta Lake external tables, or for `PARTITION_TYPE = USER_SPECIFIED`.
- **Transferring ownership** of the table (or its parent database) with `GRANT OWNERSHIP` sets `AUTO_REFRESH = FALSE`. Set it back with `ALTER EXTERNAL TABLE ... SET AUTO_REFRESH = TRUE`.
- Querying with a role other than the owner needs: `USAGE` on database, schema and file format, `USAGE` and `READ` on the named stage, `SELECT` on the table.

**Delta Lake (still supported, to be deprecated)**
- `TABLE_FORMAT = DELTA`. Snowflake reads `_delta_log` files to find the current Parquet files. Deletion vectors are not supported.
- `REFRESH_ON_CREATE` and `AUTO_REFRESH` must both be `FALSE`. Refresh manually. A relative path on `REFRESH` is not supported.
- Manual refresh of a Delta external table uses a warehouse. Manual refresh of a standard external table is a cloud services operation only.
- Migration to Iceberg: `SHOW EXTERNAL TABLES` to get `location`, create an external volume with that location as `STORAGE_BASE_URL`, create a catalog integration for Delta, `CREATE ICEBERG TABLE ... BASE_LOCATION ... EXTERNAL_VOLUME ... CATALOG`, then drop the external table.

**Query behavior and cost**
- Parquet pruning with row group statistics works only when the `WHERE` clause avoids VARIANT columns and uses `=`, `>`, `<`, logical operators or `STARTSWITH`. Use `value:c1::type` (vectorized scanner) rather than bare `value:c1`.
- Invalid UTF-8 rows are silently omitted. Set `REPLACE_INVALID_CHARACTERS = TRUE` in the file format to keep them. For Parquet, `BINARY_AS_TEXT = FALSE` reads untyped binary columns as binary.
- Result cache lasts 24 hours. It is invalidated by DDL on the table or by a metadata refresh that changes the file set. If `AUTO_REFRESH` is off or misconfigured and nobody refreshes, results can go stale.
- Auto-refresh overhead is billed as **Snowpipe** charges (see `PIPE_USAGE_HISTORY`). Manual refresh is a small cloud-services charge. `AUTO_REFRESH_REGISTRATION_HISTORY` (needs `ACCOUNTADMIN` or `MONITOR USAGE`) shows registered files and credits.

[Back to contents](#contents)
### 1.7.2 Iceberg tables

**Table types**

| | Snowflake-managed (Snowflake is the catalog) | Externally managed (catalog integration) |
|-|----------------------------------------------|------------------------------------------|
| `CATALOG` | `'SNOWFLAKE'` | Name of a catalog integration |
| Read and write | Full DML: `INSERT`, `MERGE`, `UPDATE`, `DELETE`, `TRUNCATE`, plus `COPY INTO` and Snowpipe | Read. Writes supported for tables on a remote Iceberg REST catalog (see the externally managed writes page) |
| Lifecycle (compaction, snapshot expiry) | Snowflake | **You**, with your own engine. Refresh the Snowflake table after each maintenance run |
| Clustering | `CLUSTER BY` and Automatic Clustering | Not supported |
| Storage | `SNOWFLAKE_MANAGED` or an external volume | External volume |
| Sources | | Iceberg REST (incl. AWS Glue, Snowflake Open Catalog), Delta files in object storage (Delta Direct), Parquet files (Parquet Direct, preview), Iceberg metadata files |

- Iceberg tables hold Parquet data files. Parquet with unsigned integer logical types is not supported.
- A warehouse must be running and set for the session to create an Iceberg table.
- Convert an externally managed table with `ALTER ICEBERG TABLE ... CONVERT TO MANAGED`. After conversion the table is writable, Snowflake owns cleanup of every file including pre-conversion ones, and **Iceberg partitioning is removed**. No Parquet file is rewritten at conversion. Stop or monitor non-Snowflake writers to the location to avoid corruption.

**Storage**

| | Snowflake storage | External volume |
|-|-------------------|-----------------|
| Setting | `EXTERNAL_VOLUME = 'SNOWFLAKE_MANAGED'` (reserved value, not an object you create) | Name of an external volume you created |
| Who stores and bills | Snowflake | Your cloud provider |
| Fail-safe | Permanent tables have 7-day Fail-safe. `TRANSIENT` has none | None |
| `TRANSIENT` keyword | Allowed | Not allowed |
| Clouds | AWS and Azure (Google Cloud in private preview) | S3, GCS, Azure, S3-compatible |

- Snowflake does not bill storage for external-volume tables. It bills warehouse compute, cloud services, automated refresh, and (for Snowflake-managed tables) cross-region transfer metered under `DATA_LAKE` in `DATA_TRANSFER_HISTORY`.
- Storage size appears in `TABLE_STORAGE_METRICS` (`ACTIVE_BYTES`), joined to `TABLES.IS_ICEBERG`.
- External volume: account-level object, one volume can serve many tables, `CREATE EXTERNAL VOLUME` per cloud, check with `SYSTEM$VERIFY_EXTERNAL_VOLUME('<name>')`. Cloud storage in volumes cannot be reached through a storage integration. Each volume needs its own trust relationship.
- Defaults: `EXTERNAL_VOLUME` and `CATALOG` parameters can be set at account, database or schema, with the lowest scope winning. They affect only tables created afterward. A role needs `USAGE` on the volume or catalog integration.

**Create a Snowflake-managed table**

```sql
CREATE ICEBERG TABLE t (c1 INT, c2 STRING)
  CATALOG = 'SNOWFLAKE'
  EXTERNAL_VOLUME = 'SNOWFLAKE_MANAGED';

CREATE OR REPLACE ICEBERG TABLE t2 (int_col INT)
  PARTITION BY (int_col)
  CATALOG = 'SNOWFLAKE'
  EXTERNAL_VOLUME = 'my_ext_vol'
  BASE_LOCATION = 'my/relative/path';
```

- Variants: `AS SELECT`, `LIKE`, `CLONE`, `FROM BACKUP SET`.
- `BASE_LOCATION`: relative path under the volume. **Cannot be changed after creation.** Default is built from `BASE_LOCATION_PREFIX` and the table name. A renamed table keeps its file path.
- `TARGET_FILE_SIZE = 'AUTO' | '16MB' | '32MB' | '64MB' | '128MB'`. For Snowflake-managed tables `AUTO` starts at 16 MB and adapts. For externally managed tables `AUTO` scales to larger files more aggressively.
- `STORAGE_SERIALIZATION_POLICY = COMPATIBLE | OPTIMIZED` (default `OPTIMIZED`). **Cannot change after creation.** `COMPATIBLE` is for interoperability with other engines.
- `PATH_LAYOUT = FLAT | HIERARCHICAL` (default `FLAT`). `HIERARCHICAL` without `PARTITION BY` behaves as flat.
- `ICEBERG_VERSION`: default is v2 unless set at schema, database or account. v3 is supported. Downgrade is not supported by the Iceberg spec.
- `DATA_RETENTION_TIME_IN_DAYS`: Standard 0 or 1, Enterprise up to 90, default 1. Written to `history.expire.max-snapshot-age-ms`.
- `CATALOG_SYNC = '<open_catalog_integration>'` syncs a Snowflake-managed table to Snowflake Open Catalog.
- `float` and `double` can't be primary keys.
- `USING TEMPLATE` needs `INFER_SCHEMA(... KIND => 'ICEBERG')`, and `INFER_NESTED_TYPES => TRUE` for nested data.
- `CREATE OR REPLACE` makes any stream on the table stale.
- The CREATE reference says cross-cloud and cross-region Iceberg tables are not supported when Snowflake is the catalog, and an external volume must have an active storage location in the account's region. See flags.

**Row-level deletes and merge-on-read**
- Copy-on-write rewrites whole files. Merge-on-read writes delete files (v2 position deletes, v3 deletion vectors).
- `ICEBERG_MERGE_ON_READ_BEHAVIOR = 'AUTO' | 'ENABLED' | 'DISABLED'`, settable at account, database, schema or table, most specific wins. `AUTO` (default) means merge-on-read for Snowflake-managed **v3** tables and for **all externally managed** tables, copy-on-write for Snowflake-managed v2.
- For deletion vectors, Snowflake writes a vector only if fewer than about 5% of a file's rows are deleted and the file is larger than about 1.6 MB. Otherwise it rewrites the file.
- Set `DISABLED` when other engines can't read v3 deletion vectors. `ENABLE_ICEBERG_MERGE_ON_READ` is deprecated.
- Snowflake supports position deletes only for v2 and only with externally managed tables. Row-level equality deletes are not supported. Many dangling position deletes can block create and refresh.

**Optimization (Snowflake-managed only)**

| Feature | Default | Cost |
|---------|---------|------|
| Automatic Clustering (`CLUSTER BY`) | Off | Billed |
| Data compaction (`ENABLE_DATA_COMPACTION`, settable on account, database, schema, table) | On | Billable (bundled for `SNOWFLAKE_MANAGED` storage written only by Snowflake). See `ICEBERG_STORAGE_OPTIMIZATION_HISTORY` |
| Manifest compaction | On, can't disable | None |
| Snapshot expiry | On, can't disable | None |

- Automatic Clustering compacts data even when data compaction is disabled.
- Orphan file deletion is not supported for Snowflake-managed tables. A failed DML can leave untracked Parquet files. Contact Support if storage in the cloud does not match `TABLE_STORAGE_METRICS`.

**Refresh (externally managed tables)**
- Manual: `ALTER ICEBERG TABLE t REFRESH;`. For tables created from Iceberg metadata files, pass the relative metadata path without a leading slash: `REFRESH 'metadata/v1.metadata.json'`.
- Automated: set `REFRESH_INTERVAL_SECONDS` on the catalog integration (default **30** seconds), then `AUTO_REFRESH = TRUE` on the table (`CREATE ICEBERG TABLE ... AUTO_REFRESH = TRUE` or `ALTER ICEBERG TABLE ... SET AUTO_REFRESH`). It polls the catalog and does not use cloud notifications.
- Supported catalogs: Iceberg REST, Snowflake Open Catalog, AWS Glue, and object storage for Delta only.
- Catalog integrations created before Snowflake 8.22 (9.2 for Delta) need `REFRESH_INTERVAL_SECONDS` set with `ALTER CATALOG INTEGRATION` before enabling auto-refresh. Very short intervals on busy tables can degrade performance. Frequent toggling slows refreshes.
- Auto-refresh syncs schema changes only alongside DML. A DDL-only change needs a manual refresh.
- Status: `SHOW ICEBERG TABLES` column `auto_refresh_status`, or `SYSTEM$AUTO_REFRESH_STATUS('<table>')`.
- If another engine upgrades an externally managed table from v2 to v3, refresh fails until a new snapshot exists and you run `CREATE OR REPLACE ICEBERG TABLE`.

**Time Travel**
- `AT | BEFORE` with `VERSION_TAG`, `VERSION` (snapshot ID), `VERSION_REF` (tag or branch name) or `TIMESTAMP`. A version tag is stored in Iceberg metadata, readable by other engines, and unrelated to governance tags.
- For externally managed tables, time travel to a snapshot works if you refresh before the snapshot expires.

**Privileges and misc.**
- Query: `USAGE` (or any privilege) on database and schema, `SELECT` on the table.
- Snowflake supports Iceberg spec v1, v2 and v3 except row-level equality deletes. Outbound private connectivity works for Snowflake-managed tables and for tables that use a catalog integration for object storage. It does not work for tables that use other catalog integrations.
- `SYSTEM$GET_ICEBERG_TABLE_INFORMATION('<table>')` generates Iceberg metadata for new changes and returns the metadata location.

[Back to contents](#contents)
### 1.7.3 Hybrid tables

**What it is**
- A row-store table type for low-latency, high-throughput point reads and writes (Unistore). Row-level locking. Data is also copied asynchronously to object storage, and some columnar data may be cached on the warehouse for analytic scans.
- Same query engine and warehouses as standard tables. Joins with standard tables and atomic transactions across both are supported.
- Use cases named: application and workflow state with many parallel writers, low-latency serving of precomputed aggregates, lightweight transactional apps.
- Availability: GA on AWS and Azure commercial regions, preview on Google Cloud commercial regions. Not in SnowGov regions, trial accounts, or the PRC. VPS needs Support to enable.
- Storage footprint is usually larger than for standard tables.

**Standard versus hybrid**

| | Hybrid | Standard |
|-|--------|----------|
| Layout | Row store, secondary columnar | Columnar micro-partitions |
| Locking | Row-level | Partition or table |
| `PRIMARY KEY` | **Required**, enforced | Optional, not enforced |
| `UNIQUE`, `FOREIGN KEY`, `CHECK` | Optional, enforced | Not enforced (`NOT NULL` is enforced) |

**Create**

```sql
CREATE OR REPLACE HYBRID TABLE application_log (
  id   NUMBER PRIMARY KEY AUTOINCREMENT,
  col1 VARCHAR(20),
  col2 VARCHAR(20) NOT NULL,
  INDEX idx_c1 (col1) INCLUDE (col2)
);
CREATE HYBRID TABLE t2 (employee_id INT PRIMARY KEY, department_id VARCHAR(200))
  AS SELECT employee_id, department_id FROM company_employees;   -- CTAS (no FK)
```

- Needs `CREATE HYBRID TABLE` on the schema, and a running current warehouse. Variants: `AS SELECT`, `LIKE`.
- Composite primary key: out-of-line `CONSTRAINT pk PRIMARY KEY (c1, c2)`.
- `AUTOINCREMENT` defaults to `NOORDER` on hybrid tables, the recommended setting for point-write performance. `DEFAULT` and `AUTOINCREMENT` are mutually exclusive.
- Cannot be temporary or transient, and cannot be inside a transient schema or database.
- Constraints:
  - All four kinds are enforced at the row level (not deferred). `NOT ENFORCED` on `PRIMARY KEY`, `UNIQUE` or `FOREIGN KEY` returns an error. On `CHECK` it silently creates no constraint.
  - **`PRIMARY KEY` and `CHECK` can only be defined at creation.** A `CHECK` can be renamed or dropped but not added.
  - `UNIQUE` and `FOREIGN KEY` can be added or dropped with `ALTER TABLE ... ADD CONSTRAINT` online. The statement returns before the index is built. Check `SHOW INDEXES` `status`: `BUILD IN PROGRESS`, `ACTIVE`, or `BUILD VALIDATION FAILURE` (existing rows violate it, new writes are still enforced, and only `SHOW INDEXES` reports it). One build at a time per table. You cannot alter a column to `UNIQUE`.
  - `FOREIGN KEY`: only between hybrid tables in the **same database**. Child column can't be NULL. Only `RESTRICT` / `NO ACTION`. No partial match or deferrable. The referenced table can't be truncated while the FK exists.
  - Foreign keys help the optimizer treat joins as one-to-many.
- Indexes:
  - `PRIMARY KEY`, `UNIQUE` and `FOREIGN KEY` build their own indexes. Add secondary indexes with `INDEX name (cols) [INCLUDE (cols)]` or `CREATE INDEX`.
  - Not indexable: VARIANT, OBJECT, ARRAY, GEOGRAPHY, GEOMETRY, VECTOR. `TIMESTAMP_TZ` can't be in a `PRIMARY KEY`, `UNIQUE` or `FOREIGN KEY` index but **is** allowed in a secondary index per the limitations page. The `CREATE HYBRID TABLE` reference says indexes cannot be defined on `TIMESTAMP_TZ` columns. See flags.
  - Secondary indexes can't have columns added or be altered. Drop and recreate. Using one requires `SELECT` on the table.
  - Index use is triggered by `=`, `>`, `>=`, `<`, `<=`, `IN`, `BETWEEN`, `STARTSWITH`, and `LIKE 'prefix%'`. `ILIKE` does not use an index.
  - "The value is too long for index" means the index key exceeds the record width limit. Index fewer or narrower columns, or use `INCLUDE`.
- `COLLATE` works only on **non-indexed** character columns.

**Loading**
- Optimized bulk path: CTAS, `COPY INTO <table>`, all `INSERT` variants (including `INSERT ALL`). Confirm in the query profile: "Number of rows bulk loaded". Docs say up to 10x faster. Prefer one bulk transaction for initial load.
- CTAS does not support `FOREIGN KEY`. Use `COPY` or `INSERT ... SELECT`, or CTAS then `ALTER TABLE ADD CONSTRAINT`.
- `COPY INTO` supports only `ON_ERROR = ABORT_STATEMENT`. `SKIP_FILE` errors. A `CHECK` violation fails the load. No error logging on hybrid tables. To keep good rows, load into a standard table with `ON_ERROR = CONTINUE` and error logging, then `INSERT ... SELECT` into the hybrid table.
- **Snowpipe and Snowpipe Streaming are not supported.**

**Not supported**
- Clustering keys (data is ordered by primary key), **data sharing**, dynamic tables, Fail-safe, materialized views, Query Acceleration Service, replication, Search Optimization Service, Snowpipe, Snowpipe Streaming, **streams**, `UNDROP TABLE`.
- `UNDROP SCHEMA` and `UNDROP DATABASE` succeed but the hybrid tables, constraints and indexes are not restored.
- `FILTER`, `REDUCE`, `TRANSFORM` higher-order functions.
- Hybrid tables cannot be shared from provider to consumer. Native Apps can create hybrid tables in the consumer account, but you can't create one in a provider account and include it in a shared view.
- Tri-Secret Secure accounts need Dedicated Storage Mode.
- Queries on hybrid tables don't use the result cache.

**Transactions and consistency**
- Transaction scope is the database. All hybrid tables in one transaction must be in the same database. Standard tables in the same transaction can span databases.
- Default consistency is session-based: you see your own writes. Other sessions can be stale by under 100 ms. `READ_LATEST_WRITES = true` (statement or session) removes the staleness at a few ms cost.
- For a small number of rows use `INSERT`, `UPDATE`, `DELETE` rather than `MERGE`.

**Time Travel and cloning**
- Time Travel queries: only `AT (TIMESTAMP => ...)`. The timestamp must be identical for all tables in the same database. No `OFFSET`, `STATEMENT`, `STREAM`, `BEFORE`.
- Clone at the **database** level only: `CREATE DATABASE clone_db CLONE db;`. `CREATE HYBRID TABLE ... CLONE` fails (error 391411). A schema clone fails unless `IGNORE HYBRID TABLES` is added.
- Point-in-time database clones with hybrid tables accept `AT | BEFORE` with `TIMESTAMP` or `OFFSET`, not `STATEMENT`. Append `IGNORE HYBRID TABLES` to clone at a statement.
- Cloning is a size-of-data copy into the row store: it costs compute and time, scaling with data size.

**Quotas, throughput, cost**
- 2 TB of hybrid (row store) data per database. Beyond that, writes that add data are blocked. `DROP` or `TRUNCATE` frees space in seconds. `DELETE` takes hours because compaction is required.
- Up to about 16,000 operations per second per database for an 80/20 read/write mix. Requests are throttled per database. See `AGGREGATE_QUERY_HISTORY`.
- 200 databases containing hybrid tables per account, and at most 100 added in one hour.
- Billing: row-store storage at a flat per-GB rate (higher than standard storage, and the object-storage copy is not billed), plus normal warehouse credits. Time Travel history is billed at standard storage rates. Views: `STORAGE_USAGE` (`HYBRID_TABLE_STORAGE_BYTES`), `DATABASE_STORAGE_USAGE_HISTORY` (`AVERAGE_HYBRID_TABLE_STORAGE_BYTES`), `HYBRID_TABLES`.

**Operational guidance**
- Use drivers at or above the minimum versions (for example Python connector 3.1.0, JDBC 3.13.31). The SQL API is not recommended for lowest latency.
- Use connection pooling, prepared statements with bound parameters, and run the client in the same cloud region. Snowsight adds overhead, so its latency is not representative.
- X-Small is often enough. For more concurrency, add clusters with a multi-cluster warehouse (scaling policy `Standard`) instead of a larger size.

[Back to contents](#contents)
### 1.7.4 General table management

**Table types**

| | Permanent | Transient | Temporary |
|-|-----------|-----------|-----------|
| Persistence | Until dropped | Until dropped, visible to roles with privileges | Session only, only that session sees it |
| Time Travel | 0 to 90 days (Enterprise+). Standard 0 or 1 | 0 or 1 | 0 or 1, but purged at session end |
| Fail-safe | 7 days | None | None |
| Convert to another type | | Can't | Can't |
| Keyword | (default) | `TRANSIENT` | `TEMPORARY`, `TEMP`, `LOCAL TEMP`, `GLOBAL TEMP`, `VOLATILE` |

- Transient databases and schemas exist. Every table created in a transient schema is transient, and every schema in a transient database is transient.
- Temporary tables do **not** need `CREATE TABLE` on the schema. A temporary table hides a same-named table in the same schema for that session, which matters for `CREATE OR REPLACE` and for `UNDROP`.
- Temporary tables still cost storage until dropped or the session ends. A session ends on explicit exit or after **4 hours** idle. Disconnecting does not end the session.
- Many temporary tables slow `INFORMATION_SCHEMA.TABLES` and `COLUMNS` queries. Drop them before the session ends.
- Procedure-scoped temp table: `CREATE OR REPLACE PROCEDURE SCOPED TEMP TABLE` inside a Snowflake Scripting procedure body lasts one procedure execution.
- A transient clone of a permanent table shares micro-partitions. Shared bytes enter Fail-safe only when the **transient** clone is also dropped.
- Transient tables are not supported by Snowflake Backups.

**CREATE TABLE variants**

| Variant | Behavior |
|---------|----------|
| `CREATE TABLE ... AS SELECT` (CTAS) | Creates and populates. `COPY GRANTS` only with `OR REPLACE`. If clustering keys are given, column definitions are required, Automatic Clustering is enabled by default (even if suspended on the source), and creation is slower because the data is sorted |
| `... LIKE <src>` | Empty copy. The new table keeps the source's clustering keys. Automatic Clustering is not suspended by default, even if it was suspended on the source |
| `... CLONE <src> [AT\|BEFORE (...)]` | Zero-copy. The new table keeps the source's clustering keys, but Automatic Clustering is suspended by default, even if it was running on the source. See 1.6.2 for what a clone does not carry |
| `... USING TEMPLATE (<INFER_SCHEMA query>)` | Columns from staged files. See 1.2.8 |
| `CREATE OR ALTER TABLE` | Declarative: creates or alters to match the definition |
| `... FROM ARCHIVE OF` | Restore from a backup |

- `CREATE OR REPLACE` is atomic (drop plus create in one transaction). It cannot be combined with `IF NOT EXISTS`. It drops change data, so streams on the table go stale.
- `COPY GRANTS` carries existing grants onto the replaced table. `COPY TAGS` and `COPY = (COMMENTS | TAGS | GRANTS)` need `OR REPLACE`, `LIKE` or `CLONE`.
- Table parameters on `CREATE TABLE`: `CLUSTER BY`, `ENABLE_SCHEMA_EVOLUTION`, `DATA_RETENTION_TIME_IN_DAYS`, `MAX_DATA_EXTENSION_TIME_IN_DAYS`, `CHANGE_TRACKING`, `DEFAULT_DDL_COLLATION`, `ERROR_LOGGING`, `ROW_TIMESTAMP`.
- **`CREATE OR ALTER TABLE`:**
  - Supports permanent, temporary, transient and dynamic tables. **Not** read-only, external, Iceberg or hybrid tables.
  - Not supported inside it: CTAS, `USING TEMPLATE`, `LIKE`, `CLONE`, virtual columns.
  - Supported changes: properties and parameters, type, default, nullability, comment, autoincrement, add columns (**only at the end**), drop columns, constraints, clustering keys.
  - A property missing from the new definition is **unset** (reverts to the inherited or default value).
  - A rename is a drop plus add, so data in that column is lost.
  - It does not change `ERROR_LOGGING` and cannot set or unset tags or policies.

**Time Travel and Fail-safe**
- Statements: `AT | BEFORE` with `TIMESTAMP`, `OFFSET` (seconds), `STATEMENT` (query ID), on `SELECT` and `CREATE ... CLONE`. `UNDROP` for tables, schemas, databases, accounts, external volumes, tags, Iceberg tables, dynamic tables and notebooks.
- Retention: `DATA_RETENTION_TIME_IN_DAYS` at account, database, schema or table. Children inherit unless overridden. Default 1. A value of 0 disables Time Travel for that object. Time Travel can't be deactivated for an account as a whole. `ACCOUNTADMIN` can set the account-level value to 0, which only changes the default for new objects, and any database, schema or table can override it.
- `MIN_DATA_RETENTION_TIME_IN_DAYS` (account, `ACCOUNTADMIN`) sets a floor. Effective retention is `MAX(DATA_RETENTION_TIME_IN_DAYS, MIN_DATA_RETENTION_TIME_IN_DAYS)`.
- With retention 0, a dropped permanent table goes straight to Fail-safe and a transient table is deleted. `TIME_TRAVEL_BYTES` can be non-zero for a short while afterward.
- A long-running Time Travel query delays the move to Fail-safe.
- Fail-safe is 7 days, **not configurable**, only Snowflake can recover from it, and it is not available for transient, temporary or hybrid tables.
- When a query uses `AT | BEFORE`, the **current** table schema is used.
- `SHOW TABLES|SCHEMAS|DATABASES HISTORY` lists dropped objects (column `DROPPED_ON`).
- `UNDROP` fails if an object with the same name exists. Rename the existing one first. It needs the `CREATE <object>` privilege on the container. Restoring tables and schemas works only in the current schema or database, even if you give a qualified name.
- Time Travel clones do not carry external tables, internal named stages, or (when using `CREATE SCHEMA ... AT`) user tasks. Hybrid tables are cloned for databases, not schemas.
- `MAX_DATA_EXTENSION_TIME_IN_DAYS` lets Snowflake extend retention to keep streams from going stale.

**Storage**
- `TABLE_STORAGE_METRICS` (Information Schema or Account Usage): `ACTIVE_BYTES`, `TIME_TRAVEL_BYTES`, `FAILSAFE_BYTES`, `RETAINED_FOR_CLONE_BYTES`. Also `ID` and `CLONE_GROUP_ID` (equal if never cloned).
- A clone group's shared micro-partitions are owned by the oldest table. If the owner is dropped, ownership moves to another table when the data leaves Time Travel.
- Loads with `INSERT`, `COPY` or Snowpipe can create Time Travel and Fail-safe bytes because small micro-partitions are defragmented.
- High-churn dimension tables: check `FAILSAFE_BYTES / ACTIVE_BYTES`. The docs still prefer permanent tables for most of these, and use transient only when the cost is excessive and data is reconstructable.
- Staged files in internal stages cost storage but have no Time Travel or Fail-safe. Remove them with `REMOVE` or `PURGE = TRUE`.

**Clustering keys**
- `CLUSTER BY (expr, ...)` at `CREATE TABLE` or `ALTER TABLE ... CLUSTER BY`. The key can be altered or dropped at any time. Not available on hybrid tables. Supported on Snowflake-managed Iceberg tables, not on externally managed ones.
- Worth it for tables with many micro-partitions (typically multiple TB), selective or sorted queries, and a few shared filter columns. Costs credits to build and maintain, so best for frequently queried, rarely changed tables.
- Recommended at most 3 or 4 columns or expressions per key. Maintenance is automatic once defined (Automatic Clustering), and Snowflake reclusters only when it will help.

[Back to contents](#contents)

### 1.7.5 Horizon Catalog and federating external catalogs

**What the pages say Horizon Catalog is**
- Snowflake's catalog for data inside and outside Snowflake. It covers discovery, governance (classification, masking and row access policies, quality, lineage), and interoperability with other engines.
- Two directions to remember:
  1. **Federate in:** Snowflake reads (and writes) tables that live in an external Iceberg REST catalog, through a **catalog integration** and a **catalog-linked database**.
  2. **Serve out:** external engines (Spark, Flink, Trino) read and write Snowflake-managed Iceberg tables through the **Horizon Iceberg REST Catalog API**. Apache Polaris is integrated into Horizon Catalog.
- The study guide bullet says "federate data from external catalogs". The pages I read use "catalog-linked database" and "catalog integration". I found no page using "catalog federation" as a feature name. See flags.

**Catalog integration (Iceberg REST)**

```sql
CREATE CATALOG INTEGRATION my_cat_int
  CATALOG_SOURCE = ICEBERG_REST
  TABLE_FORMAT = ICEBERG
  CATALOG_NAMESPACE = 'my_ns'                -- optional
  REST_CONFIG = (
    CATALOG_URI = 'https://...'
    CATALOG_NAME = '<warehouse>'
    CATALOG_API_TYPE = PUBLIC                 -- or PRIVATE, AWS_GLUE, AWS_S3TABLES, AWS_API_GATEWAY, ...
    ACCESS_DELEGATION_MODE = VENDED_CREDENTIALS  -- or EXTERNAL_VOLUME_CREDENTIALS
  )
  REST_AUTHENTICATION = ( TYPE = OAUTH OAUTH_CLIENT_ID = '..' OAUTH_CLIENT_SECRET = '..' OAUTH_ALLOWED_SCOPES = ('PRINCIPAL_ROLE:ALL') )
  ENABLED = TRUE
  REFRESH_INTERVAL_SECONDS = 30;
```

- Authentication: OAuth, bearer token or PAT, SigV4 (AWS Glue), workload identity federation. Rotate with `ALTER CATALOG INTEGRATION ... SET REST_AUTHENTICATION (OAUTH_CLIENT_SECRET = '...')`.
- Sources with their own pages: Snowflake Open Catalog (and Apache Polaris), another Snowflake account's Horizon Catalog, AWS Glue, Amazon S3 Tables, Amazon API Gateway, Microsoft OneLake, Google Cloud Lakehouse, Databricks Unity Catalog, Tabular. Separate integrations also exist for object storage (Delta, Iceberg files) and Delta Sharing.
- Browse a remote catalog with `SYSTEM$LIST_NAMESPACES_FROM_CATALOG` and `SYSTEM$LIST_ICEBERG_TABLES_FROM_CATALOG`.
- **Storage access, two options:**
  - **Vended credentials** (`ACCESS_DELEGATION_MODE = VENDED_CREDENTIALS`): the catalog hands Snowflake short-lived storage credentials, so no external volume is needed. The catalog must support credential vending. Tables must sit in a single bucket each. If the catalog gives no expiry, Snowflake assumes 60 minutes. `CREATE ICEBERG TABLE ... AS SELECT` is not supported with vended credentials.
  - **External volume**: needed when the catalog cannot vend credentials.
- A role creating the integration needs `CREATE INTEGRATION` on the account.

**Catalog-linked database**

```sql
CREATE DATABASE my_linked_db
  LINKED_CATALOG = (
    CATALOG = 'my_cat_int',
    ALLOWED_NAMESPACES = ('ns1', 'ns2'),      -- optional
    BLOCKED_NAMESPACES = ('ns1.tmp'),         -- optional, wins over ALLOWED
    ALLOWED_WRITE_OPERATIONS = ALL,           -- or NONE (read-only)
    NAMESPACE_MODE = IGNORE_NESTED_NAMESPACE, -- or FLATTEN_NESTED_NAMESPACE
    NAMESPACE_FLATTEN_DELIMITER = '/',
    SYNC_INTERVAL_SECONDS = 30                -- 30 to 86400
  )
  EXTERNAL_VOLUME = 'my_vol'                  -- not needed with vended credentials
  CATALOG_CASE_SENSITIVITY = CASE_INSENSITIVE;-- or CASE_SENSITIVE
```

| Parameter | Default | Note |
|-----------|---------|------|
| `SYNC_INTERVAL_SECONDS` | 30 | Range 30 to 86400. How often Snowflake polls the remote catalog |
| `ALLOWED_WRITE_OPERATIONS` | `ALL` | With `ALL`, a table drop propagates to the remote catalog and removes table and data in **both** |
| `NAMESPACE_MODE` | `IGNORE_NESTED_NAMESPACE` | Only first-level namespaces. `FLATTEN_NESTED_NAMESPACE` needs a delimiter and a catalog with nested namespaces |
| `CATALOG_CASE_SENSITIVITY` | `CASE_INSENSITIVE` | Open Catalog is case-sensitive. Glue and Unity are case-insensitive |

- Requires a role with `CREATE DATABASE` on the account, and `USAGE` on the catalog integration and on the external volume (if used).
- Works only with an **Iceberg REST** catalog integration. Not available in the PRC.
- Remote namespaces appear as schemas, and remote Iceberg tables appear as externally managed Iceberg tables. **Auto-refresh is on by default** for them.
- **On-demand creation:** referencing a remote table that is not yet synced (in `SELECT`, DML, CTAS, `DESCRIBE TABLE`) creates it during that statement on your warehouse. `ALTER`, `DROP`, `GRANT` and `ALTER ... REFRESH` do not trigger it. Until registered, it is not in `SHOW ICEBERG TABLES` or the views.
- Sync behavior:
  - A remote drop drops the Snowflake table (asynchronously). A remote rename drops and recreates it.
  - A `table-uuid` mismatch on refresh drops the table from the linked database and leaves the remote table unchanged.
  - A table that fails to initialize shows `executionState = ICEBERG_TABLE_NOT_INITIALIZED` in `auto_refresh_status` of `SHOW ICEBERG TABLES`, auto-refresh is off, and queries error until you fix it and re-enable.
  - Table and column descriptions sync both ways, and a non-empty description is never replaced by an empty one.
- Limits: can create schemas, externally managed Iceberg tables and database roles, and no other object types. Remote access control (users, roles) is **not** synced. Masking policies and tags are supported. Replication and cloning are not. `ICEBERG_VERSION_DEFAULT` and `ICEBERG_MERGE_ON_READ_BEHAVIOR` can only be set with `ALTER DATABASE` after creation.
- Identifiers: the delimiter can't appear in remote namespaces (such namespaces are skipped). A delimiter other than `_`, `$` or digits forces quotes around the schema name. For Glue, and other catalogs that only allow lowercase, use lowercase in double quotes. Check nesting with `SHOW SCHEMAS` column `is_nested`.
- Check state with `SYSTEM$CATALOG_LINK_STATUS('<db>')` and `SYSTEM$GET_CATALOG_LINKED_DATABASE_CONFIG('<db>')`.
- Billing: discovery, create or drop schema and drop table use cloud services credits (charged only above 10% of daily warehouse credits). Table creation is billed as automated refresh and data registration. On-demand creation runs on your warehouse. See `CATALOG_LINKED_DATABASE_USAGE_HISTORY`.

**Access Iceberg tables in another Snowflake account**
- A catalog integration in the consumer account connects to the provider account's Horizon Iceberg REST Catalog API using **workload identity federation**, with no secret to store or rotate.
- Provider side: a service user (`CREATE USER`, for example `USERADMIN`) is granted a role with `USAGE` on database and schemas and `SELECT` (and write privileges for writes) on tables. Consumer side needs `CREATE INTEGRATION`.
- Supported: read through individual tables or a catalog-linked database, `INSERT`/`UPDATE`/`DELETE`, and in a catalog-linked database `CREATE SCHEMA`, `DROP SCHEMA`, `DROP ICEBERG TABLE`. **`CREATE ICEBERG TABLE` is not supported.**
- **Not supported:** tables protected by masking or row access policies, and the Iceberg REST Scan Plan API.
- Consumer pays compute. Provider pays storage (including data the consumer writes, which belongs to the provider) and Horizon API requests.

**External engines reading Snowflake (Horizon Iceberg REST Catalog API)**
- Spark, Flink, Trino and other engines that speak Iceberg REST can read and write Snowflake-managed Iceberg v2 and v3 tables. Existing roles and policies apply. Vended credentials are supported.
- Workflow: create tables, grant privileges, get an access token (external OAuth, key-pair JWT, PAT, or WIF/OIDC), verify, optionally configure data protection policies, connect the engine.
- Write access needs `SELECT`, `UPDATE`, `TRUNCATE`, `INSERT` and `DELETE` on the table plus `USAGE` (or any privilege) on its database and schema. `CREATE ICEBERG TABLE` needs the schema privilege and `USAGE` on the external volume. Rename and other alterations need `OWNERSHIP`.
- Billing: 0.5 credit per million API calls as cloud services, with billing scheduled to begin in the second half of 2026 per the page. Cross-region egress applies. Private connectivity works for Snowflake-managed tables on S3 or ADLS only.

**Federation alternatives to compare**
- **External table** over files: read-only, schema on read, no catalog. Docs steer Parquet toward Iceberg.
- **Iceberg table with a catalog integration** (single table): `CATALOG = '<integration>'`, `CATALOG_TABLE_NAME`, optional `AUTO_REFRESH`.
- **Catalog-linked database**: all tables in the catalog, automatic discovery, writes allowed.

[Back to contents](#contents)

### 1.7.6 Schema evolution

**Turn it on**
- `CREATE TABLE ... ENABLE_SCHEMA_EVOLUTION = TRUE` or `ALTER TABLE t SET ENABLE_SCHEMA_EVOLUTION = TRUE`. Same for `CREATE ICEBERG TABLE` and `ALTER ICEBERG TABLE`. Default is `FALSE`.
- Evolution happens only when **all three** are true:
  1. The table has `ENABLE_SCHEMA_EVOLUTION = TRUE`.
  2. The load uses `MATCH_BY_COLUMN_NAME`.
  3. The loading role has `EVOLVE SCHEMA` or `OWNERSHIP` on the table (for Snowpipe, the role that owns the pipe).
- CSV with `MATCH_BY_COLUMN_NAME` and `PARSE_HEADER` also needs `ERROR_ON_COLUMN_COUNT_MISMATCH = FALSE`.
- `GRANT EVOLVE SCHEMA ON TABLE t TO ROLE r;`

**What changes**
- Adds new columns.
- Drops `NOT NULL` from columns missing in the new files (no limit on count).
- With `INFER_NESTED_TYPES = TRUE`: adds new nested columns as structured `OBJECT`, `ARRAY`, `MAP` and adds fields to existing structured columns. Without it, a new nested column becomes `VARIANT` (or semi-structured `ARRAY`).
- It does **not** change existing column types, so a record whose value doesn't fit fails.
- ORC and Avro `UNION` columns are always added as `VARIANT`.
- File formats: Avro, Parquet, CSV, JSON, ORC.

**Limits**
- Only `COPY INTO <table>` and Snowpipe. `INSERT` cannot evolve a table. **Tasks do not support it.**
- Default cap: 100 added columns, or one schema change, per `COPY`. Snowpipe has no one-change limit because it applies each change and continues. Contact Support to raise the caps.
- Structured fields: up to 100 per `COPY` by default. Field names in structured columns are case-sensitive even with `CASE_INSENSITIVE` matching.
- `INFER_NESTED_TYPES` works with `COPY INTO` or Snowpipe for Parquet, JSON, Avro and ORC into standard or Snowflake-managed Iceberg tables. It does **not** work with `SELECT` transforms, Snowpipe Streaming, dynamic tables, hybrid tables or external tables.
- Snowpipe Streaming (high-performance architecture) supports evolution for standard and Snowflake-managed Iceberg tables but does not add structured columns or fields. Classic architecture is supported only through the Kafka connector.

**Tracking**
- `SchemaEvolutionRecord` appears in `DESCRIBE TABLE`, `SHOW COLUMNS`, and `INFORMATION_SCHEMA.COLUMNS` and `ACCOUNT_USAGE.COLUMNS`. Example `evolutionType` values: `ADD_COLUMN`, `DROP_NOT_NULL`, `ADD_FIELD`.
- It is **NULL for the Kafka connector with Snowpipe Streaming**, and it is cleared if you manually rename or modify the column afterward.

**Iceberg**
- Snowflake-managed Iceberg tables support evolution. Iceberg tables have no semi-structured `ARRAY`. v2 (the default) has no `VARIANT`. Use v3 for `VARIANT`, or upgrade (permanent). Use `INFER_SCHEMA(... KIND => 'ICEBERG')` and `CREATE ICEBERG TABLE ... USING TEMPLATE`.
- Error `Unsupported data type 'VARIANT' for iceberg tables` means the load would add a type the table can't hold. Set `INFER_NESTED_TYPES = TRUE`, or use v3 for a `VARIANT` column.

**Choosing column types up front**
- `INFER_SCHEMA` sizes types from the sampled files (for example `NUMBER(1,0)` if all values are one digit). Later records that don't fit fail. Use `GENERATE_COLUMN_DESCRIPTION`, edit, and create the table from the list.
- For JSON, new columns are sized from the values in each loaded file. Pre-create a column to control its type.
- Use `VARIANT` for ORC maps, Parquet maps with non-string and non-integer keys, JSON objects keyed by data values, and anything a dynamic table reads (dynamic tables don't support structured types).

**Adding `INFER_NESTED_TYPES` to an existing load**
- Existing data is unchanged. New nested columns arrive structured, and records that don't fit fail (Snowpipe skips those files).
- For Parquet without `USE_VECTORIZED_SCANNER = TRUE`, map values in `VARIANT` columns now load as objects (`{"1":"a"}`) instead of `key_value` arrays. Queries using `my_map:key_value` return NULL for new rows.
- Steps: pause the pipe and save its definition, update `key_value` queries, set `MATCH_BY_COLUMN_NAME` and remove any `SELECT` transform (use `INCLUDE_METADATA` for `METADATA$FILENAME`), set `ENABLE_SCHEMA_EVOLUTION` and grant `EVOLVE SCHEMA`, set `INFER_NESTED_TYPES = TRUE` in every load, recreate the pipe with it.
- Move old `VARIANT` data into structured columns by reloading staged files, or `INSERT ... SELECT` with a cast to the structured type. A cast fails if a value omits a declared field. Use `OBJECT_CONSTRUCT_KEEP_NULL` to store NULL for missing fields. The new table has no load metadata, so a later `COPY` from the same stage can load files again. Use `FILES` or `PATTERN`.

**Troubleshooting map**

| Symptom | Cause and fix |
|---------|---------------|
| New column not added, no error | Missing `ENABLE_SCHEMA_EVOLUTION`, `MATCH_BY_COLUMN_NAME`, or `EVOLVE SCHEMA` for the loading role (the pipe owner for Snowpipe). Fix affects later loads only |
| `Schema evolution is incomplete` | Files need more than one change and `COPY` applies one. Rerun until it succeeds, only the successful run loads the files |
| `adding too many structured fields` | More than 100 fields, usually data values used as JSON keys. Use a `VARIANT` column and reload |
| `Typed object schema mismatch in conversion` | New field not added (check `INFER_NESTED_TYPES`), value too wide for the type, or ORC or JSON map data in a `MAP` column |
| `infer_nested_types is not supported with copy transform` | `SELECT` transform plus the option. Use `MATCH_BY_COLUMN_NAME` instead |
| `template must be a non-null JSON array` | `INFER_SCHEMA` returned no rows. Check `LOCATION` and file format. It also skips Parquet files with maps whose keys aren't strings or integers |
| `MAP` column holds one `key_value` entry or `Numeric value 'key_value' is not recognized` | Neither `INFER_NESTED_TYPES = TRUE` nor `USE_VECTORIZED_SCANNER = TRUE` set |
| `Cannot load Parquet MAP field` | Map with list values. Set `USE_VECTORIZED_SCANNER = TRUE` |
| `Invalid Map Key found in parquet file` | Non-primitive key. Use `VARIANT` (needs Iceberg v3 for Iceberg tables) |
| Snowpipe will not reload a fixed file | Default `ON_ERROR = SKIP_FILE` skipped it. Look for `Load failed` in `COPY_HISTORY` |

- Structured-column queries differ: an undeclared field in a structured `OBJECT` raises an error instead of returning NULL, and `TYPEOF` needs a cast to `VARIANT`.
- Manual schema changes (`ALTER TABLE ADD/DROP COLUMN`, `CREATE OR ALTER TABLE`) are the alternative when automatic evolution is off. Details are in 1.7.4.

[Back to contents](#contents)
### 1.7.7 Unload data

**Flow**
1. `COPY INTO <location> FROM <table | (query)>` writes files to a stage or cloud location. Needs a running current warehouse.
2. Download. Internal stage: `GET`. External: the cloud provider's tools. `GET` cannot read external stages.
- One statement unloads one table or one query. You cannot unload a schema or database in one statement. Use a query with joins to combine tables.
- Destination types: named internal stage, table stage (`@%t`), user stage (`@~`), named external stage, or a direct external URL (S3, GCS, Azure).

```sql
COPY INTO @my_stage/unload/ FROM mytable
  FILE_FORMAT = (FORMAT_NAME = 'my_csv_unload_format');
COPY INTO 's3://bucket/path/' FROM (SELECT ...) STORAGE_INTEGRATION = s3_int
  FILE_FORMAT = (TYPE = PARQUET) HEADER = TRUE;
GET @my_stage/unload/data_0_0_0.csv.gz file:///data/unload PARALLEL = 10;
```

**Formats**
- `TYPE = CSV | JSON | PARQUET`. No Avro or ORC for unload. A named file format can be referenced from the table, the stage or the `COPY`.
- **JSON** output is NDJSON, and `TYPE = JSON` works only when unloading a **VARIANT** column. To unload a relational table as JSON, wrap rows with `OBJECT_CONSTRUCT(...)`.
- **Parquet** from a relational table: use a `SELECT` with `HEADER = TRUE` to keep column names. With `HEADER = FALSE` Parquet gets generic names `col1`, `col2`. `VARIANT`, `GEOMETRY`, `GEOGRAPHY` become JSON strings. `TIMESTAMP_NTZ(9)` becomes milliseconds. `TIMESTAMP_LTZ(9)`, `ARRAY`, `OBJECT`, `MAP` must be cast. **`TIMESTAMP_TZ` and `TIMESTAMP_LTZ` produce an error.** Cast `VARIANT` with `TO_ARRAY` to unload as a Parquet LIST. Fixed-point goes out as DECIMAL and floating-point as DOUBLE unless you cast.
- Parquet row groups are 128 MB. Small files from parallel threads are merged toward `MAX_FILE_SIZE`. Files are written with Apache Arrow 21.1.0.

**Format options (selected)**

| Option | Values and default |
|--------|--------------------|
| `COMPRESSION` (CSV, JSON) | `AUTO` (default, gzip), `GZIP`, `BZ2`, `BROTLI`, `ZSTD`, `DEFLATE`, `RAW_DEFLATE`, `NONE` |
| `COMPRESSION` (Parquet) | `AUTO` (default, Snappy), `LZO`, `SNAPPY`, `NONE`. `SNAPPY_COMPRESSION` is deprecated |
| `RECORD_DELIMITER`, `FIELD_DELIMITER` | Default newline and comma. One delimiter can't be a substring of the other, max 20 characters |
| `FILE_EXTENSION` | Default depends on format and compression |
| `FIELD_OPTIONALLY_ENCLOSED_BY` | Default `NONE` |
| `NULL_IF` | On unload, NULL becomes the **first** value in the list. Default `\\N` |
| `EMPTY_FIELD_AS_NULL` | Default `TRUE` (also a load option) |
| `DATE_FORMAT`, `TIME_FORMAT`, `TIMESTAMP_FORMAT`, `BINARY_FORMAT` | `BINARY_FORMAT = HEX | BASE64 | UTF8` |

- **NULL versus empty string in CSV:** preferred is `FIELD_OPTIONALLY_ENCLOSED_BY = '"'` so `''` and NULL differ. Or leave fields unenclosed, set `EMPTY_FIELD_AS_NULL = FALSE`, and give a `NULL_IF` replacement string. With `EMPTY_FIELD_AS_NULL = TRUE`, empty and NULL are indistinguishable. Use the same `NULL_IF` when reloading.

**Copy options**

| Option | Default | Notes |
|--------|---------|-------|
| `SINGLE` | `FALSE` | `TRUE` writes one file named `data`, and `FILE_EXTENSION` is ignored. Put the name and extension in the path (`@s/data.csv.gz`) and match the compression. Raise `MAX_FILE_SIZE` |
| `MAX_FILE_SIZE` | 16777216 (16 MB) | Max 5368709120 (5 GB). Target per thread, not a hard cap |
| `OVERWRITE` | `FALSE` | Replaces same-named files only. Does not remove other files, and retries may leave extra files |
| `INCLUDE_QUERY_ID` | `FALSE` | Adds the query ID as a UUID in the file name. Recommended over `OVERWRITE` to avoid duplicates. Forced `TRUE` with `PARTITION BY`. Not allowed with `SINGLE = TRUE` or `OVERWRITE = TRUE` |
| `DETAILED_OUTPUT` | `FALSE` | `TRUE` returns one row per file (path, size, rows). `FALSE` returns one summary row |
| `HEADER` | `FALSE` | CSV column headings in every file when `TRUE` |
| `VALIDATION_MODE = RETURN_ROWS` | | Returns the query rows and unloads nothing |

- File names: `data_<query-id-or-0>_<...>.<ext>`. Default internal-stage example: `data_0_0_0.csv.gz`.

**Partitioned unload**
- `PARTITION BY <expr>` (expression must evaluate to a string). Output files are named `data_<partition values>_<UUID>_...` and a NULL partition value goes to `_NULL_`.
- Not combinable with `OVERWRITE = TRUE`, `SINGLE = TRUE`, or `INCLUDE_QUERY_ID = FALSE`. `ORDER BY` order is not preserved. You cannot omit the partition columns from the files.
- Partition values appear in file names, which land in internal support logs possibly processed outside your region. Use dates, timestamps and booleans, not sensitive strings or integers.

**Cloud storage**
- Preferred: a named external stage with a **storage integration**. Direct URL needs `STORAGE_INTEGRATION` or `CREDENTIALS` (S3 key pair or token, Azure SAS) unless the bucket is public.
- Encryption: S3 `AWS_CSE`, `AWS_SSE_S3`, `AWS_SSE_KMS`, `NONE`. GCS `GCS_SSE_KMS`, `NONE`. Azure `AZURE_CSE`, `NONE`.
- S3 needs `s3:PutObject` and `s3:DeleteObject` on the path. Optional `STORAGE_AWS_OBJECT_ACL = 'bucket-owner-full-control'` on the integration.
- Multipart uploads can leave incomplete uploads. Add a lifecycle rule to abort them (S3 and GCS).
- Outbound private connectivity: direct URL unload is not supported. Use an external stage with a storage integration configured for it.
- Account parameters can block unload: one against ad hoc unload to an inline cloud URL, and one against unload to any internal stage. The anchor labels read `prevent-unload-to-inline-url` and `prevent-unload-to-internal-stages`. See flags.

**Behavior to remember**
- Zero source rows: **no file** is written.
- No warning when unloading to a non-empty location. Use an empty path or `INCLUDE_QUERY_ID = TRUE`.
- A failed or cancelled unload can leave files. For partitioned or `INCLUDE_QUERY_ID = TRUE` unloads Snowflake tries to clean up. Otherwise find files by query ID or naming pattern. A failed unload to another region still incurs transfer cost.
- Retries: with `INCLUDE_QUERY_ID = TRUE` a retry removes files that carry the current query ID before rewriting. Without it, a retry can add extra files.
- Masking policies on source columns apply, so a role without the right can unload masked data.
- Status is in `QUERY_HISTORY`.
- `GET`: internal stages only. `PARALLEL` 1 to 99 (default 10). `PATTERN` regex filter. No filename in the local path (JDBC and ODBC treat it as a subdirectory). It does not keep stage directory structure, so same-named files from different folders collide and error.

[Back to contents](#contents)

### 1.7.8 Quick-reference for 1.7

| Situation | Answer |
|-----------|--------|
| Query files in a bucket with no load, read-only | External table. Add partitions and a materialized view for speed |
| External table not picking up new files | Check `AUTO_REFRESH`, event notification and that ownership wasn't transferred (`GRANT OWNERSHIP` sets `AUTO_REFRESH = FALSE`) |
| External table auto-refresh with manual partitions | Not supported (`PARTITION_TYPE = USER_SPECIFIED`) |
| External table on Delta Lake | `TABLE_FORMAT = DELTA`, manual refresh only, uses a warehouse, to be deprecated |
| Auto-refresh cost of an external table | Billed as Snowpipe. `AUTO_REFRESH_REGISTRATION_HISTORY`, `PIPE_USAGE_HISTORY` |
| Iceberg table, Snowflake owns lifecycle | `CATALOG = 'SNOWFLAKE'`. Full DML, compaction, clustering |
| Iceberg table from Glue or REST catalog | Catalog integration, externally managed, refresh manually or `AUTO_REFRESH`, maintenance is yours |
| Iceberg storage Snowflake manages | `EXTERNAL_VOLUME = 'SNOWFLAKE_MANAGED'`. Fail-safe for permanent, `TRANSIENT` allowed |
| Iceberg `BASE_LOCATION` or `STORAGE_SERIALIZATION_POLICY` change | Not possible after creation |
| Iceberg auto-refresh interval | `REFRESH_INTERVAL_SECONDS` on the catalog integration, default 30 |
| Deletion vectors | v3 tables, merge-on-read, `ICEBERG_MERGE_ON_READ_BEHAVIOR` |
| Convert external Iceberg to managed | `ALTER ICEBERG TABLE ... CONVERT TO MANAGED`. Partitioning is removed |
| Hybrid table loading | CTAS, `COPY`, `INSERT` use bulk path. No Snowpipe, no streams |
| Hybrid table sharing, clustering, MV, dynamic table | None supported |
| Hybrid table `PRIMARY KEY` | Required, only at creation |
| Hybrid table clone | Database level only. Schema clone needs `IGNORE HYBRID TABLES` |
| Hybrid table storage limit | 2 TB per database. Throughput about 16,000 ops/s per database |
| Table with no Fail-safe | Transient or temporary |
| Temporary table disappeared | Session ended (explicit exit or 4 h idle) |
| Time Travel max | 90 days permanent on Enterprise+, 1 day otherwise and for transient and temporary |
| Cannot `UNDROP` | Name already in use, retention was 0, past Fail-safe, or it's a hybrid table |
| Link a remote Iceberg REST catalog wholesale | Catalog integration plus catalog-linked database |
| Catalog-linked database default sync | 30 seconds (range 30 to 86400) |
| Remote catalog doesn't vend credentials | Add an external volume |
| Cross-account Iceberg via Horizon | Catalog integration with workload identity federation. Policy-protected tables not supported |
| Schema evolution not happening | `ENABLE_SCHEMA_EVOLUTION`, `MATCH_BY_COLUMN_NAME`, `EVOLVE SCHEMA` or `OWNERSHIP` |
| Schema evolution from `INSERT` or a task | Not supported |
| Schema evolution caps | 100 added columns or one change per `COPY`. Snowpipe not capped on changes |
| Unload single file | `SINGLE = TRUE`, filename in path, raise `MAX_FILE_SIZE` (max 5 GB) |
| Unload with a repeatable path, no duplicates | `INCLUDE_QUERY_ID = TRUE` and empty or unique path |
| Unload JSON from relational table | `OBJECT_CONSTRUCT` in the query |
| Unload partitions | `PARTITION BY`, not with `SINGLE`, `OVERWRITE` |
| Unload empty vs NULL | Enclose with `FIELD_OPTIONALLY_ENCLOSED_BY`, or `EMPTY_FIELD_AS_NULL = FALSE` plus `NULL_IF` |
| Parquet unload errors | `TIMESTAMP_TZ` or `TIMESTAMP_LTZ` |
| Download unloaded files | `GET` for internal. Cloud tools for external |

[Back to contents](#contents)

### 1.7 open items and flags

- **Horizon wording.** The study guide says "Use Horizon Catalog to federate data from external catalogs". The pages I fetched describe this through catalog integrations and catalog-linked databases, and describe Horizon Catalog's own role as serving Snowflake tables to external engines. I found no page with the exact phrase "catalog federation". The `user-guide/tables-iceberg-catalog-federation` and `user-guide/horizon-catalog` paths returned 0 bytes. Confirm the scope against the exam guide if possible.
- **Iceberg cross-region.** The Iceberg overview has a "Cross-cloud/cross-region support" table, but its tick marks are missing in the fetched text, and its prose says both table types incur transfer costs. The `CREATE ICEBERG TABLE (Snowflake as the catalog)` usage notes say cross-cloud and cross-region tables are not currently supported when Snowflake is the catalog. The two pages disagree or are stale. I did not resolve it.
- **Iceberg catalog options table.** The Snowflake-catalog versus external-catalog comparison table lost its tick marks. The rows I wrote come from the prose around it.
- **Hybrid `TIMESTAMP_TZ` indexes.** The limitations page says `TIMESTAMP_TZ` is not allowed in `UNIQUE`, `PRIMARY KEY` and `FOREIGN KEY` indexes but is supported in secondary indexes. The `CREATE HYBRID TABLE` reference says `TIMESTAMP_TZ` columns cannot be indexed. I kept the narrower reading in 1.7.3 and noted both.
- **Hybrid tables in sharing.** The unsupported list says "Data sharing". The Native App note says hybrid tables can't be shared provider to consumer. This matches 1.6, which did not cover hybrid tables.
- **Time Travel for Iceberg.** `DATA_RETENTION_TIME_IN_DAYS` writes `history.expire.max-snapshot-age-ms`. I did not read the "Metadata and retention for Apache Iceberg tables" page.
- **Unload restriction parameters.** The `COPY INTO <location>` page links to two account parameters that block unload to inline URLs and to internal stages. The parameter names were dropped from the extracted text. The anchors suggest `PREVENT_UNLOAD_TO_INLINE_URL` and `PREVENT_UNLOAD_TO_INTERNAL_STAGES`. Verify before relying on the names.
- **Unload privileges.** I did not find the privilege list for `COPY INTO <location>` (stage `WRITE`, integration `USAGE`) in the pages I read.
- **Unload `EMPTY_FIELD_AS_NULL`.** The considerations page calls `TRUE` "prohibited" when you want to tell empty strings from NULLs. I read this as "defeats the purpose", not as an error condition.
- **Not read:** `ALTER TABLE` full reference, `ALTER ICEBERG TABLE`, `CREATE EXTERNAL VOLUME`, `CREATE CATALOG INTEGRATION` variants other than REST, Open Catalog and Glue integration pages, Delta Direct and Parquet Direct pages, Iceberg replication and externally managed writes pages, Iceberg v3 pages, `CREATE INDEX` and hybrid index pages, hybrid table query-profile and monitoring pages, Snowflake Backups, `ALTER ... CLUSTER BY` and Automatic Clustering cost pages, unload to GCS and Azure pages, Iceberg unload (`tables-iceberg-unload` returned 0 bytes), dynamic tables and the remaining general table types (event tables, directory tables, dynamic tables).
- **Time Travel statement.** The Time Travel page says Time Travel can't be deactivated for an account, and also that `ACCOUNTADMIN` can set the account-level retention to 0. These are consistent only if the account value is read as a default that objects can override. The notes use that reading.
- **Part 1 pointers.** Part 1 says schema evolution has "full coverage in 1.7". 1.7.6 is that coverage.
