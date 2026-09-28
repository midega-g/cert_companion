# What Is AWS? — Concept Notes

Source: AWS Technical Essentials, Module 1 — "What Is AWS?"

## 2026-09-28 — Cloud computing basics & deployment models

### Definition

- **Cloud computing** = the on-demand delivery of IT resources over the internet with primarily **pay-as-you-go pricing**.
- With cloud computing, companies do **not** manage or maintain their own hardware and data centers. Instead, providers like Amazon Web Services (AWS) own and maintain the data centers and provide virtual data center technologies and services to companies and users over the internet.
- The "IT resources" mentioned in the cloud computing definition **are AWS services**. AWS provides cloud computing services.

### Why cloud emerged (historical context)

- **Before the cloud**, companies and organizations hosted and maintained hardware such as compute, storage, and networking equipment in their own data centers.
- They often allocated **entire infrastructure departments** to take care of their data centers, which resulted in costly operations that made some workloads and experimentation impossible.
- As internet use became more widespread, the demand for compute, storage, and networking equipment increased. For some companies and organizations, the cost of maintaining a large physical presence became **unsustainable**. To solve this problem, cloud computing emerged.

### Cloud computing deployment models (three)

- Cloud computing lets developers and IT departments focus on what matters most by avoiding work like procurement, maintenance, and capacity planning. Several deployment strategies emerged to meet the specific needs of different users, and each deployment method provides different levels of **control, flexibility, and management**. Understanding the differences helps you decide what set of services is right for your needs.
- **On-premises:** before the cloud, companies hosted and maintained their own hardware in their own data centers. In an on-premises solution, adding an additional environment requires you to buy and install hardware, connect the necessary cabling, provision power, install operating systems, and more — tasks that are time-consuming and expensive and that increase a new feature's time-to-market.
- **Cloud:** the on-demand delivery of IT resources over the internet with primarily pay-as-you-go pricing, where the provider owns and maintains the hardware and data centers and delivers them as services over the internet. By running your application in the cloud you can replicate an entire production environment in a matter of **minutes or even seconds**, managed over the internet, instead of physically installing hardware and connecting cabling.
- **Hybrid:** a way to connect infrastructure and applications between **cloud-based resources and existing resources that are not located in the cloud** (on-premises). The most common method of hybrid deployment connects cloud resources to internal systems to **extend and grow** an organization's infrastructure into the cloud.

### QA environment scenario (on-premises vs cloud)

- To differentiate on-premises from cloud: consider developers who must deploy a new application feature and first want to test it in a separate quality assurance (QA) environment with the same configurations as production.
- **On-premises:** the additional QA environment requires buying and installing hardware, connecting cabling, provisioning power, and installing operating systems — time-consuming and expensive, and the feature's time-to-market increases while developers wait for the QA environment.
- **Cloud:** you can replicate an entire production environment in minutes or even seconds because the solution is managed over the internet rather than by physically installing hardware.

### Undifferentiated heavy lifting

- Using cloud computing saves time during setup and removes redundant and unnecessary tasks.
- Some aspects of an application are very important to your business, like the code. Other aspects are no different than any other application you might make — for example, the compute that the code runs on.
- Some repetitive common tasks don't differentiate your business, like installing virtual machines (VMs) or storing backups. Removing these tasks is referred to as removing **"undifferentiated heavy lifting."**
- By removing undifferentiated heavy lifting you can focus on what is strategically unique to your business and let AWS handle the time-consuming tasks that don't separate you from your competitors. That is where AWS fits in.

### Six advantages of cloud computing

1. **Pay-as-you-go** — the cloud computing model is based on paying only for the resources that you use. This is in contrast to on-premises models of investing in data centers and hardware that might not be fully used.
2. **Benefit from massive economies of scale** — by using cloud computing you can achieve a lower cost than you can get on your own. Because usage from hundreds of thousands of customers is aggregated in the cloud, AWS can achieve higher economies of scale, which translates into lower pay-as-you-go prices.
3. **Stop guessing capacity** — stop guessing on your infrastructure capacity needs. Making a capacity decision before deploying an application often ends with either sitting on expensive idle resources or dealing with limited capacity. With cloud computing these problems go away: you can access as much or as little capacity as you need and scale up and down as required with only a **few minutes' notice**.
4. **Increase speed and agility** — IT resources are only a click away, which reduces the time to make resources available to developers from **weeks to minutes**. This dramatically increases organizational agility because the cost and time to experiment and develop is significantly lower.
5. **Realize cost savings** — companies can focus on projects that differentiate their business and remove the undifferentiated heavy lifting instead of maintaining data centers. With cloud computing you focus on your customers rather than racking, stacking, and powering physical infrastructure.
6. **Go global in minutes** — applications can be deployed in multiple Regions around the world with a few clicks, which means you can provide lower latency and a better experience for your customers at a minimal cost.

### Course context (application)

- For this course you build a **corporate/employee directory application**, using AWS services to architect a **scalable, highly available, and cost-effective** infrastructure to host it — so you can get the application out into the world quickly without managing heavy-duty physical hardware.
