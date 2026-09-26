# Subdomain 2.3: Monitoring & Cost Management — End-to-End Walkthroughs

Companion to `concepts.md`. Each feature is shown **end-to-end**: setup → apply → **what you actually see** (result sets, alerts, effects), plus how to verify.

> Convention:
> - 🟢 = allowed / normal
> - 🔴 = suspended / blocked
> - Output blocks show the **actual result set or message**.

---

## 1. Virtual Warehouse Credit Usage — See Where Credits Go

### Cost-control configuration on a warehouse
```sql
USE ROLE SYSADMIN;
CREATE WAREHOUSE reporting_wh
  WAREHOUSE_SIZE = MEDIUM     -- 4 credits/hour while running
  AUTO_SUSPEND = 60           -- suspend after 60s idle (stops the meter)
  AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = TRUE;
```

### What you see — credits consumed per warehouse
```sql
SELECT warehouse_name,
       SUM(credits_used) AS credits,
       SUM(credits_used_compute) AS compute,
       SUM(credits_used_cloud_services) AS cloud_svcs
FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY
WHERE start_time > DATEADD('day', -7, CURRENT_TIMESTAMP())
GROUP BY warehouse_name
ORDER BY credits DESC;
```
```
+----------------+---------+---------+------------+
| WAREHOUSE_NAME | CREDITS | COMPUTE | CLOUD_SVCS |
|----------------+---------+---------+------------|
| REPORTING_WH   |  412.5  |  410.0  |    2.5     |
| ETL_WH         |  180.2  |  180.0  |    0.2     |
| ANALYST_WH     |   34.8  |   34.5  |    0.3     |
+----------------+---------+---------+------------+
```

**Point driven home:** The meter runs **only while the warehouse is active**. Dropping `AUTO_SUSPEND` from 600s to 60s on an idle-heavy warehouse directly cuts the `COMPUTE` column. Note `CLOUD_SVCS` is tiny — it's usually free under the 10% rule.

### Sizing effect (conceptual)
```
Same query, 100 GB scan:
  SMALL  (2 cr/hr): runs 40 min -> ~1.33 credits
  LARGE  (8 cr/hr): runs 10 min -> ~1.33 credits
```
**Point driven home:** Bigger warehouses often cost **the same total** for a big scan (4x speed, 4x rate) — but finish sooner. Right-sizing matters most for **many small** queries where a large warehouse just wastes idle capacity.

---

## 2. Daily Credits by Service Type

```sql
SELECT service_type, usage_date, SUM(credits_used) AS credits
FROM SNOWFLAKE.ACCOUNT_USAGE.METERING_DAILY_HISTORY
WHERE usage_date > DATEADD('day', -3, CURRENT_DATE())
GROUP BY service_type, usage_date
ORDER BY usage_date DESC, credits DESC;
```
```
+------------------------+------------+---------+
| SERVICE_TYPE           | USAGE_DATE | CREDITS |
|------------------------+------------+---------|
| WAREHOUSE_METERING     | 2026-09-22 |  620.0  |
| PIPE                   | 2026-09-22 |   12.4  |  <- Snowpipe (serverless)
| AUTO_CLUSTERING        | 2026-09-22 |    8.1  |  <- serverless
| MATERIALIZED_VIEW      | 2026-09-22 |    3.0  |  <- serverless
| CLOUD_SERVICES         | 2026-09-22 |   45.0  |  (may be adjusted to $0)
+------------------------+------------+---------+
```

**Point driven home:** This is the fastest way to spot **serverless** costs (Snowpipe, auto-clustering, MV maintenance) that a **resource monitor won't cap** — you need budgets for those.

---

## 3. Resource Monitors — End to End (with suspend effect)

### Step 1: Create a monitor with quota + triggers
```sql
USE ROLE ACCOUNTADMIN;
CREATE RESOURCE MONITOR reporting_rm
  WITH CREDIT_QUOTA = 1000
       FREQUENCY = MONTHLY
       START_TIMESTAMP = IMMEDIATELY
  TRIGGERS
    ON 75 PERCENT DO NOTIFY
    ON 90 PERCENT DO SUSPEND            -- finish running queries, then suspend
    ON 100 PERCENT DO SUSPEND_IMMEDIATE; -- kill running queries too
```

### Step 2: Attach to a warehouse
```sql
ALTER WAREHOUSE reporting_wh SET RESOURCE_MONITOR = reporting_rm;
```

### Step 3: What happens as usage climbs
```
75% (750 cr):  📧 Notification email to account admins — no action.
90% (900 cr):  warehouse SUSPENDED after in-flight queries complete.
100% (1000 cr): warehouse SUSPENDED_IMMEDIATE, running queries aborted.
```

🔴 A user submitting a query to the suspended warehouse then sees:
```sql
SELECT * FROM sales_db.public.orders;
```
```
Error: Warehouse 'REPORTING_WH' cannot be resumed because resource monitor
'REPORTING_RM' has exceeded its quota.
```

### Step 4: Verify state and usage
```sql
SHOW RESOURCE MONITORS;
```
```
+--------------+--------------+-------+-----------+-------------------------+
| name         | credit_quota | used  | remaining | level                   |
|--------------+--------------+-------+-----------+-------------------------|
| REPORTING_RM |     1000     | 902.3 |   97.7    | 90% trigger fired       |
+--------------+--------------+-------+-----------+-------------------------+
```

**Point driven home:** Resource monitors are the **only** tool that can *hard-stop* spend by suspending warehouses. `SUSPEND` is graceful; `SUSPEND_IMMEDIATE` sacrifices running queries to stop the bleed. They do **not** touch serverless/storage.

---

## 4. Budgets — End to End (notify on a resource group)

### Step 1: Activate the account budget / create a custom one
```sql
USE ROLE ACCOUNTADMIN;
-- Enable the built-in account-level budget
CALL SNOWFLAKE.LOCAL.ACCOUNT_ROOT_BUDGET!ACTIVATE();

-- Create a custom budget for a team's resources
CREATE OR REPLACE SNOWFLAKE.CORE.BUDGET marketing_budget();
CALL marketing_budget!SET_SPENDING_LIMIT(500);       -- 500 credits/interval
CALL marketing_budget!SET_NOTIFICATIONS(
  email_recipients => ['finops@corp.com'],
  notify_integration => 'email_alerts');

-- Add resources to watch (warehouses, tables, schemas...)
CALL marketing_budget!ADD_RESOURCE(SYSTEM$REFERENCE('WAREHOUSE','marketing_wh'));
CALL marketing_budget!ADD_RESOURCE(SYSTEM$REFERENCE('SCHEMA','mkt_db.public'));
```

### Step 2: What the recipient sees
```
From:    no-reply@snowflake.net
Subject: Budget "MARKETING_BUDGET" is projected to exceed its limit
Body:    Projected spend for this interval is 540 credits, exceeding the
         500-credit limit. No resources have been suspended.
```

### Step 3: Verify spend vs. limit
```sql
SELECT * FROM TABLE(marketing_budget!GET_SPENDING_HISTORY());
```
```
+------------+---------------+--------------+
| DATE       | CREDITS_SPENT | LIMIT        |
|------------+---------------+--------------|
| 2026-09-22 |     31.2      |   500        |
| 2026-09-23 |     28.7      |   500        |
+------------+---------------+--------------+
```

**Point driven home:** Budgets **only notify** — nothing gets suspended. Their advantage over resource monitors is **scope**: they watch warehouses *and* serverless *and* storage for a chosen group of objects.

---

## 5. Cost Attribution with Tags — End to End

### Step 1: Tag warehouses by cost center
```sql
USE ROLE ACCOUNTADMIN;
CREATE TAG IF NOT EXISTS cost_center ALLOWED_VALUES 'marketing','finance','engineering';
ALTER WAREHOUSE marketing_wh SET TAG cost_center = 'marketing';
ALTER WAREHOUSE etl_wh       SET TAG cost_center = 'engineering';
```

### Step 2: Join usage to tags for a per-team cost report
```sql
SELECT t.tag_value AS cost_center,
       SUM(w.credits_used) AS total_credits
FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY w
JOIN SNOWFLAKE.ACCOUNT_USAGE.TAG_REFERENCES t
  ON w.warehouse_id = t.object_id
 AND t.tag_name = 'COST_CENTER'
WHERE w.start_time > DATEADD('month', -1, CURRENT_TIMESTAMP())
GROUP BY t.tag_value
ORDER BY total_credits DESC;
```
```
+--------------+---------------+
| COST_CENTER  | TOTAL_CREDITS |
|--------------+---------------|
| engineering  |    1802.4     |
| marketing    |     640.1     |
| finance      |     210.9     |
+--------------+---------------+
```

**Point driven home:** Tagging turns anonymous credit usage into a **chargeback/showback report** — finance can now bill each department for its actual consumption.

---

## 6. Storage & Data Transfer — What You See

### Storage over time
```sql
SELECT usage_date,
       AVG(storage_bytes)/POWER(1024,4)        AS active_tb,
       AVG(time_travel_bytes)/POWER(1024,4)    AS time_travel_tb,
       AVG(failsafe_bytes)/POWER(1024,4)       AS failsafe_tb
FROM SNOWFLAKE.ACCOUNT_USAGE.STORAGE_USAGE
WHERE usage_date > DATEADD('day', -7, CURRENT_DATE())
GROUP BY usage_date ORDER BY usage_date DESC;
```
```
+------------+-----------+----------------+-------------+
| USAGE_DATE | ACTIVE_TB | TIME_TRAVEL_TB | FAILSAFE_TB |
|------------+-----------+----------------+-------------|
| 2026-09-22 |   12.40   |     1.80       |    3.10     |
+------------+-----------+----------------+-------------+
```
**Point driven home:** A surprising storage bill is often **Time Travel + Fail-safe** retained versions, not active data — visible here as separate columns.

### Data transfer (egress)
```sql
SELECT source_region, target_region,
       SUM(bytes_transferred)/POWER(1024,4) AS tb_transferred
FROM SNOWFLAKE.ACCOUNT_USAGE.DATA_TRANSFER_HISTORY
WHERE start_time > DATEADD('month',-1,CURRENT_TIMESTAMP())
GROUP BY 1,2 HAVING tb_transferred > 0;
```
```
+----------------+----------------+----------------+
| SOURCE_REGION  | TARGET_REGION  | TB_TRANSFERRED |
|----------------+----------------+----------------|
| us-east-1      | eu-west-1      |     2.30       |  <- cross-region = $$$
+----------------+----------------+----------------+
```
**Point driven home:** Rows here mean data left a region (replication, cross-region share, unload) — the fix is usually to co-locate compute/consumers in the same region.

---

## 7. ACCOUNT_USAGE vs INFORMATION_SCHEMA — When to Use Which

```sql
-- ACCOUNT_USAGE: account-wide, up to 1 year, some latency (~45min–3h)
SELECT SUM(credits_used) FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY
WHERE start_time > DATEADD('day',-90,CURRENT_TIMESTAMP());

-- INFORMATION_SCHEMA: real-time, shorter retention, table function
SELECT * FROM TABLE(INFORMATION_SCHEMA.WAREHOUSE_METERING_HISTORY(
  DATEADD('day',-1,CURRENT_TIMESTAMP())));
```

**Point driven home:** Use `INFORMATION_SCHEMA` for **right now / today**; use `ACCOUNT_USAGE` for **trends and history** (up to a year), accepting some latency.

---

## Mental Model Recap

| Feature | You run… | You see… | Key takeaway |
|---------|----------|----------|--------------|
| Warehouse credits | `CREATE WAREHOUSE ... AUTO_SUSPEND` | credits per WH | Meter runs only while active |
| Metering by service | query `METERING_DAILY_HISTORY` | credits per service type | Spot serverless costs here |
| Resource Monitor | `CREATE RESOURCE MONITOR` + triggers | notify → suspend → suspend_immediate | Only tool that hard-stops WH spend |
| Budget | `CREATE BUDGET` + `SET_SPENDING_LIMIT` | projection email | Notify only, broader scope |
| Cost tags | `ALTER WAREHOUSE SET TAG` + join | per-team credit report | Enables chargeback |
| Storage/transfer | query `STORAGE_USAGE`/`DATA_TRANSFER_HISTORY` | TB by type/region | Time Travel + egress surprise costs |
| ACCOUNT_USAGE | query shared views | 1-yr history, some latency | Trends vs. real-time (INFO_SCHEMA) |

> ⚠️ **Verify before exam/production:** budget API call names (`ACTIVATE`, `SET_SPENDING_LIMIT`, `ADD_RESOURCE`), exact view columns, and the cloud-services 10% adjustment specifics change over time. Confirm against current Snowflake docs.
