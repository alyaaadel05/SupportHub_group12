
# SupportHub Threat Model

## Assets
- User accounts and passwords
- Unpublished articles
- Published articles
- Review decisions
- Feedback records
- Audit logs
- Session credentials
- Database connection secrets

## Threat 1: SQL Injection
Risk:
Attackers manipulate database queries.

Mitigation:
Parameterized PostgreSQL queries.

## Threat 2: Cross-Site Scripting
Risk:
Malicious content executes in visitors' browsers.

Mitigation:
Use textContent when displaying user content.
Avoid inserting untrusted content using innerHTML.
Use Helmet for backend security headers.

## Threat 3: Broken Object-Level Authorization
Risk:
An author edits someone else's article.

Mitigation:
Check article ownership directly in SQL UPDATE
and DELETE statements.

## Threat 4: Broken Function-Level Authorization
Risk:
An author accesses editorial API endpoints.

Mitigation:
Server-side role checks on protected routes.

## Threat 5: CSRF
Risk:
External pages submit unwanted authenticated actions.

Mitigation:
Session-bound CSRF tokens required for
state-changing requests.

## Threat 6: Credential Attacks
Risk:
Automated login guessing.

Mitigation:
bcrypt password hashing and login rate limiting.

## Threat 7: Automated Abuse
Risk:
Bots create accounts or manipulate feedback.

Mitigation:
Cloudflare Turnstile token verification
through the server-side Siteverify API.

## Threat 8: Sensitive Data Exposure
Risk:
Database passwords or session secrets leak.

Mitigation:
Store secrets in environment variables.
Never upload the real .env file.
Use HTTPS in production.

## Threat 9: Session Hijacking
Risk:
Session cookies are exposed or stolen.

Mitigation:
HTTP-only and Secure cookies.
Persistent server-side session storage.
Session regeneration on login.

## Residual Risks and Limitations
- Application security requires testing after deployment.
- Browser cookie compatibility must be verified.
- Rate limits use the default process-local store.
  A shared persistent limiter is preferable for production.
- Vote duplication is limited by a browser session,
  not by a verified real-world identity.
- Database secrets, cloud access, and account recovery
  require ongoing operational security.
- Audit-log writes should be monitored for failures.

