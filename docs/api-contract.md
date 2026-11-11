
# SupportHub REST API Contract

Base path: /api

## Authentication
GET  /auth/csrf
GET  /auth/me
POST /auth/register
POST /auth/login
POST /auth/logout

## Categories
GET  /categories
POST /categories

## Articles
GET    /articles
GET    /articles/mine
POST   /articles
PUT    /articles/:id
DELETE /articles/:id
POST   /articles/:id/submit
POST   /articles/:id/view
POST   /articles/:id/feedback

## Editorial Workflow
GET  /editorial/queue
GET  /editorial/published
POST /editorial/:id/approve
POST /editorial/:id/reject
POST /editorial/:id/flag

## Analytics
GET /analytics/summary

## Health Monitoring
GET /health

## Authentication
Authentication uses an HTTP-only session cookie.

For state-changing requests, the client includes:
X-CSRF-Token: <token>

The token is received from GET /auth/csrf.

## Example: Create Article
POST /api/articles

{
  "title": "How to Reset Your Password",
  "content": "Use the password reset link...",
  "categoryId": 1
}

Requires author or admin role.

## Example: Submit Article
POST /api/articles/1/submit

Requires article ownership and an eligible status.

## Example: Approve Article
POST /api/editorial/1/approve

Requires editor or admin role.
An editor cannot approve their own article.

## Example: Feedback
POST /api/articles/1/feedback

{
  "helpful": true,
  "turnstileToken": "<validated-token>"
}

## Response Codes
200 - Success
201 - Created
400 - Invalid request
401 - Authentication required
403 - Forbidden
404 - Not found
409 - Conflict
429 - Too many requests
500 - Server error
