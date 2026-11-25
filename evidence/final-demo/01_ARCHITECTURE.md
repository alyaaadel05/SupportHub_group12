# SupportHub — Cloud Architecture

## Verified architecture
React Frontend → Identity Service and Article Service
Article Service → Neon PostgreSQL
Article Service → Transactional Outbox
Docker Outbox Scheduler → Outbox Worker → Floci SQS
Article Service → Floci S3 and Secrets Manager
IAM policies → Restricted AWS API access

## Pending integration
Floci SQS → Salma Editorial Consumer
Editorial Service → Signed Article API
Editorial Service → Nermeen Search/Analytics

## Ownership
Alyaa: Article Management, Identity, Article AWS integration
Salma: Editorial Review and Publishing
Nermeen: Search, Feedback and Analytics
