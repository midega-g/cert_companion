# Domain 1: Data Movement, connectors (SnowPro Advanced: Data Engineer, DEA-C02)

Weight: **28%**. Domain 1 notes are split across five files: [d1-data-loading-and-ingestion-concept.md](d1-data-loading-and-ingestion-concept.md) (1.1 to 1.3: loading and ingestion); [d1-streams-and-tasks-concept.md](d1-streams-and-tasks-concept.md) (1.4.1 to 1.4.12: streams and tasks); [d1-continuous-pipelines-concept.md](d1-continuous-pipelines-concept.md) (1.4.13 to 1.4.26: dynamic tables, Snowpipe and developer tools); this file, 1.5: connectors; [d1-sharing-and-tables-concept.md](d1-sharing-and-tables-concept.md) (1.6 to 1.7: sharing and tables). A section is added only after it is approved. The contents table below lists only the sections in this file.

## Contents

| Section | Topic | Status |
|---------|-------|--------|
| 1.5 | [Install, configure and use connectors](#15-install-configure-and-use-connectors) | Approved |

---

## 1.5 Install, configure and use connectors

The study guide lists four connector families: Kafka, Spark, Python and native connectors. This section covers each. The Kafka connector summary in [1.4.21](d1-continuous-pipelines-concept.md#1421-snowpipe-streaming-and-the-kafka-connector) is the short version. This is the full version.

**Sections in 1.5**

- [1.5.1 Which connector for which job](#151-which-connector-for-which-job)
- [1.5.2 Kafka connector: versions and architecture](#152-kafka-connector-versions-and-architecture)
- [1.5.3 Kafka connector v4: Snowflake setup and properties](#153-kafka-connector-v4-snowflake-setup-and-properties)
- [1.5.4 Kafka connector v4: tables, pipes, validation and errors](#154-kafka-connector-v4-tables-pipes-validation-and-errors)
- [1.5.5 Kafka connector v3 (classic)](#155-kafka-connector-v3-classic)
- [1.5.6 Kafka connector: migration and troubleshooting](#156-kafka-connector-migration-and-troubleshooting)
- [1.5.7 Spark connector](#157-spark-connector)
- [1.5.8 Python connector](#158-python-connector)
- [1.5.9 Native connectors](#159-native-connectors)
- [1.5.10 Quick-reference for 1.5](#1510-quick-reference-for-15)
- [1.5 open items and flags](#15-open-items-and-flags)

### 1.5.1 Which connector for which job

| Source or client | Use | Direction | Notes |
|------------------|-----|-----------|-------|
| Apache Kafka topics | Kafka connector (v4 recommended) | Kafka to Snowflake only | Runs in your Kafka Connect cluster |
| Apache Spark (self-hosted, EMR, Databricks, Qubole) | Spark connector | Both directions | Query pushdown from Spark into Snowflake |
| A Python application | Python connector | Both | PEP 249 `Connection` and `Cursor` |
| MySQL or PostgreSQL | Native App connector with an agent (preview), or the Openflow connector (the stated successor) | Source to Snowflake | CDC replication |
| ServiceNow | Native App connector | Source to Snowflake | The page calls it generally available |
| Google Analytics 4 | Native App connectors (aggregate or raw) | Source to Snowflake | See 1.5.9 |
| SharePoint | Native App connector (preview), or the Openflow connector | Source to Snowflake | Files and permissions, Cortex Search |

The Kafka connector only loads data into Snowflake. The Spark connector's alternatives, per the pages: Snowpark (work stays inside Snowflake, all operations push down, including Snowflake UDFs) and Snowpark Connect for Spark.

[Back to contents](#contents)

### 1.5.2 Kafka connector: versions and architecture

**Release series**

| Series | Status | Notes |
|--------|--------|-------|
| 4.x | Generally available | Latest. Migration from 3.x and 2.x is manual |
| 3.x | Officially supported | Upgrade to v4 recommended |
| 2.x | Officially supported | Upgrade recommended |
| 1.x | Not supported | |

**Packages.** Confluent (zip from Confluent Hub or the Snowflake package repository, includes dependencies) and OSS Apache Kafka (fat JAR from Maven Central, needs **Bouncy Castle** JARs downloaded separately to use an encrypted private key). v4 is **not** a fully managed Confluent Cloud connector. On Confluent Cloud, install it as a custom plugin. The v3 overview page says a hosted version exists on Confluent Cloud.

**Connector classes**

| | Class |
|--|-------|
| v4 | `com.snowflake.kafka.connector.SnowflakeStreamingSinkConnector` |
| v3 and earlier | `com.snowflake.kafka.connector.SnowflakeSinkConnector` |

**Ingestion paths**

| | v3 Snowpipe mode (default) | v3 Snowpipe Streaming mode | v4 |
|--|----------------------------|-----------------------------|----|
| Set by | `snowflake.ingestion.method=SNOWPIPE` | `SNOWFLAKE_STREAMING` (connector 2.0.0 or later) | Always high-performance Snowpipe Streaming |
| Path | Files to an internal stage, then Snowpipe | Rows via the classic Streaming API | Rows via channels and a PIPE object |
| Delivery | Deduplication, no ordering guarantee | Exactly-once | Exactly-once and ordered |
| Latency | Higher (file-based) | Lower than Snowpipe | 5 to 10 seconds, up to 10 GB/s per table |
| Billing | Snowpipe serverless | Serverless compute and client connections (classic) | Flat price per ingested GB |

**Runtime requirements (both versions)**
- Supported packages: Apache Kafka 2.0.0 or higher in the connector table (tested 2.8.2, 3.7.2, and 4.1.1 on the v4 page) and Confluent (tested 6.2.15, 7.8.2, and 8.2.0 on the v4 page). Built for Kafka Connect API 3.9.0. Older Connect versions work. Newer ones are untested.
- The JDBC driver version must match the `snowflake-jdbc` version in the connector's `pom.xml`.
- At least **5 MB of RAM per Kafka partition** on each Connect node.
- Run Kafka Connect in the **same cloud provider and region** as the Snowflake account. This is a strong recommendation, not a requirement.
- Avro needs the Avro parser 1.8.2 or later. Avro with a schema registry needs Kafka Connect Avro Converter 5.0.0 or later. The schema registry feature is not in the OSS package.
- v4 uses a Rust Snowpipe Streaming SDK that allocates off-heap memory. Limit the JVM heap to about **50% of RAM** (for 8 GB, `-Xmx4g`).

[Back to contents](#contents)

### 1.5.3 Kafka connector v4: Snowflake setup and properties

**Privileges.** Give them directly to the connector role. They cannot be inherited through a role hierarchy. Snowflake recommends a separate user and role per Kafka instance.

| Object | Privilege | When |
|--------|-----------|------|
| Database | `USAGE` | Always |
| Schema | `USAGE` | Always |
| Schema | `CREATE TABLE` | The connector auto-creates tables |
| Schema | `CREATE PIPE` | The connector auto-creates pipes (default pipe mode) |
| Schema | `CREATE VIEW` | Recommended for future Error Table features |
| Pipe | `OPERATE` | User-defined pipes |
| Destination table | `INSERT` | Always |

v3 needed more: `CREATE STAGE`, plus `OWNERSHIP` on an existing target table, plus `READ` and `WRITE` on an existing internal stage (see 1.5.5).

**Authentication** (`snowflake.authenticator`)

| Value | Method | Since | Notes |
|-------|--------|-------|-------|
| `snowflake_jwt` (default) | Key pair | | RSA 2048-bit minimum. Public key set on the user with `ALTER USER ... SET RSA_PUBLIC_KEY` (`SECURITYADMIN` or higher) |
| `oauth` | Snowflake OAuth or External OAuth | 4.1.0 | `snowflake.oauth.client.id`, `.client.secret`, `.refresh.token`, `.token.endpoint`. An empty refresh token means the `client_credentials` grant. The token endpoint defaults to the account URL. No `snowflake.private.key` needed |
| `spcs` | Workload identity inside Snowpark Container Services | 4.2.0 | `snowflake.role.name` not required from 4.3.0. The service owner's role is used |

- Private key: key only, no header or footer, no line breaks. Set `snowflake.private.key.passphrase` **if and only if** the key is encrypted. Snowflake recommends externalizing secrets with a Kafka Connect `ConfigProvider` (AWS KMS, Azure Key Vault, HashiCorp Vault).
- v3 uses key pair. External OAuth in v3 works with Snowpipe Streaming mode only.

**Minimal v4 configuration** (distributed mode JSON, `config` block)

```json
{
  "connector.class": "com.snowflake.kafka.connector.SnowflakeStreamingSinkConnector",
  "topics": "my_topic",
  "snowflake.url.name": "https://myaccount.snowflakecomputing.com",
  "snowflake.user.name": "my_user",
  "snowflake.private.key": "<key>",
  "snowflake.database.name": "MY_DB",
  "snowflake.schema.name": "MY_SCHEMA",
  "snowflake.role.name": "MY_ROLE",
  "value.converter": "org.apache.kafka.connect.json.JsonConverter",
  "value.converter.schemas.enable": "false",
  "key.converter": "org.apache.kafka.connect.storage.StringConverter",
  "snowflake.streaming.validate.compatibility.with.classic": "false"
}
```

**Required properties:** `name` (unique across connectors, unquoted identifier), `connector.class`, `topics` **or** `topics.regex` (not both), `snowflake.url.name` (the account endpoint, not the discovered ingest host, a private endpoint DNS target or an IP), `snowflake.user.name`, `snowflake.role.name`, `snowflake.database.name`, `snowflake.schema.name`, `key.converter` (required by the platform, unused by the connector), `value.converter`. `header.converter` is required only for Avro with headers.

**Converters.** v4 supports community converters. With schematization on (the default), **`StringConverter` and `ByteArrayConverter` are not supported** as value converters. Use `JsonConverter`, `AvroConverter` or `ProtobufConverter`.

**Network and proxy**
- Complete the Snowpipe Streaming network prerequisites from **every** Connect worker. Private connectivity also needs private DNS for the **ingest hostname**, not only the account hostname. A common symptom is that table creation succeeds and streaming initialization fails with a DNS error on `get_pipe_info`.
- The Java side (JDBC) uses `jvm.proxy.*` or `KAFKA_OPTS`. The **native streaming SDK ignores those** and reads proxy environment variables set on the worker before the JVM starts. Restart the worker, not only the task, after changing them.

**Caching.** The connector caches table and pipe existence checks (`snowflake.cache.table.exists`, `snowflake.cache.pipe.exists`, **5 minutes by default**). For testing, set them to `false` so a table or pipe you just created is seen. Keep defaults in production.

[Back to contents](#contents)

### 1.5.4 Kafka connector v4: tables, pipes, validation and errors

**Table and pipe behavior**
- By default the connector **creates the table and a default pipe** named `{tableName}-STREAMING`. It maps the **first-level keys** of the record to columns by name, case-insensitively. Unmatched keys are ignored unless `ENABLE_SCHEMA_EVOLUTION` is on for the table.
- **User-defined pipe mode:** create a pipe with the **same name as the table**. The connector uses it. The pipe holds the transformation (casts, renames, masking, filters) as `COPY INTO ... FROM (SELECT ... FROM TABLE(DATA_SOURCE(TYPE => 'STREAMING')))`. `$1:RECORD_METADATA.<field>` is available in the pipe.
- **Default pipe mode:** no transformations. Record keys must match the column names.
- `RECORD_METADATA` fields include `topic`, `partition`, `offset`, `CreateTime`, `SnowflakeConnectorPushTime` (Snowpipe Streaming only), `key`, `schema_id` and `headers`. `snowflake.metadata.topic` and `snowflake.metadata.offset.and.partition` control some fields (default true).
- `snowflake.enable.schematization` defaults to **`true`** in v4 (columns per field). It was `false` in v3. With `false`, you get the two VARIANT columns `RECORD_CONTENT` and `RECORD_METADATA`, as in v3.

**Topic to table mapping**
- Without `snowflake.topic2table.map`, the table name derives from the topic name. See open items for conflicting text on case and sanitization.
- With `snowflake.topic2table.map` the format is `topic1:table1,topic2:table2`. Regex patterns are allowed and **cannot overlap**. Many topics can map to one table. Quote names to preserve case or use special characters. Table names need **at least 2 characters**.

**Validation modes** (`snowflake.validation`)

| | `server_side` (default) | `client_side` |
|--|-------------------------|---------------|
| Who validates | Snowflake backend, aligned with `COPY` and Snowpipe | The connector, before sending rows |
| Invalid records | Captured in the table's **Error Table** | Handled by `errors.tolerance`. Routed to a **DLQ** |
| DLQ use | Only for converter (deserialization) errors | For client-detected errors and converter errors |
| Pipe mode | Default pipe and user-defined pipe | **Default pipe only.** With a user-created pipe the connector fails with `ERROR_5030` |
| Throughput | Maximum (validation is offloaded) | Not maximum (validation runs in the connector) |
| New column types | Inferred from the JSON values. Registry precision can be lost. Binary becomes `VARCHAR` (base64). A string like `"2026-04-13"` can become `DATE` | From the converter's Connect schema when present. `FLOAT32`→`FLOAT`, `FLOAT64`→`DOUBLE`, bytes→`BINARY`, logical decimal→`VARCHAR`, struct and map→`VARIANT`, arrays→`ARRAY` |
| Iceberg | Supported, and required for `snowflake.autocreate.table.type=iceberg` | Only for a pre-created Iceberg v3 table with a compatible schema. Rejected with Iceberg auto-creation |

- Avro or Protobuf alone does **not** require client-side validation.
- Pre-create columns when you need exact types or precision in either mode.

**Schema evolution**
- Needs `ENABLE_SCHEMA_EVOLUTION=TRUE` on the table and the right privileges. Client-side evolution needs a direct `EVOLVE SCHEMA` or `OWNERSHIP` grant to the connector role. Choosing a mode alone does not turn evolution on.
- It can add top-level columns and drop `NOT NULL`. It does **not** widen existing column types and does not evolve fields inside structured columns.
- Existing column types are not corrected automatically. Avoid concurrent DDL on a table the connector is ingesting into.

**Errors**

| Property | Default | Meaning |
|----------|---------|---------|
| `errors.tolerance` | `none` | `none`: the task fails on the first error. `all`: continue, route to the DLQ if configured |
| `errors.deadletterqueue.topic.name` | empty (off) | Effective only with `client_side` validation **and** `errors.tolerance=all` |
| `errors.log.enable` | `false` | Log failed operation and record properties |
| `enable.task.fail.on.authorization.errors` | `false` | `true` fails the task on authorization errors. `false` retries |

- `errors.tolerance=all` with no DLQ **silently drops** invalid records (client-side). That risks data loss.
- With server-side validation and `none`, error detection is **asynchronous**, so a few records after the bad one can still be ingested before the task fails.

**Iceberg.** v4 loads Snowflake-managed Iceberg tables (v2 and v3). From 4.1.0, `snowflake.autocreate.table.type` is `snowflake` (default), `iceberg` or `none` (never auto-create, fail if the table is missing). `snowflake.iceberg.create.table.options` splices extra clauses into the auto-created table's `CREATE` statement. Do not include `CATALOG`, `ENABLE_SCHEMA_EVOLUTION` or `ERROR_LOGGING`.

[Back to contents](#contents)

### 1.5.5 Kafka connector v3 (classic)

**Objects the connector creates (Snowpipe mode)**

| Object | Count | Name pattern |
|--------|-------|--------------|
| Internal stage | One per topic | `SNOWFLAKE_KAFKA_CONNECTOR_..._STAGE_...`. Holds data files and **state** used to resume |
| Pipe | **One per topic partition** | `SNOWFLAKE_KAFKA_CONNECTOR_..._PIPE_...` |
| Table | One per topic, unless mapped | Topic name uppercased |

If the stage is dropped, the connector cannot resume where it left off.

**Table names without a mapping:** lowercase becomes uppercase. A first character that is not a letter or underscore gets an underscore prepended. Illegal characters become underscores. If two topics collapse to the same name (for example `numbers+x` and `numbers-x`), the connector adds a suffix.

**Flow (Snowpipe mode)**
1. The connector buffers messages per partition. A threshold (time, size or count) writes a file to the internal stage.
2. The connector calls Snowpipe to ingest it. A Snowflake-provided warehouse loads it through the partition's pipe.
3. The connector polls the `insertReport` API for **one hour**, deletes the file when loaded, and **moves it to the table stage** if the status was not found in that hour or the load failed.
4. A record Snowpipe cannot parse (for example malformed JSON or Avro) is not loaded. It goes to the table stage.

**Privileges (v3):** `USAGE` on the database, `USAGE`, `CREATE TABLE`, `CREATE STAGE`, `CREATE PIPE` on the schema (the `CREATE` privileges can be revoked once the objects exist), `OWNERSHIP` on an existing target table, `READ` and `WRITE` on an existing internal stage (not recommended). If the connector creates the table or stage, the user's **default role** owns it. Set the connector role as the user's default role.

**Buffer properties and defaults differ by ingestion method**

| Property | Snowpipe mode | Snowpipe Streaming mode |
|----------|---------------|--------------------------|
| `buffer.flush.time` | **120** s | **10** s (minimum 1) |
| `buffer.count.records` | 10,000 | 10,000 |
| `buffer.size.bytes` | 5,000,000 (5 MB) | 20,000,000 (20 MB) |

Records are compressed when written, so buffer size can exceed the file size.

**v3 Snowpipe Streaming mode specifics**
- `snowflake.ingestion.method=SNOWPIPE_STREAMING`, connector 2.0.0 or later. Snowflake converters are **not supported**. Use community converters.
- `snowflake.streaming.max.client.lag`: 1 to 600 s. Default 30 s (3.1.1 and later), 120 s (3.0.0 to 3.1.0), 1 s otherwise.
- `snowflake.streaming.enable.single.buffer`: default `true` from 3.0.0. When `true`, `buffer.flush.time` and `buffer.count.records` stop mattering.
- `enable.streaming.client.optimization` (2.1.2 and later, default `true`): one client for many partitions. Disable for high throughput (the page's example is about 50 MB/s per connector).
- **Exactly-once.** One channel per partition. Two offsets: the Kafka consumer offset and the Snowflake **offset token**. On open or reopen, the connector takes the **latest committed offset token as the source of truth** and resets the consumer offset. Only if the token is NULL does it trust Kafka's offset. A row is accepted only if its offset is the last processed offset plus one.
- **NULL records** (not tombstones) are dropped and leave missing offsets, which can break the connector. Use tombstone records.
- `behavior.on.null.values` (`DEFAULT` inserts an empty JSON string, `IGNORE` skips). Snowpipe mode: 1.5.5 and later. Streaming mode: 2.1.0 and later. Snowpipe mode uses Snowflake converters for this property. For Kafka community converters use `transforms` with `io.confluent.connect.transforms.TombstoneHandler`.
- Schematization: set `snowflake.ingestion.method` and `snowflake.enable.schematization` for schema detection and evolution.
- Channel name format: V1 `[topic]_[partition]` (all versions except 2.1.0 and 2.1.1). V2 `[connectorName]_[topic]_[partition]` (2.1.0 and 2.1.1 only). Relevant when migrating offsets.

**Converters (v3 Snowpipe mode)**

| Data | `value.converter` |
|------|-------------------|
| JSON | `com.snowflake.kafka.connector.records.SnowflakeJsonConverter` |
| Avro with Schema Registry | `com.snowflake.kafka.connector.records.SnowflakeAvroConverter` |
| Avro with embedded schema | `...SnowflakeAvroConverterWithoutSchemaRegistry` |
| Plain text | `org.apache.kafka.connect.storage.StringConverter` |

**Other v3 properties:** `tasks.max` (Snowflake recommends the total number of Kafka partitions, not above the CPU core count. More tasks raise memory use and rebalances). `snowflake.topic2table.map`. `snowflake.metadata.createtime`, `.topic`, `.offset.and.partition`, `.all` (default true, `false` omits fields). `snowflake.jdbc.map`. `jvm.proxy.*`. `snowflake.snowpipe.v2CleanerEnabled` and `snowflake.snowpipe.v2CleanerIntervalSeconds` (default 61 s, raise it to about 30 minutes for low volume, to save cost).

**Fault tolerance limits (v3)**
- Kafka's default retention is 7 days. If the connector is offline longer, expired records are lost.
- Changes or deletes of messages already in Kafka may not reach the table.
- Instances do not communicate. Two instances on the same topic or partition insert duplicates.
- Snowpipe mode gives no row-order guarantee.

**Managing and dropping:** find stages, pipes and tables with `SHOW` as the owning role (the user's default role), then `DROP`.

[Back to contents](#contents)

### 1.5.6 Kafka connector: migration and troubleshooting

**Migrating v3 to v4**
- v4 is a rewrite, **not a drop-in**. New connector class, different defaults, removed properties. Create a new configuration by hand.
- Pricing changes from serverless compute and file notifications to per-GB throughput pricing.
- Keep the **same connector name**. The name determines the Kafka consumer group (`connect-<name>`) that holds committed offsets. Kafka Connect allows one connector per name, even stopped, so a second create returns `409 Conflict`. Stop or delete the v3 connector, wait until the consumer group state is `Empty`, then start v4 with the same name.
- Deleting a connector does not delete its consumer group offsets. Raise `task.shutdown.graceful.timeout.ms` (a **worker** setting, 5 s by default) before migrating, or v4 reloads records the v3 task never committed.
- Migration from Snowpipe mode or Snowpipe Streaming mode works without gaps or duplicates if configured correctly. The switchover must happen within `offsets.retention.minutes` (default 7 days).
- Compatibility validator, on by default: `snowflake.streaming.validate.compatibility.with.classic=true`. At startup it requires these to be set explicitly: `snowflake.validation=client_side`, `snowflake.compatibility.enable.column.identifier.normalization=true`, `snowflake.compatibility.enable.autogenerated.table.name.sanitization=true`, `snowflake.enable.schematization` (default changed), `snowflake.streaming.classic.offset.migration`, and `...offset.migration.include.connector.name` (when migration is `strict` or `best_effort`). New installations set it to `false`.
- A bad setting shows as `FAILED` in `GET /connectors/<name>/status`, because v4 checks at start, not at submit.

| `snowflake.streaming.classic.offset.migration` | Behavior |
|----------------------------------------------|----------|
| `skip` (default) | No SSv1 offset migration. Use the Kafka consumer group offset. Use for v3 **Snowpipe** mode |
| `strict` | Resume from the v3 Streaming channel's committed offset. Fail if the channel is missing |
| `best_effort` | Try the channel. Fall back to the consumer group offset |

Before migrating, keep `snowflake.metadata.topic`, `.offset.and.partition` and `.createtime` enabled in v3 (they are by default), so `RECORD_METADATA` supports deduplication.

**Troubleshooting v3 (Snowpipe mode)**

1. Check the load history: `COPY_HISTORY` for the target table. `STATUS` shows loaded, partially loaded or failed. `FIRST_ERROR_MESSAGE` shows only the first error per file.
2. Look in the **table stage**: `LIST @db.schema.%mytable;`. Two file name patterns:
   - **Raw bytes** (`.../offset_<n>.gz` style): the record could not be converted from bytes to Avro, JSON or Protobuf. A dropped character from a network failure is a common cause. Fix: **resend the record** as a new record.
   - **Source format** (Avro, JSON or Protobuf): Snowpipe could not load it. Fix the file, then reload.
3. To see all errors in a failed file: `GET` the files from the table stage, `PUT` them to a named internal stage, run `COPY INTO ... VALIDATION_MODE = 'RETURN_ALL_ERRORS'` into a temporary table, fix the files, `PUT ... OVERWRITE = TRUE` them back, then `COPY INTO` the table with `PURGE = TRUE`.
4. If `COPY_HISTORY` has nothing, read the Kafka Connect log. Search for `ERROR` and `com.snowflake.kafka.connector`. Categories: configuration error, read error (Kafka not running, message not sent or expired), stage write error (privileges, out of space, dropped stage, unexpected files), table write error (privileges).
5. If the log is clean, check Kafka Connect itself.
- Set up **Snowpipe error notifications** for file errors.
- **Duplicate rows with the same partition and offset** (v1.4 and later): the load exceeded the default 300,000 ms (300 s) execution timeout, shown as `CommitFailedException ... group has already rebalanced`. Set `consumer.max.poll.interval.ms` to 900000 or `consumer.max.poll.records` to 50 in the Connect worker configuration.

**Troubleshooting v4**

| Symptom | Cause and action |
|---------|------------------|
| `rows_error_count` rising | With `errors.tolerance=none` the task fails with `ERROR_5030`. With `all` it continues and logs. Check the Error Table. Find gaps with `RECORD_METADATA` offsets. Server-side detection is asynchronous, so some extra rows load first |
| `ERROR_5030` | Type mismatch, a **user-created pipe with `client_side` validation**, or a schema change that cannot evolve. Switch to `server_side` or remove the pipe |
| Table created, streaming fails | Ingest hostname DNS from the worker. Configure private DNS |
| Auth failure (key pair) | Valid base64 PKCS#8 key with no header, footer or line breaks. Passphrase only if encrypted. Role privileges |
| SPCS auth error `395090` ("Please use OAuth") | The service spec is missing `capabilities.securityContext.enableCustomCredentials: true`. OAuth is not the fix |
| "Table does not exist" under SPCS auth | The service owner's role is used and lacks access. `snowflake.role.name` is overridden |
| Unsupported converter | `StringConverter` or `ByteArrayConverter` with schematization on |
| Startup failures about config | The compatibility validator. Set `...validate.compatibility.with.classic=false` for new installs |
| Lag growing | Raise `tasks.max` toward the partition count. About 2 tasks per CPU core is the page's optimum. Check `backpressure-rewind-count`. Keep heap near 50% of RAM |
| `channel-recovery-count` rising | Schema change conflicting with the cached schema, permission change, or unstable network |
| `sdk-client-count` above the table count | Possible SDK client leak. One client per distinct table. Contact Support |
| `409 Conflict` creating the connector | The v3 connector still exists under that name. Other 409s during a rebalance are temporary |

[Back to contents](#contents)

### 1.5.7 Spark connector

**Versions and packaging**

| | 3.x | 2.x |
|--|-----|-----|
| Spark versions | 3.2, 3.3, 3.4, 3.5, 4.0, 4.1 | 3.2, 3.3, 3.4 |
| Artifact | One per Scala version, covers most Spark versions: `net.snowflake:spark-snowflake_2.13:3.1.1` | One per Spark version: `net.snowflake:spark-snowflake_2.12:2.16.0-spark_3.4` |

- Scala 2.12 or 2.13. Distributed from Maven Central. Compiled packages are not on GitHub. The connector runs as a Spark plugin (`spark-snowflake`).
- Data source name: `net.snowflake.spark.snowflake`. From 2.10.0, `snowflake` also works.
- You need the **Snowflake JDBC driver** version the connector declares in its POM, plus the connector JAR. With `spark-shell` pass `--packages net.snowflake:snowflake-jdbc:<v>,net.snowflake:spark-snowflake_2.12:<v>`.
- The role needs **`USAGE` and `CREATE STAGE`** on the schema of the table it reads or writes.
- Databricks and Qubole embed the connector. You do not install it there.
- To enforce row access and masking policies on **Iceberg tables** read from Spark through Horizon Catalog, use connector **3.1.6 or later**.
- Optional: verify the package signature with GPG (`.jar.asc`). Snowflake rotates the key periodically.

**Data transfer**

| | Internal (default recommendation) | External |
|--|-----------------------------------|----------|
| Location | A temporary internal stage the connector creates at session start and drops at session end | A bucket or container you create (S3, Azure Blob) |
| Minimum version | AWS 2.2.0, Azure 2.4.0, GCP 2.7.0 | Required for 2.1.x or lower |
| Use when | Default | A transfer likely to take **36 hours or more**. Internal uses temporary credentials that **expire after 36 hours** |
| Cleanup | Automatic | **Not automatic.** Set `purge=on` (Spark to Snowflake only), delete manually, or use a bucket lifecycle policy |

- `columnmapping` style mapping works for internal transfer only (see open items).

**Query pushdown** (2.1.0 and later)
- On by default (`autopushdown`). The connector captures the Spark logical plan and translates it to SQL that runs in Snowflake. Supported: aggregates (`Count`, `Sum`, `Avg`, `Max`, `Min`, variance and stddev), boolean operators, joins, filters, projections, sorts, `Limit`, `Union`, window functions (`Rank`, `DenseRank`, `RowNumber`), many string, math and date functions.
- **Spark UDFs cannot be pushed down.** When pushdown fails the connector falls back to Spark and runs the operation there.
- If the connector is plugged into a different Spark version than it targets, `autopushdown` is **off** even if you set it on.
- Disable per session with `SnowflakeConnectorUtils.disablePushdownSession(spark)` plus `.option("autopushdown","off")`. Use `Utils.getLastSelect()` to see the SQL issued.

**Reading and writing**
- Read with `format("net.snowflake.spark.snowflake")`, options, and either `dbtable` (all columns) or `query` (a `SELECT`). DataFrames support `SELECT` only, no `SHOW`, `DESC` or DML.
- Write with `dbtable` and a save mode. `SaveMode.Overwrite` replaces the table **and its schema** unless `truncate_table=on`, which truncates and keeps the schema. A `StringType` column that holds geospatial data creates `VARCHAR`. Keep `GEOGRAPHY` by writing to an existing table with `truncate_table=on`.
- `Utils.runQuery(sfOptions, "<DDL or DML>")` returns only `TRUE` or `FALSE`. It is not for `SELECT` or `SHOW`.
- JSON to a `VARIANT`: create the table first, then write with `SaveMode.Append`. `Overwrite` creates a `VARCHAR` column.
- For `DataFrame.show(n)`, sort then limit first, or the rows shown vary between runs.

**Connection options**

| Option | Meaning |
|--------|---------|
| `sfUrl` | `account_identifier.snowflakecomputing.com` |
| `sfUser` | Login name |
| One of: `sfPassword`, `pem_private_key`, `sfAuthenticator` | Password, key pair, or `oauth` (with `sfToken`) or `WORKLOAD_IDENTITY` (recommended, with `sfWorkloadIdentityProvider` = `AWS`, `AZURE`, `GCP` or `OIDC`) |
| `sfDatabase`, `sfSchema` | Required session context |
| `sfWarehouse`, `sfRole` | Optional context |
| `use_proxy`, `proxy_host`, `proxy_port`, `proxy_user`, `proxy_password`, `non_proxy_hosts` | Proxy. `proxy_protocol` (2.11.1 and later), user, password and `non_proxy_hosts` are AWS only |

**Behavior options and defaults**

| Option | Default | Effect |
|--------|---------|--------|
| `usestagingtable` | `on` | Load into a temporary table, then swap. On failure the target keeps its old data. Needs create-table privilege. `off` loads directly |
| `continue_on_error` | `off` | `on` skips bad rows. Not recommended, causes missing data |
| `truncate_columns` | `on` | `COPY` truncates over-length strings. `off` errors |
| `truncate_table` | `off` | `on` keeps the target schema on overwrite |
| `column_mapping` | `order` | `name` maps by column name, case-insensitively |
| `column_mismatch_behavior` | `error` | With `name` mapping, `ignore` drops extra DataFrame columns and fills missing table columns with NULL. It still errors if **no** names match |
| `columnmap` | null | An explicit map, `"Map(col_2 -> col_b)"`. Spark to Snowflake only |
| `keep_column_case` | `off` | Writes uppercase column names unless quoted. Reads quote names with other characters |
| `sfCompress` | `on` | Compress transfer data |
| `s3MaxFileSize` | 10 MB | File size from Snowflake to Spark |
| `purge` | `off` | Delete external-transfer temp files (Spark to Snowflake only) |
| `preactions`, `postactions` | none | Semicolon-separated SQL. `%s` becomes the table name |
| `sfTimezone` | `spark` | Also `snowflake`, `sf_default`, or a named zone |

**Time zones.** Spark has one timestamp type, close to `TIMESTAMP_LTZ`. The connector's default Snowflake mapping is `TIMESTAMP_NTZ`. To avoid shifted times, follow at least one: use only `TIMESTAMP_LTZ` (set the timestamp type mapping parameter), or set Spark and Snowflake both to UTC. The page's example: a Spark zone of New York, a Snowflake zone of Warsaw, and an NTZ value of `12:00:00` reloaded as LTZ becomes `18:00:00`.

**Type mapping highlights**

| Direction | Mapping |
|-----------|---------|
| Spark to Snowflake | `ArrayType`, `MapType`, `StructType` → `VARIANT`. `Byte`, `Short`, `Int`, `Long` → `INTEGER`. `StringType` → `VARCHAR`. `TimestampType` → `TIMESTAMP`. **`BinaryType` not supported** |
| Snowflake to Spark | `ARRAY`, `OBJECT`, `VARIANT` → `StringType`. `BIGINT`, `INTEGER` → `DecimalType(38,0)`. `FLOAT` → `DoubleType`. `TIME` → `StringType` (2.4.14 and later). **`BINARY` not supported**. `GEOGRAPHY` and `GEOMETRY` → `StringType` for GeoJSON, WKT, EWKT output formats. WKB and EWKB are returned as binary and unsupported |

[Back to contents](#contents)

### 1.5.8 Python connector

**Install and versions**
- `pip install snowflake-connector-python`. Version **5.x** is built on the Universal Core, requires **Python 3.11 or later**, and keeps the `snowflake.connector` module and PEP 249 `Connection` and `Cursor`.
- **Snowpark for Python, Snowflake ML, Snowflake SQLAlchemy and Snowflake CLI still need a connector before 5.0.** Upgrading a shared environment can break them. Pin `snowflake-connector-python>=4,<5` when needed.
- Pandas support: `pip install "snowflake-connector-python[pandas]"` (quotes needed). The extra installs PyArrow. Do not install another PyArrow version.
- A **FIPS** build compiles from the source distribution: `SNOWFLAKE_FIPS=1 python -m pip install --no-binary snowflake-connector-python snowflake-connector-python`. `snowflake.connector.get_fips_status()` reports it.
- Removed or changed in 5.0: `converter_class` raises `ProgrammingError`. OCSP is not used. Certificate revocation uses CRLs through `crl_check_mode` (`DISABLED` default, `ADVISORY`, `ENABLED`). `private_key_file_pwd` is renamed `private_key_password` (the old name works with a `DeprecationWarning`). `network_timeout` and `socket_timeout` are deprecated.

**Connecting**
- `user` is the user's `LOGIN_NAME`, not `NAME`, when they differ. `account` is the account identifier **without** `snowflakecomputing.com`.
- `connections.toml` lookup order: `~/.snowflake/connections.toml` if that directory exists (override with `SNOWFLAKE_HOME`), otherwise `~/.config/snowflake/` (Linux), `%USERPROFILE%\AppData\Local\snowflake\` (Windows), `~/Library/Application Support/snowflake/` (macOS). Use `connect(connection_name="x")`. Other arguments override the file values.
- The default connection, lowest to highest precedence: a connection named `default`, `default_connection_name` in `config.toml`, the `SNOWFLAKE_DEFAULT_CONNECTION_NAME` environment variable. With a default connection you **cannot override** parameters such as `username`, `database` or `schema`.
- Session parameters: `session_parameters={'QUERY_TAG': ...}` at connect, `ALTER SESSION SET`, or per statement with `execute(..., _statement_params={...})` for `TIMEZONE` and `QUERY_TAG`. You cannot set `SEARCH_PATH` through connect.

| Method | Parameters |
|--------|------------|
| Password | `user`, `password`, `account`, and context |
| Key pair | `authenticator='SNOWFLAKE_JWT'`, `private_key_file`, `private_key_password` (or `private_key`) |
| OAuth token | `authenticator='oauth'`, `token` |
| OAuth authorization code | `authenticator='OAUTH_AUTHORIZATION_CODE'`, `oauth_client_id`, `oauth_client_secret`, `oauth_authorization_url`, `oauth_token_request_url`, `oauth_scope`, `oauth_redirect_uri`. PKCE on unless `oauth_disable_pkce` |
| OAuth client credentials | `authenticator='OAUTH_CLIENT_CREDENTIALS'`, client ID and secret, token request URL, scope |
| Workload identity | `authenticator='WORKLOAD_IDENTITY'`, `workload_identity_provider` = `AWS`, `AZURE`, `GCP` or `OIDC` (OIDC needs `token` or `token_file_path`) |
| Programmatic access token | `token` or `token_file_path`. The feature must be enabled on the account |
| MFA | `authenticator='username_password_mfa'`, `passcode`, or `passcode_in_password=True`. Token caching through `client_store_temporary_credential` (default `True`, also needs server-side enablement) |

**Timeouts and retries.** `login_timeout` 120 s. `query_timeout` 0 (none). `request_timeout` 120 s. `connect_timeout` and `retry_timeout` have no default cap. Backoff: `retry_backoff_base_ms` 250, `retry_backoff_factor` 2, `retry_backoff_cap_ms` 16000, `retry_backoff_jitter` `decorrelated`.

**Running SQL**

| Need | Call | Notes |
|------|------|-------|
| One statement | `cursor.execute(sql, params)` | |
| Same parameterized statement, many rows | `cursor.executemany(sql, seq)` | **One** statement only. Not for several statements joined by semicolons |
| Several statements in one string | `connection.execute_string(text)` | **No bind parameters.** Injection risk if you build the string from user input |
| A script from a file or stream | `connection.execute_stream(stream)` | A generator of cursors. Set `remove_comments=True` if the stream ends in comment lines |
| Do not wait | `cursor.execute_async(sql)` | No `PUT` or `GET`. Poll with `conn.get_query_status(sfqid)` (or `get_query_status_throw_if_error`). Fetch with `cursor.get_results_from_sfqid(id)` |
| Cancel | `SELECT SYSTEM$CANCEL_QUERY('<query id>')` | |

- The query ID is `cursor.sfqid`.
- **Async queries are not guaranteed to return ordered results**, even with `ORDER BY`. Never run `BEGIN`, `COMMIT` or `ROLLBACK` in parallel with other statements.
- `ABORT_DETACHED_QUERY` (default `FALSE`): queries keep running after connectivity is lost. `TRUE` aborts them 5 minutes after loss. Calling `cursor.query_result(queryId)` prevents the abort.
- `connection.close()` logs the session out and cancels its queries unless async queries are running. `server_session_keep_alive=True` stops the logout and can leave billable queries running up to `STATEMENT_TIMEOUT_IN_SECONDS`. Put long async work on a separate connection.

**Binding**

| Style | Placeholder | Where bound |
|-------|-------------|-------------|
| `pyformat` (default), `format` | `%(name)s`, `%s` | **Client** |
| `qmark` | `?` | **Server** |
| `numeric` | `:1`, `:2` | **Server**. A value used twice is sent once |

- Set with `snowflake.connector.paramstyle='qmark'` or `paramstyle` in `connect()`.
- With client binding, escape a literal `%` as `%%`. The API page says there is no significant performance difference between styles.
- A list binds into `IN (%s)` for the client styles.
- Never build SQL with Python `%`, `.format()` or f-strings.
- With server binding, `executemany` for an `INSERT` streams values above a threshold to a temporary stage. The session needs a **current database and schema**, or `CREATE TEMPORARY STAGE SYSTEM$BIND` fails.

**Transactions.** `autocommit` is on by default and honors the `AUTOCOMMIT` parameter. With `autocommit=False` the `with connect()` context manager commits on success and rolls back on an exception. Otherwise use `BEGIN`, `COMMIT`, `ROLLBACK`.

**Loading data**
- Files: `PUT file:///tmp/data/file* @%testtable`, then `COPY INTO`. External data: `COPY INTO ... FROM s3://... STORAGE_INTEGRATION = myint`.
- Batch rows: `executemany` with server binding. Avoid individual `INSERT` statements for bulk data.
- DataFrames: **`write_pandas(conn, df, 'table')`** writes Parquet files, `PUT`s them to a temporary stage, and runs `COPY INTO`. It returns `(success, num_chunks, num_rows, output)`.

| `write_pandas` parameter | Default |
|--------------------------|---------|
| `chunk_size` | All rows in one chunk |
| `compression` | `gzip` (or `snappy` for speed) |
| `on_error` | `ABORT_STATEMENT` |
| `quote_identifiers` | `True`. `False` rejects invalid unquoted names |
| `bulk_upload_chunks` | `False` (chunks are saved, uploaded and deleted one by one) |
| `table_type` | `''` (permanent). Also `temp`, `temporary`, `transient` |
| `database`, `schema` | Session's. Giving `database` requires `schema` |

- `DataFrame.to_sql(..., method=pd_writer)` also works. When DataFrame column names are all lowercase, quote them or the connector raises `ProgrammingError`. `snowflake-sqlalchemy` does not quote lowercase names when creating a table.

**Fetching data**
- `fetchone`, `fetchmany`, `fetchall`, and iteration over the cursor. `DictCursor` returns rows keyed by column name.
- `fetch_pandas_all()` and `fetch_pandas_batches()` return DataFrames. `fetch_arrow_all()` and `fetch_arrow_batches()` return PyArrow tables.
- **`cursor.get_result_batches()`** returns `ResultBatch` objects (`rowcount`, `compressed_size`, `uncompressed_size`, `to_arrow()`, `to_pandas()`). Hand different batches to different workers to fetch in parallel. It returns `None` if the query has not finished.
- Pandas mapping: a zero-scale numeric becomes an integer type, but **NULLs turn it into `float64`**. Scale above zero becomes `float64`. `DECIMAL` becomes `decimal`. `VARIANT` and `BINARY` become `str`. `DATE` becomes `datetime.date` objects. Overflow raises an exception.
- `unsafe_file_write` (3.14.0 and later, default `False`) sets file permissions for `GET` downloads to 600. `True` gives 644.

**Other:** use the connector's `VECTOR` type support (3.6.0 and later). Close connections in `finally` or a `with` block, because unclosed connections can exhaust resources. Run connectivity diagnostics with `enable_connection_diag=True`.

[Back to contents](#contents)

### 1.5.9 Native connectors

"Native connectors" are Snowflake Native Apps that ingest from an external system, installed from the Snowflake Marketplace. The Openflow connectors in 1.4.24 are the stated next-generation replacement for several of them.

**Status of each connector (as stated on its page)**

| Connector | Status |
|-----------|--------|
| MySQL | Preview. GA is not on the roadmap. The Openflow Connector for MySQL is the successor |
| PostgreSQL | Preview. GA is not on the roadmap. The Openflow Connector for PostgreSQL is the successor |
| SharePoint | Preview. GA is not on the roadmap. The Openflow Connector for SharePoint is the successor |
| ServiceNow | Generally available |
| Google Analytics Aggregate Data and Raw Data | No status stated on the pages read |
| Microsoft Power Platform | A connection from Power Apps, Power Automate, Copilot Studio and Logic Apps **into** Snowflake |

**Database connectors (MySQL, PostgreSQL): components**
- A **Native App** in your account and an **Agent**, a Docker image that runs **inside your network** and pushes data to Snowflake. This is the push-based pattern for sources behind a firewall.
- **Exactly one agent instance** must run at all times. One agent connects to one Native App instance and vice versa. For separate networks, install more app instances (a private-preview feature), each with its own agent.
- Keep the agent version equal to the app version. Each app `x.y.z` supports agents with the same major version and a minor version no higher. Each `x.0.0` app also supports all `(x-1).Y.Z` agents.
- Agent resources (MySQL page): at least **6 GB RAM**, **4 CPUs** optimal (more does not help). Direct reachability to every source database (MySQL port 3306) and to Snowflake hostnames. The agent needs the **MariaDB JDBC driver 3.4.1**, which you supply (licensing). Private links are supported (AWS PrivateLink, Azure Private Link, Google Private Service Connect).
- The MySQL page says to install and configure as **`ACCOUNTADMIN`** (other roles are not supported). An **event table** must be configured (the connector logs to it). `AUTOCOMMIT` must be true. Government regions are not supported. Use a schema different from other native apps.
- Application roles: `ADMIN` (view config and run procedures), `AGENT` (used by the agent, not manually), `VIEWER` (basic config), `DATA_READER` (read replicated data). To read data a user needs `USAGE` on the destination database and schema and `SELECT` on the table.

**Objects and lifecycle**

| Object | Role |
|--------|------|
| Data source | The database being replicated. One connector instance can use many if the agent can reach them |
| Source table | A table tracked for changes |
| Journal | A connector-owned table with every insert, update and delete for a source table |
| Destination table | Where data lands. Adds `_SNOWFLAKE_INSERTED_AT`, `_SNOWFLAKE_UPDATED_AT`, `_SNOWFLAKE_DELETED`. **Change tracking is pre-enabled** so you can create streams. The app keeps `OWNERSHIP` |

Per-table lifecycle:
1. **Schema introspection:** discover columns and validate against Snowflake and connector limits. A failure ends the cycle.
2. **Snapshot load:** the agent runs one `SELECT` on the source and streams rows through **Snowpipe Streaming** into a snapshot table. A task then runs `INSERT INTO ... SELECT` into the destination, and the snapshot table is dropped. It can be heavy on the source and slow for large tables.
3. **Incremental load:** the agent reads the source changelog (CDC) into the journal. A **merge task** merges journal rows into the destination (insert, update, soft-delete).
- A table that **fails permanently** stays stopped until the cause is fixed and you **remove the table from replication and add it again**. That repeats the snapshot.
- A snapshot is also repeated if replication was paused and the source changelog no longer holds the entries since the last replication.

**Replication mode and warehouses**
- Mode is set **per data source**, not per table. **Continuous** (default) replicates as fast as possible. **Scheduled** batches on a fixed schedule, for data that changes rarely or to cut credits. Continuous mode never reports incremental load as completed.
- Two warehouses: an **Operational warehouse** (command and control, XS is optimal, **cannot be shared** between instances or other workloads) and a **Compute warehouse** (merge tasks, may be shared, but sharing can delay data).
- The operational warehouse **never suspends in continuous mode**, so it consumes credits even with no changes. To allow auto-suspend, switch **all** data sources to scheduled.

**MySQL requirements and limits**
- MySQL 8.0 or 8.4 (`binlog_row_metadata=full` exists from 8). Supported: standard, AWS RDS, Amazon Aurora (version 3), GCP Cloud SQL. Azure Database for MySQL is listed as not supported.
- Server settings: `log_bin=on`, `binlog_format=row`, `binlog_row_metadata=full`, `binlog_row_image=full`, `binlog_row_value_options` empty, `binlog_expire_logs_seconds` at least a few hours (longer than the schedule when using scheduled replication).
- The agent user needs `REPLICATION SLAVE`, `REPLICATION CLIENT` and `SELECT`. Only **username and password** authentication is supported.
- **Tables without a primary key are not supported.**
- A transaction over about **4 GB** marks the table permanently failed and needs a snapshot reload.
- The binlog holds changes for **all** tables. Very large events (for example `BLOB` updates) on tables not replicated can exhaust agent memory.
- Unsupported identifiers: the `"` character, schema `INFORMATION_SCHEMA`, column names `_SNOWFLAKE_INSERTED_AT`, `_SNOWFLAKE_UPDATED_AT`, `_SNOWFLAKE_DELETED`, and names ending in `__SNOWFLAKE_DELETED`.
- Values that exceed Snowflake limits (for example `BINARY` over 64 MB, `VARCHAR` over 128 MB, a year above 9999) stop replication of that table.

| Source schema change | Result |
|----------------------|--------|
| Add column | Supported. A name cannot reuse a previously dropped or renamed column's name |
| Drop column | Supported as a **soft delete**. The column is renamed `<name>__SNOWFLAKE_DELETED`. New rows get NULL |
| Rename column | Treated as drop plus add. Old rows keep values in the `__SNOWFLAKE_DELETED` column |
| Change type | Only if both types map to the same Snowflake type. Otherwise replication **fails permanently** |
| Change numeric precision or scale | **Fails permanently** |
| Change primary key | **Fails permanently** |

**Cost governance.** Use a **dedicated** operational and compute warehouse pair and put **resource monitors** on them. A quota set too low can stop the connector before all data arrives. Use a separate account or database and object tags to track cost. Storage includes Fail-safe, which grows with updates and reloads and stabilizes about **7 to 10 days** after setup.

**Support and logs.** Native app logs go to your event table and are shared with Snowflake by default. Agent logs must be extracted and attached to a case manually.

**Other native connectors**

| Connector | Key facts |
|-----------|-----------|
| ServiceNow | Uses the ServiceNow `v2` Table API. Initial load plus incremental pulls on a schedule you control. Needs a `sys_id` column. Views and archived records are not ingested. Does not work with IP-restricted instances or ones behind a VPN. Destination schemas cannot use **managed access**. Needs `AUTOCOMMIT` and a warehouse with `AUTO_RESUME` (serverless is not supported) |
| Google Analytics Aggregate Data | GA4 report data from the Reporting API. Report definition must include the `date` dimension. **At most 40 reports.** GA data can change up to 72 hours after recording. Needs `AUTOCOMMIT`, `TIMESTAMP_INPUT_FORMAT=AUTO`, and a warehouse `STATEMENT_TIMEOUT_IN_SECONDS` of at least 4 hours if set. The connector must own the destination tables. No future ownership grants and no managed schema. Not on trial accounts |
| Google Analytics Raw Data | Event-level GA4 data. Needs a manual link from the GA4 property to a GCP project (BigQuery export). The connector reads through the BigQuery Storage API. Not on trial accounts. The app owns tables and views in the destination schema. No future ownership grants and no managed schema. Custom date formats and emoji in the app name are not supported. Switching the export to another project is not supported |
| SharePoint | Ingests files and user permissions. Works with Cortex Search and respects SharePoint access controls through Cortex Search filters |

**Native SDK for Connectors.** A set of templates and libraries to build your own native connector. It currently supports only the **pull-based** pattern, where the app uses external access to fetch from the source. The **push-based** pattern uses an agent behind the customer's firewall (as the MySQL and PostgreSQL connectors do).

[Back to contents](#contents)

### 1.5.10 Quick-reference for 1.5

| Question | Answer |
|----------|--------|
| Kafka to Snowflake, lowest latency | Connector v4 (Snowpipe Streaming high-performance), 5 to 10 s |
| v4 connector class | `SnowflakeStreamingSinkConnector` |
| v3 backend setting | `snowflake.ingestion.method` = `SNOWPIPE` (default) or `SNOWPIPE_STREAMING` |
| v3 Snowpipe vs Streaming buffer defaults | 120 s and 5 MB, versus 10 s and 20 MB. Count 10,000 for both |
| v4 table shape by default | Schematized columns. `RECORD_CONTENT` and `RECORD_METADATA` only with schematization off |
| v4 default pipe name | `{tableName}-STREAMING` |
| User-defined pipe in v4 | Same name as the table. Needs server-side validation |
| `ERROR_5030` | User-created pipe with client-side validation, or a data error with tolerance `none` |
| Where do v3 failed files go | The target table's stage (`@db.schema.%table`) |
| Same partition and offset duplicated (v3) | Poll timeout. Raise `consumer.max.poll.interval.ms` to 900000 or lower `consumer.max.poll.records` to 50 |
| Replace v3 with v4 | Same connector name, wait for the consumer group to be `Empty`, set offset migration (`skip` for Snowpipe mode) |
| Spark transfer over 36 hours | External transfer. Temporary internal credentials expire at 36 hours |
| Spark UDF | Cannot be pushed down |
| Spark overwrite keeps schema | `truncate_table=on` |
| Spark write fails midway, target intact | `usestagingtable=on` (default) |
| Spark timestamps shift | Use `TIMESTAMP_LTZ` only, or UTC on both sides |
| Python placeholders on the server | `qmark` (`?`) or `numeric` (`:1`) |
| Python many statements, one call | `execute_string` (no binds) or `execute_stream` |
| Python batch insert | `executemany` with server binding. Needs a current database and schema |
| Python DataFrame load | `write_pandas`. It stages Parquet and runs `COPY` |
| Python parallel fetch | `get_result_batches()` |
| Python 5.x with Snowpark | Pin the connector below 5.0 |
| MySQL or PostgreSQL native connector fails on one table | Remove the table from replication and add it again |
| Native connector table without a primary key | Not supported (MySQL) |
| Cut credits for a native DB connector | Scheduled mode on all data sources so the ops warehouse can suspend |
| Cap native connector cost | Dedicated warehouses with resource monitors. Too low a quota stops ingestion |

[Back to contents](#contents)

### 1.5 open items and flags

- **"Native connectors" is ambiguous.** The study guide lists it with no detail. I took it to mean the Snowflake Connectors for Native Apps (database, ServiceNow, Google Analytics, SharePoint) and the Native SDK for Connectors. Openflow connectors (1.4.24) might be what the exam means. Please confirm.
- **v4 table naming.** `how-the-connector-works` says a valid topic name becomes the table name "converted to uppercase", and an invalid one gets underscores plus a hash (`my-topic.data` becomes `MY_TOPIC_DATA_`). The `setup-kafka` property `snowflake.compatibility.enable.autogenerated.table.name.sanitization` says that with the default `false`, topic names are used **as-is, case preserved, as quoted identifiers**, and the underscore, uppercase and hash behavior applies only when `true`. I could not reconcile these.
- **Buffer defaults.** v3 Snowpipe mode and Snowpipe Streaming mode have different defaults (120 s and 5 MB, versus 10 s and 20 MB). The v3 install page's sample files use 60 s and 5,000,000 bytes, which are not the defaults. 1.4.21 labels its buffer line as v3 streaming and is correct. Its default-schema line was reworded (below).
- **Confluent Cloud.** The v3 overview says a hosted version exists on Confluent Cloud. The v4 page says v4 is not yet a managed Confluent Cloud connector.
- **v3 object name patterns.** The page's angle-bracket placeholders were stripped, so I did not reproduce the exact `STAGE` and `PIPE` name formats.
- **Spark column mapping.** The overview says the `columnmapping` parameter works for internal transfer only. The options list documents `columnmap`, `column_mapping` and `column_mismatch_behavior` and does not say they are internal-only. The option is `sfUrl` in the option list and `sfURL` in sample code. The page does not say whether the name is case-sensitive.
- **Spark age of text.** The Databricks page says "Databricks Runtime 4.2 or later". The 2.1.x external-transfer requirement is old. Treat both as background only.
- **Not fetched or empty:** Kafka `monitor` (JMX metrics), `test-connector`, the Iceberg page, v3 Snowpipe Streaming classic configuration and best-practice pages, `kafka-connector/classic/index` details, Spark `pushdown` (empty), Spark Qubole and ETL pages, Python `asyncio`, `upgrade` and SQLAlchemy pages, and the full `connect()` parameter table (only the pages above were read). Openflow connector pages (`connectors/about` returned nothing), PostgreSQL-specific limits beyond the intro, the MySQL and PostgreSQL ongoing-tasks and replication-configuration pages, SharePoint setup, and ServiceNow cost pages.
- **Python version claim.** The 5.x pages say Python 3.11 or later and that 5.0 raised the minimum from 3.9. Older exam material may state a lower version.
- **Google Analytics status.** The two pages say nothing about preview or GA status, so I left it blank.
