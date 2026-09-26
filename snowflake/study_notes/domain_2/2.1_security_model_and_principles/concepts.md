# Subdomain 2.1: Snowflake Security Model and Principles

Snowflake offers industry-leading features that ensure the security of your **account**, **users**, and **data**. Security practices protect data from unauthorized access, theft, or corruption. Snowflake gives you **granular control** over *who* can access *what* objects, *which* operations they can perform, and *who* can manage access control itself.

This note covers Snowflake's security model: how connections are controlled, how users prove who they are, and how access is granted through roles.

---

## Overview: The Three Security Layers

| Layer | Question it answers | Features |
|-------|--------------------|----------|
| **Can you connect?** | Is this network location allowed? | Network Policies, Network Rules |
| **Are you who you say?** | Can you prove your identity? | Authentication (MFA, SSO/Federated, OAuth, Key-pair), Authentication Policies |
| **What can you do?** | What are you allowed to access? | RBAC, DAC, Securable Object Hierarchy, Roles |

Wrapping all three: **Logging and tracing** for auditing and troubleshooting.

---

## 1. Network Policies

**What it is:** A network policy controls **which network locations (IP addresses) can connect** to your Snowflake account or to specific users.

**How it secures the account:**
- Defines **allowed** and **blocked** IP ranges — the first line of defense before authentication even happens.
- Can be applied at the **account level** (all users) or the **user level** (specific users), with user-level taking precedence.
- Built on **network rules** — reusable objects that group IP addresses or private endpoints, referenced by network policies.

**Key points:**
- `ALLOWED_IP_LIST` and `BLOCKED_IP_LIST` (blocked is evaluated first).
- Uses CIDR notation (e.g., `192.168.1.0/24`).
- **Network rules** (`CREATE NETWORK RULE`) separate the *definition* of locations from the *policy* that enforces them — cleaner than inline IP lists.
- Applied via `ALTER ACCOUNT SET NETWORK_POLICY = ...` or `ALTER USER ... SET NETWORK_POLICY = ...`.

---

## 2. Authentication Methods

Authentication verifies **identity**. Snowflake supports several methods, from passwords to federated SSO.

### Multi-Factor Authentication (MFA)
- Adds a **second factor** (typically Duo push) on top of a password.
- Can be **enforced** for users; strongly recommended for all human users, especially `ACCOUNTADMIN`.
- Managed through **authentication policies** at the account or user level.

### Authentication Policies
- Schema-level objects that define **which authentication methods are allowed** (e.g., require MFA, restrict to SSO only, allow/disallow password).
- Applied at account or user level for centralized control.

### Federated Authentication & SSO (Single Sign-On)
- Delegates authentication to an external **Identity Provider (IdP)** such as Okta, Microsoft Entra ID (Azure AD), or any SAML 2.0-compliant IdP.
- Users log in through the IdP; Snowflake trusts the IdP's assertion.
- **Supported SSO workflows:** IdP-initiated (start at the IdP portal) and SP-initiated (start at Snowflake, get redirected to the IdP).

### OAuth
- Token-based authorization allowing applications to access Snowflake **without handling user credentials**.
- **Snowflake OAuth** (built-in authorization server) and **External OAuth** (e.g., Okta, Entra ID as the authorization server).
- Common for BI tools and programmatic clients.

### Key-Pair Authentication
- Uses an **RSA public/private key pair** instead of a password — the public key is assigned to the Snowflake user, the client signs with the private key.
- Preferred for **service accounts** and automated/programmatic access.
- Supports **key rotation** (assign a second key, rotate, then remove the old one) for zero-downtime credential rollover.

---

## 3. Access Control Framework — RBAC + DAC

Snowflake's access control combines two models:

### Role-Based Access Control (RBAC)
- **Privileges are granted to roles**, and **roles are granted to users** (or to other roles).
- Users acquire privileges only by activating a role — no privileges are granted directly to users.
- Roles can be granted to other roles, forming a **hierarchy** where privileges are **inherited** upward.

### Discretionary Access Control (DAC)
- **Each object has an owner** (a role), and that owner can **grant access** to the object at its discretion.
- The owning role has full control over the object it created.

Together: **DAC** says "the creator owns and can share it"; **RBAC** says "access flows through roles, not individuals."

---

## 4. Securable Object Hierarchy

Every object that access can be granted on is a **securable object**, organized in a **containment hierarchy**:

```
ORGANIZATION
  └── ACCOUNT
        ├── USER, ROLE, WAREHOUSE, (account-level objects)
        └── DATABASE
              └── SCHEMA
                    └── TABLE, VIEW, STAGE, FUNCTION, ... (schema-level objects)
```

**Key principle:** To access an object, a role generally needs privileges on the object **and** `USAGE` on the containers above it (database and schema). Access does **not** automatically flow down the containment hierarchy — you grant it explicitly (or use future grants).

---

## 5. Role Hierarchy and Privilege Inheritance

- Roles can be **granted to other roles**, creating a tree.
- A **parent role inherits all privileges** of the roles granted to it.
- Best practice: grant lower roles up into higher roles so that `SYSADMIN` (and ultimately `ACCOUNTADMIN`) sits at the top of custom role trees.

Example inheritance:
```
ACCOUNTADMIN
  ├── SYSADMIN ──► custom_role_1 ──► custom_role_2
  └── SECURITYADMIN ──► USERADMIN
```

---

## 6. Types of Roles

### System-Defined Roles (built in, cannot be dropped)
| Role | Purpose |
|------|---------|
| `ORGADMIN` | Manages operations at the **organization** level (accounts, regions). |
| `ACCOUNTADMIN` | Top-level admin; encapsulates `SYSADMIN` + `SECURITYADMIN`. Use sparingly. |
| `SECURITYADMIN` | Manages grants globally; can manage users and roles (`MANAGE GRANTS`). |
| `USERADMIN` | Creates and manages **users and roles** (but not grants on objects broadly). |
| `SYSADMIN` | Creates and manages **objects** (warehouses, databases, etc.). |
| `PUBLIC` | Default pseudo-role automatically granted to every user/role; least privilege. |

### Custom Roles
- Roles you create for your organization's specific needs (e.g., `analyst`, `data_engineer`).
- Best practice: create custom roles under `SYSADMIN` so admins retain visibility/control.

### Account Roles vs. Database Roles
- **Account roles** exist at the account level and can be granted broad privileges.
- **Database roles** are scoped to a **single database** — useful for delegating control within one database (e.g., in data sharing) without account-wide reach.

### Primary vs. Secondary Roles
- A session has **one primary role** (`CURRENT_ROLE()`) — used for object creation/ownership decisions.
- **Secondary roles** let a session use the **combined privileges** of multiple roles at once (`USE SECONDARY ROLES ALL`), without switching the primary role.

---

## 7. Granting and Revoking Privileges

Core commands (details and worked examples in `walkthroughs.md`):

| Action | Command |
|--------|---------|
| Create a role | `CREATE ROLE <name>` |
| Grant a role to a user/role | `GRANT ROLE <r> TO USER <u>` / `TO ROLE <parent>` |
| Grant a privilege on an object | `GRANT <priv> ON <object> TO ROLE <r>` |
| Inspect grants | `SHOW GRANTS TO ROLE <r>` / `ON <object>` / `OF ROLE <r>` |
| Revoke a role | `REVOKE ROLE <r> FROM USER <u>` |
| Revoke a privilege | `REVOKE <priv> ON <object> FROM ROLE <r>` |
| Activate multiple roles | `USE SECONDARY ROLES ALL` |

**Principle of least privilege:** grant only the privileges a role needs, and build access up through the role hierarchy rather than granting to individuals.

---

## 8. Logging and Tracing

- Snowflake captures **log messages, traces, and metrics** from functions and procedures into an **event table** for observability.
- **`LOGIN_HISTORY`** view records authentication events (who logged in, from where, success/failure, method) — key for security auditing.
- Other `ACCOUNT_USAGE` views (`QUERY_HISTORY`, `GRANTS_TO_ROLES`, `SESSIONS`) support auditing access and privilege changes.

**Governance benefit:** Full visibility into authentication attempts, session activity, and code execution for security monitoring and troubleshooting.

---

## Quick Reference Summary

| Feature | Secures | Key objects/commands |
|---------|---------|----------------------|
| **Network Policies** | Which IPs can connect | `CREATE NETWORK POLICY`, `NETWORK RULE` |
| **MFA** | Login second factor | Authentication policy, Duo |
| **Federated / SSO** | Delegated login to IdP | SAML 2.0, Okta, Entra ID |
| **OAuth** | App access without credentials | Snowflake OAuth, External OAuth |
| **Key-pair** | Programmatic/service auth | RSA key pair, rotation |
| **RBAC** | Privileges via roles | `GRANT`/`REVOKE`, role hierarchy |
| **DAC** | Object owner grants access | Object ownership |
| **Securable hierarchy** | Containment & USAGE model | DB → schema → object |
| **Role types** | Separation of duties | System-defined, custom, DB roles, primary/secondary |
| **Logging & tracing** | Audit & observability | `LOGIN_HISTORY`, event tables, `ACCOUNT_USAGE` |

---

## Reference Links (from Snowflake docs)

- Network Policies / Network Rules / Securing Snowflake / LOGIN_HISTORY View
- Multi-factor authentication (MFA) / Authentication Policies
- Overview of federated authentication and SSO / Supported identity providers / Supported SSO workflows
- OAuth / Snowflake OAuth / Key-pair authentication and rotation
- Access control framework / Securable object hierarchy / Role hierarchy and privilege inheritance / Access control privileges
- Account and database roles / System-defined roles / Custom roles / Primary and secondary roles
- Configuring access control / User management
- CREATE ROLE / GRANT ROLE / GRANT privileges / SHOW GRANTS / REVOKE ROLE / REVOKE privileges / USE SECONDARY ROLES
- Logging, tracing, and metrics
