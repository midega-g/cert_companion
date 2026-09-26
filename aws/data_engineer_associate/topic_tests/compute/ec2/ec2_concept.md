# EC2 — Concept Notes

Source of truth for Topic Drill question generation. Cumulative; append new
batches under dated sections. Never rendered in the app.

## 2026-09-26 — EC2 tenancy, user data, storage, and security

### Host isolation & tenancy

- AWS uses advanced security mechanisms to prevent different customers' EC2
  instances from accessing each other on the same physical host — there is no
  security risk from shared hosting itself.
- Some workloads must run on **dedicated hardware** due to internal security
  policies or external compliance controls; in those cases use **dedicated
  tenancy**.
- Dedicated tenancy includes two options: **dedicated instances** and
  **dedicated hosts**.
- **Dedicated instances**: hosted on hardware no other customers can access.
  Incur additional charges because no other customer may run EC2 on the same
  hardware (likely unused capacity remains). However, that hardware **can be
  shared by other resources in your own account**.
- **Dedicated hosts**: effectively the same as a dedicated instance, but offer
  **additional visibility and control over how you place instances on the
  physical host**.
- Dedicated hosts also let you use existing **per-socket, per-core, or per-VM
  software licenses** that may need to be tied to a specific machine.
- If you have no specific licensing, compliance, or security need for dedicated
  tenancy, use the **default shared tenancy** to reduce overall costs.

### User Data

- When configuring a new EC2 instance there is a section called **User Data**.
- User Data lets you enter commands or a command script that run **during the
  first boot cycle** of the instance.
- Good for automatically performing functions at boot: pulling down software to
  install from software repositories, downloading/installing latest OS updates.
- Example: `yum update -y` on a Linux instance updates its own software
  automatically at boot time.

### Storage — persistent vs ephemeral

- When setting up an EC2 instance you select and configure storage. The choice
  depends on the instance type selected, how you intend to use the instance,
  and how critical the data is.
- EC2 storage is classified as **persistent** or **ephemeral** (temporary).
- **Persistent storage**: provided by attaching **Elastic Block Storage (EBS)**
  volumes via Amazon Elastic Block Store.
- **Ephemeral storage**: created by some EC2 instances themselves using
  **Instance Store volumes**, which are local disks on the underlying physical
  host.

### EBS volumes (persistent)

- EBS volumes are **separate devices** from the EC2 instance — not physically
  attached like ephemeral storage.
- EBS volumes are **network-attached storage**, logically attached to the EC2
  instance via the AWS network (analogy: external hard drive to a laptop; the
  drive = EBS volume, the PC = EC2 instance).
- Data on EBS volumes is **automatically replicated within the same Availability
  Zone** for resiliency, managed by AWS.
- You can **detach an EBS volume and the data remains intact**, then reattach it
  to another EC2 instance **within the same Availability Zone** if required.
- You can take **point-in-time snapshots** that back up all data on an EBS
  volume **to S3**.
- You can **encrypt** EBS volumes: either **encryption by default** for all new
  EBS volumes and copies of snapshots (enabled from the EC2 dashboard in the
  console), or **on a per-volume basis**.
- EBS volumes can be created in **different sizes and performance capabilities**
  depending on requirements.

### Instance store volumes (ephemeral)

- Ephemeral / instance store storage is **physically attached to the underlying
  host** on which the EC2 instance resides (analogy: laptop/PC internal hard
  drive).
- You **cannot detach** an ephemeral instance store volume from an instance.
- **All saved data on an instance store volume is lost** as soon as the instance
  **hibernates, is stopped, or is terminated**.
- **Rebooting** the instance **retains** the data.
- Data is also lost forever on **hardware failure** of the underlying disk.
- Instance store volumes are **extremely fast** (physically attached) — great
  for **cache data and other temporary content**.
- For data you need to retain, use **EBS volumes** for persistent storage
  instead.

### EC2 security — security groups

- When creating an EC2 instance you select a **security group**.
- A security group is essentially an **instance-level firewall**, restricting
  both **ingress and egress** traffic by specifying what traffic may communicate
  with the instance.
- You can restrict communication by **source, ports, and protocols** for both
  inbound and outbound communication.
- Instances are associated with a security group, which can also be associated
  with **other instances**.

### EC2 security — key pairs

- When creating an EC2 instance you select an existing **key pair** or create
  and download a new one.
- A key pair consists of a **public key and a private key**.
- Key pairs **encrypt the login information** for Linux and Windows EC2
  instances, then **decrypt** it, allowing you to authenticate to the instance.
- The **public key encrypts** data such as username and password.
- **Windows instances**: the **private key decrypts** this data to reveal the
  login credentials (including the password).
- **Linux instances**: the **private key is used to remotely connect via SSH**.
- **AWS holds and keeps the public key**; the **private key is your
  responsibility** to keep safe and never lose or compromise.
- Creating a new key pair downloads it to your local machine; keep the file safe
  until you connect to the associated instance.
- The **same key pair can be used for multiple instances** (avoids managing many
  private keys) — but if that private key is compromised, access could be gained
  to **any instance using that key pair**.
- After first authentication you can set up additional **less-privileged access
  controls** (e.g., local Windows accounts) so other users can connect.

### Shared Responsibility

- Per the **AWS Shared Responsibility model**, it is **your responsibility** to
  maintain and install the latest **OS and security patches** released by the OS
  vendor.
