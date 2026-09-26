# Subdomain 3.2: Automated Data Ingestion

This subdomain covers **continuous and automated** data loading — moving beyond manual `COPY INTO` to mechanisms that ingest and transform data on their own: Snowpipe, Streams, Tasks, and Dynamic Tables.

---

## Overview: The Automation Building Blocks

| Feature | What it automates | Analogy |
|---------|-------------------|---------|
| **Snowpipe** | Continuous **file** ingestion as files arrive | Auto-loader |
| **Snowpipe Streaming** | Continuous **row** ingestion (no files) | Live wire |
| **Streams** | **Change tracking** (what's new/changed since last read) | Bookmark on changes (CDC) |
| **Tasks** | **Scheduled/triggered execution** of SQL | Cron for SQL |
| **Dynamic Tables** | **Declarative** auto-refreshing transformations | "Set the result, Snowflake keeps it fresh" |

**Classic automated pipeline:** Snowpipe loads raw files → a **Stream** tracks new rows → a **Task** runs on schedule to process those rows into a target table. **Dynamic Tables** collapse the Stream+Task pattern into a single declarative object.

---

## 1. Snowpipe and Snowpipe Streaming

### Snowpipe (file-based, continuous)
**What it is:** Serverless, automated **`COPY INTO`** that loads files **as soon as they land** in a stage — no warehouse to manage, no manual command.

**How it works:**
- You define a **PIPE** object wrapping a `COPY INTO` statement.
- Triggered by:
  - **Auto-ingest** — cloud storage event notifications (S3 SNS/SQS, Azure Event Grid, GCP Pub/Sub) tell Snowpipe a file arrived, or
  - **REST API** — your app calls `insertFiles` to notify Snowpipe.
- **Serverless billing** — charged per compute used (plus a small per-file overhead), not a warehouse.

**Best for:** frequent, small **micro-batches** of files (near-real-time, latency ~minutes).

### Snowpipe Streaming (row-based, lowest latency)
**What it is:** Writes **rows directly** into Snowflake via an SDK/API — **no intermediate files**.
- Lower latency and often lower cost than file-based Snowpipe for streaming sources.
- Integrates with the **Kafka connector** for streaming pipelines.
- Rows are available for query within seconds.

**Snowpipe vs. Snowpipe Streaming:**
| | Snowpipe | Snowpipe Streaming |
|---|----------|--------------------|
| Unit | Files | Rows |
| Latency | ~1 min+ | Seconds |
| Source | Files in a stage | SDK / Kafka |
| Best for | File micro-batches | True streaming |

### PIPE commands
- `CREATE PIPE`, `ALTER PIPE ... REFRESH`, `SHOW PIPES`, `SYSTEM$PIPE_STATUS()`.

---

## 2. Streams (Change Data Capture)

**What it is:** A stream records **DML changes** (inserts, updates, deletes) made to a source table since the stream was last consumed — Snowflake's built-in **CDC**.

**How it works:**
- A stream stores an **offset** (a point in time), not the data itself.
- Querying the stream returns the **changed rows** plus metadata columns:
  - `METADATA$ACTION` — `INSERT` or `DELETE`
  - `METADATA$ISUPDATE` — `TRUE` if the change is part of an update (shown as a delete + insert pair)
  - `METADATA$ROW_ID` — unique row identifier
- The offset **advances only when the stream is consumed inside a DML statement** (e.g., an `INSERT ... SELECT FROM stream`). Merely `SELECT`ing does not advance it.

**Types of streams:**
| Type | Tracks |
|------|--------|
| **Standard** | All DML changes (inserts, updates, deletes) |
| **Append-only** | Inserts only (ignores updates/deletes) — more efficient |
| **Insert-only** | For external tables/directory tables |

### STREAM commands
- `CREATE STREAM ... ON TABLE ...`, `SHOW STREAMS`, `DESCRIBE STREAM`.

---

## 3. Tasks

**What it is:** A schedulable object that **executes SQL** — a single statement, a call to a stored procedure, or (with Snowflake Scripting) multi-step logic.

**How it works:**
- **Schedule** via `SCHEDULE = '<n> MINUTE'` or a **CRON** expression, **or** trigger on a stream having data.
- **Task graphs (DAGs):** chain tasks with `AFTER` so a child runs when its parent(s) finish — building multi-step pipelines.
- Compute options:
  - **User-managed** — you assign a `WAREHOUSE`.
  - **Serverless** — Snowflake sizes/scales compute (`USER_TASK_MANAGED_INITIAL_WAREHOUSE_SIZE`).
- Tasks are created **suspended**; you must `ALTER TASK ... RESUME` them. A DAG is resumed from the **root** last / children first.

**Stream + Task pattern:** A task's condition `WHEN SYSTEM$STREAM_HAS_DATA('my_stream')` runs the task **only when there are changes** — efficient CDC processing.

### TASK commands
- `CREATE TASK`, `ALTER TASK ... RESUME/SUSPEND`, `EXECUTE TASK` (manual run), `SHOW TASKS`, `TASK_HISTORY()`.

---

## 4. Dynamic Tables

**What it is:** A table whose content is **defined by a query** and **automatically kept up to date** by Snowflake. It replaces the manual **Stream + Task** pattern with a **declarative** one.

**How it works:**
- You specify the **query** (the desired result) plus a **`TARGET_LAG`** — how fresh the data must be (e.g., `'5 minutes'` or `DOWNSTREAM`).
- Snowflake handles the **refresh** automatically, choosing **incremental** refresh (only changed rows) when possible, else a **full** refresh.
- **`TARGET_LAG = DOWNSTREAM`** means "refresh only as often as needed to keep dependent dynamic tables fresh."
- Dynamic tables can be **chained** into a DAG of transformations.

**Initialization & refresh:**
- On creation, an **initial refresh** populates the table.
- Ongoing refreshes are **incremental** where the query supports it (better performance/cost); complex queries may force **full** refreshes.

**Dynamic Table vs. Stream+Task:**
| | Stream + Task | Dynamic Table |
|---|---------------|---------------|
| Style | Imperative (you write the CDC + merge logic) | Declarative (you write the target query) |
| Maintenance | You manage offsets, scheduling, merges | Snowflake manages refresh |
| Freshness | Task schedule | `TARGET_LAG` |

### DYNAMIC TABLE commands
- `CREATE DYNAMIC TABLE`, `ALTER DYNAMIC TABLE ... REFRESH/SUSPEND/RESUME`, `SHOW DYNAMIC TABLES`, `DYNAMIC_TABLE_REFRESH_HISTORY()`.

---

## 5. Snowflake Openflow

**What it is:** Snowflake's **managed data integration** service (based on Apache NiFi) for building **ingestion pipelines from many sources** into Snowflake with connectors and visual flows.

**Deployment models:**
- **BYOC (Bring Your Own Cloud)** — Openflow runtime runs in **your** cloud account/VPC (data-plane control, compliance).
- **Snowflake Deployments** — runtime fully managed within Snowflake.

**Best for:** connector-based ingestion from external systems (databases, SaaS, streams) when you want managed pipelines rather than hand-built COPY/Snowpipe.

---

## Quick Reference Summary

| Feature | Automates | Trigger/Freshness | Commands |
|---------|-----------|-------------------|----------|
| **Snowpipe** | File ingestion | Event notify / REST | `CREATE PIPE`, `PIPE_STATUS` |
| **Snowpipe Streaming** | Row ingestion | SDK/Kafka (seconds) | SDK / Kafka connector |
| **Streams** | Change tracking (CDC) | Consumed in DML | `CREATE STREAM` |
| **Tasks** | SQL execution | Schedule / CRON / stream | `CREATE TASK`, `RESUME` |
| **Dynamic Tables** | Declarative transforms | `TARGET_LAG` | `CREATE DYNAMIC TABLE` |
| **Openflow** | Source-to-Snowflake pipelines | Managed (NiFi) | BYOC / Snowflake deploy |

---

## Reference Links (from Snowflake docs)

- Snowpipe / Managing Snowpipe / PIPE commands / Snowpipe Streaming
- Introduction to Streams / STREAM commands
- Introduction to Tasks / TASK commands
- Dynamic tables / Understanding initialization and refresh / DYNAMIC TABLE commands
- About Openflow / BYOC Deployments / Snowflake Deployments
