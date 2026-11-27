
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
GET   /reviews?status=pending|approved|rejected        (reviewer)
POST  /articles/:id/submissions                         (author, own draft)
POST  /articles/:id/reviews        {decision, comments}  (reviewer, not own article)
GET   /articles/:id/history                             (reviewer)
GET   /editorial/published                              (reviewer)
PATCH /articles/:id/publication                         (reviewer, approved articles only)
GET   /editorial/flags?limit=&offset=                   (reviewer)
POST  /articles/:id/flags          {reason}             (reviewer, published articles only)
PATCH /flags/:id                   {resolution}         (reviewer, not own article)
GET   /csrf-token                                       (logged in)

Internal (not under /api, no browser access):
POST  /internal/auto-flags         signed by Search Service (HMAC)
POST  /internal/retry-notifications, /internal/retry-publication-events   (cron secret)

Full list with validation and status codes: docs/final/report-drafts/08-api-list-and-data-model.md

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
POST /api/articles/1/reviews

{
  "decision": "approved",
  "comments": "Clear steps, approved."
}

Requires reviewer, editor or admin role and a CSRF token.
An editor cannot review their own article (403); a second decision returns 409.

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
