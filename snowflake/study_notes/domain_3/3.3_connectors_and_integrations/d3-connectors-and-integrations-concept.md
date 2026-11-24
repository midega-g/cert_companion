# Subdomain 3.3: Snowflake Connectors and Integrations

This subdomain covers the **many ways to connect to Snowflake** — the client-side connectors and drivers applications use, and the server-side **integration objects** that let Snowflake securely reach external services.

---

## Overview: Two Sides of Connectivity

| Side | What it is | Examples |
|------|-----------|----------|
| **Client → Snowflake** | Libraries/tools that let apps and tools talk to Snowflake | Connectors, Drivers |
| **Snowflake → External** | **Integration objects** that grant Snowflake secure access to outside services | Storage, API, Git, Notification integrations |

**Key distinction:**
- **Connectors/drivers** run in *your* application and initiate connections *to* Snowflake.
- **Integrations** are *objects inside Snowflake* that let Snowflake reach *out* to cloud storage, APIs, or Git — using stored credentials/trust, not credentials embedded in SQL.

---

## 1. Snowflake Connectors

**What they are:** Purpose-built libraries/plugins that connect **specific platforms or languages** to Snowflake, often handling data movement or framework integration.

**Common connectors:**
| Connector | Purpose |
|-----------|---------|
| **Python Connector** | Native Python DB-API access to Snowflake |
| **Spark Connector** | Read/write between Apache Spark and Snowflake |
| **Kafka Connector** | Stream data from Kafka topics into Snowflake (uses Snowpipe / Snowpipe Streaming) |
| **Connector for Python (pandas)** | `write_pandas` / `fetch_pandas` for DataFrames |
| **.NET, Node.js, PHP, Go connectors** | Language-specific connectivity |

**Ecosystem:** Snowflake also partners with BI, ETL, and data-science tools (the **Snowflake Ecosystem**) that connect via these connectors/drivers.

---

## 2. Snowflake Drivers

**What they are:** Standards-based drivers that let **any compatible tool** connect — the lower-level building blocks many BI/ETL tools use.

| Driver | Standard / Use |
|--------|----------------|
| **JDBC** | Java applications and Java-based tools |
| **ODBC** | Windows/Linux tools, many BI apps (Tableau, Power BI, Excel) |
| **SQLAlchemy** | Python ORM dialect (built on the Python connector) |

**Connector vs. Driver (exam distinction):**
- A **driver** implements a general standard (JDBC/ODBC) so *any* conforming tool can connect.
- A **connector** is a higher-level, platform-specific integration (Spark, Kafka, Python) that often adds data-movement features on top.

---

## 3. Storage Integration

**What it is:** A **named, account-level object** that stores an authentication/trust relationship with **external cloud storage** (S3, GCS, Azure Blob), so stages and `COPY` can access buckets **without inline credentials**.

**Why use it (best practice):**
- Credentials/keys are **not** embedded in `CREATE STAGE` or `COPY` statements.
- One integration can be reused by many stages.
- Access is scoped by `STORAGE_ALLOWED_LOCATIONS` (and optionally `STORAGE_BLOCKED_LOCATIONS`).

**How trust is established (per cloud):**
| Cloud | Trust mechanism |
|-------|-----------------|
| **AWS** | An **IAM role** that Snowflake assumes (Snowflake provides an IAM user ARN + external ID to trust) |
| **GCS** | A **Snowflake-created service account** you grant bucket access to |
| **Azure** | A **consent/tenant** grant to a Snowflake service principal |

**Commands:** `CREATE STORAGE INTEGRATION`, `DESC INTEGRATION` (to fetch the ARN/service account to configure on the cloud side), `ALTER`, `DROP`.

---

## 4. API Integration

**What it is:** An account-level object that lets Snowflake **call external HTTPS endpoints** securely — used by **external functions** and by **Git integration**.

**Used for:**
- **External functions** — SQL functions whose logic runs in an external service (e.g., AWS API Gateway + Lambda, Azure Functions, GCP).
- Provides the **proxy/gateway authentication** (e.g., the IAM role Snowflake assumes to call API Gateway).

**Key settings:** `API_PROVIDER` (e.g., `aws_api_gateway`), `API_AWS_ROLE_ARN`, `API_ALLOWED_PREFIXES` (which endpoints are permitted), `ENABLED`.

**Commands:** `CREATE API INTEGRATION`, `DESC INTEGRATION`, `ALTER`, `DROP`.

---

## 5. Git Integration

**What it is:** Lets Snowflake **connect to a Git repository** (GitHub, GitLab, etc.) so you can version-control and run code (SQL scripts, Streamlit apps, Snowpark, notebooks) directly from a repo inside Snowflake.

**Building blocks:**
1. **API integration** — with `API_PROVIDER = git_https_api` and `API_ALLOWED_PREFIXES` pointing at your Git host.
2. **Secret** (optional) — a `CREATE SECRET` holding a personal access token for private repos.
3. **Git repository object** — `CREATE GIT REPOSITORY` referencing the API integration (and secret), pointing at the repo URL.

**How it's used:**
- `ALTER GIT REPOSITORY ... FETCH` syncs the latest commits.
- Files appear like a **stage** — you can `LIST @repo/branches/main/` and `EXECUTE IMMEDIATE FROM @repo/...` to run versioned SQL.

**Best for:** CI/CD of Snowflake objects, running versioned scripts, deploying Streamlit/Snowpark apps from source control.

---

## Quick Reference Summary

| Topic | Direction | Purpose | Key object/command |
|-------|-----------|---------|--------------------|
| **Connectors** | Client → SF | Platform/language integration | Python, Spark, Kafka, .NET... |
| **Drivers** | Client → SF | Standards-based connectivity | JDBC, ODBC, SQLAlchemy |
| **Storage integration** | SF → cloud storage | Credential-free stage access | `CREATE STORAGE INTEGRATION` |
| **API integration** | SF → HTTPS endpoint | External functions, Git | `CREATE API INTEGRATION` |
| **Git integration** | SF → Git repo | Version-controlled code | `CREATE GIT REPOSITORY` (+ API integration + secret) |

**Big-picture rule for the exam:**
- Need an app/tool to *talk to* Snowflake? → **connector or driver**.
- Need Snowflake to *reach out* to storage/an API/Git safely? → an **integration object** (so no credentials live in your SQL).

---

## Reference Links (from Snowflake docs)

- Connectors / Snowflake Ecosystem
- Drivers
- Storage integration commands / Storage integration for AWS / for Google Cloud Storage / for Microsoft Azure
- API integration commands
- Using a Git repository in Snowflake / Setting up Snowflake to use Git / Git commands in Snowflake
