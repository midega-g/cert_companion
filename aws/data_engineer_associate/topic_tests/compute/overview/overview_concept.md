# Compute — Overview (Concept Notes)

Cumulative concept notes for the AWS Data Engineer Associate **compute** topic
overview. Source of truth for Topic Drill question generation. Not rendered in
the app.

## 2026-09-26 — Introduction to Compute in AWS

### What "compute" means
- **Compute resources** = the brains/processing power an application or system
  needs to carry out computational tasks via a series of instructions.
- Closely related to common server components: **CPUs and RAM**.
- A **physical server** in a data center is a compute resource — it has multiple
  CPUs and many gigabytes of RAM to process instructions from the operating
  system and applications.

### How compute is consumed in AWS
- AWS offers many services/features that provide compute power for different
  functions.
- Compute can be consumed in **different quantities**, for **different lengths of
  time**, across a **wide range of categories**, with varying performance and
  benefits.
- Long-running example: a service may use **hundreds of EC2 instances (virtual
  servers)** continuously for **months or even years**, processing billions of
  instructions.
- Short-lived example: an **AWS Lambda** function may use only a **few
  milliseconds** of compute to run a couple lines of Python **in response to an
  event**, then **relinquish that compute power**.
- The compute resources you use ultimately depend on your **overall business
  requirements**.

### Compute services introduced in this course (exam scope)
Core compute services:
- **Amazon EC2** (Elastic Compute Cloud) — virtual servers.
- **AWS Batch**.
- **AWS Lambda** — serverless, event-driven, short-lived execution.
- **AWS SAM** (Serverless Application Model).

AWS container services:
- **Amazon ECS** (Elastic Container Service).
- **Amazon ECR** (Elastic Container Registry).
- **Amazon EKS** (Elastic Kubernetes Service).

### Key contrasts (testable)
- **EC2 = virtual servers**; can run continuously for long durations
  (months/years).
- **Lambda = serverless**; runs briefly (milliseconds) in response to an event,
  then releases compute — the opposite end of the duration scale from EC2.
