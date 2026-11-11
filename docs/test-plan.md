
# SupportHub Security and Functional Test Plan

Do not mark a test PASS before executing it.

## Security Tests

S01 - SQL Injection
Send SQL-like strings in article search and login fields.
Expected: No SQL query manipulation.

S02 - Unauthenticated Article Creation
Call POST /api/articles without logging in.
Expected: HTTP 401.

S03 - Broken Object-Level Authorization
Login as Author B and attempt to edit
an article owned by Author A.
Expected: HTTP 403.

S04 - Unauthorized Editorial Action
Login as an author and try to approve an article.
Expected: HTTP 403.

S05 - CSRF Protection
Submit a state-changing request without
the X-CSRF-Token header.
Expected: HTTP 403.

S06 - Stored XSS
Create an article containing harmless HTML-like
test text such as <script>alert(1)</script>.
Expected: Text displays literally; no execution.

S07 - Invalid Turnstile Token
Submit registration or feedback with
a fake or missing Turnstile token.
Expected: Request rejected in production.

S08 - Login Rate Limiting
Make repeated failed login attempts in
a controlled local test environment.
Expected: HTTP 429 after the allowed limit.

S09 - Password Storage
Inspect a test user's password_hash column.
Expected: bcrypt hash, not plaintext.

S10 - Editorial Ownership Separation
Attempt to approve an article using the
same account that authored it.
Expected: Approval rejected.

## Functional Tests

F01 - Register account
F02 - Login and logout
F03 - Create category
F04 - Create article
F05 - Edit owned draft
F06 - Submit for review
F07 - Reject with comment
F08 - Edit and resubmit
F09 - Approve and publish
F10 - Search published articles
F11 - Vote helpful or not helpful
F12 - Flag outdated article
F13 - View analytics
F14 - Confirm unpublished articles are hidden

## Evidence for Every Test
- Test ID
- Date
- Tester
- Preconditions
- Test input
- Expected result
- Actual result
- PASS or FAIL
- Screenshot or API response evidence
