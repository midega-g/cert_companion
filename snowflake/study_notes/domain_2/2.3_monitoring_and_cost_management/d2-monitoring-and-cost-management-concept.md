# Subdomain 2.3: Monitoring and Cost Management

Proactively managing consumption costs is key to getting the most value from your Snowflake investment. This note describes **what costs money** in Snowflake and the **tools to monitor and control** that spend.

---

## Overview: What You Pay For

Snowflake billing is **consumption-based**, measured in **credits** (compute) plus storage and data transfer. There are three cost categories:

| Category | What it is | Billed as |
|----------|-----------|-----------|
| **Compute** | Virtual warehouses, serverless features, cloud services | **Credits** |
| **Storage** | Data stored (tables, Time Travel, Fail-safe, stages) | **$ per TB / month** (flat rate) |
| **Data Transfer** | Data moved **out** of a region/cloud | **$ per TB** |

> The **credit price** ($ per credit) depends on your edition and cloud region. Credits are the unit; the dollar value varies.

---

## 1. Virtual Warehouse Credit Usage

**What it is:** Virtual warehouses (compute clusters) consume credits **while running**, based on **size** and **time**.

**How credits accrue:**
- Credit consumption **doubles with each warehouse size**: XS = 1 credit/hour, S = 2, M = 4, L = 8, XL = 16, and so on.
- Billed **per second, with a 60-second minimum** each time a warehouse resumes.
- A **suspended** warehouse consumes **no** compute credits.

**Cost control levers:**
- **AUTO_SUSPEND** — automatically suspend after N seconds of inactivity (stops the meter).
- **AUTO_RESUME** — resume automatically when a query arrives.
- **Right-sizing** — pick the smallest size that meets performance needs; larger warehouses finish faster but cost proportionally more per hour.
- **Multi-cluster warehouses** — scale out for concurrency (each cluster consumes credits while active).

---

## 2. Cloud Services & Serverless Costs

### Cloud Services Layer
- Handles authentication, metadata, query compilation/optimization, infrastructure management.
- Consumes credits, but is **only billed if cloud services usage exceeds 10% of daily warehouse (compute) credits** — the "10% adjustment." Most workloads pay little to nothing here.

### Serverless Features
- Snowflake-managed compute (you don't run a warehouse). Examples: **Snowpipe, automatic clustering, materialized view maintenance, search optimization, replication, Snowpipe Streaming, tasks (serverless)**.
- Billed by **serverless credit usage** at feature-specific rates — no warehouse to size or suspend; Snowflake scales it for you.

---

## 3. Storage & Data Transfer Costs

### Storage
- Flat monthly rate **per TB** based on **average daily storage** (compressed).
- Includes table data plus **Time Travel** and **Fail-safe** retained versions, and staged files.

### Data Transfer
- **Ingress is free.** **Egress** (moving data **out** of a region or to a different cloud) incurs per-TB charges.
- Common triggers: cross-region/cross-cloud **replication**, **external functions**, **COPY/unload** to a different region, cross-region data sharing.

**Cost control:** keep compute, storage, and consumers in the **same region/cloud** where possible.

---

## 4. Resource Monitors

**What it is:** An account-level object that **tracks credit usage** by warehouses (or the whole account) and **takes action** when thresholds are hit.

**How it controls cost:**
- Set a **credit quota** over an interval (e.g., 1000 credits/month) with a **frequency** (`DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`, `NEVER`).
- Define **triggers** at % of quota that either:
  - `NOTIFY` — send an alert (no action taken), or
  - `SUSPEND` — suspend warehouses after running queries finish, or
  - `SUSPEND_IMMEDIATE` — suspend and **kill running queries**.
- Assign to **specific warehouses** or the **entire account**.

**Key points:**
- Only `ACCOUNTADMIN` (by default) creates/manages resource monitors.
- Resource monitors control **warehouse compute credits** — they do **not** cap serverless or storage costs.

---

## 5. Budgets

**What it is:** A newer, broader cost-control feature that monitors credit usage for a **group of objects** and **notifies** when spending is projected to exceed a set limit.

**How it differs from resource monitors:**
| | Resource Monitor | Budget |
|---|-----------------|--------|
| Scope | Warehouse compute credits | Warehouses **+ serverless features, storage, materialized views**, etc. (a custom group) |
| Action | Notify **and can suspend** | **Notify only** (spend limit alerting) |
| Granularity | Per warehouse / account | Custom set of resources |

- An **account-level budget** exists by default; you can create **custom budgets** grouping the resources you want to watch.
- Uses ML-based forecasting to warn when projected spend will exceed the limit.

---

## 6. Cost Center / Attribution Tagging

**What it is:** Using **object tags** (from Domain 2.2) to **attribute cost** to teams, departments, projects, or environments.

**How it helps:**
- Tag warehouses (and other objects) with keys like `cost_center = 'marketing'` or `environment = 'prod'`.
- Join tag references with usage views to produce **per-team / per-project cost reports** — enabling chargeback/showback.
- Turns raw credit consumption into **business-meaningful cost allocation**.

---

## 7. ACCOUNT_USAGE Schema

**What it is:** A shared, read-only schema (`SNOWFLAKE.ACCOUNT_USAGE`) of views exposing **historical usage and metadata** for the whole account.

**Key cost/monitoring views:**
| View | Shows |
|------|-------|
| `WAREHOUSE_METERING_HISTORY` | Credits consumed per warehouse per hour |
| `METERING_DAILY_HISTORY` | Daily credits by service type (compute, cloud services, serverless) |
| `STORAGE_USAGE` / `DATABASE_STORAGE_USAGE_HISTORY` | Bytes stored over time |
| `DATA_TRANSFER_HISTORY` | Bytes transferred (egress) |
| `QUERY_HISTORY` | Per-query execution and credit context |
| `TAG_REFERENCES` | Which tags are on which objects (for attribution) |

**Characteristics:**
- **Latency:** data can lag up to ~45 minutes to 3 hours depending on the view.
- **Retention:** up to **1 year** of history.
- Compare with `INFORMATION_SCHEMA` table functions, which are **real-time but shorter retention** (e.g., 7–14 days) and scoped to a single database.

---

## Quick Reference Summary

| Feature | Purpose | Controls / caps? |
|---------|---------|------------------|
| **Warehouse credits** | Core compute cost | AUTO_SUSPEND, right-sizing |
| **Cloud services** | Metadata/compilation | Free under 10% of compute |
| **Serverless** | Managed compute features | Per-feature credit rates |
| **Storage / transfer** | Data at rest / egress | Same-region design |
| **Resource Monitor** | Track + **suspend** warehouse credits | Yes — can suspend |
| **Budget** | Track + **notify** on a resource group | Notify only |
| **Cost tags** | Attribute cost to teams | Reporting/chargeback |
| **ACCOUNT_USAGE** | Historical usage data | Analysis (1-yr history) |

---

## Reference Links (from Snowflake docs)

- Understanding overall cost / Exploring overall cost / Snowflake Service Consumption Table
- Cloud service credit usage
- Serverless credit usage
- Understanding data transfer cost
- Controlling cost / Working with resource monitors / Monitor credit usage with budgets / Cost control for warehouses
- Attributing cost (with tags)
- ACCOUNT_USAGE schema
