# Search & Analytics Service – Sensitive Data in Logs (Review)

## Purpose
Make sure passwords, session cookies, tokens, secrets and database connection strings never appear in application logs (local terminal, Docker logs or Vercel logs).

## All log statements in the service
| File | Log message | What is included | Safe? |
|---|---|---|---|
| `server.js` (error handler) | `Search & Analytics API error:` | `error.message` only | ✅ |
| `server.js` (start) | `Search & Analytics Service listening on <PORT>` | Port number | ✅ |
| `services/feedbackService.js` | `Feedback sentiment update failed:` | `error.message` only (not the feedback text) | ✅ |
| `db/pool.js` | `Search DB pool error:` | `error.message` only (not the connection string) | ✅ |

## Never logged
- Request bodies (search text, votes, written feedback)
- Cookies and session IDs (`supporthub.sid`)
- CSRF tokens (`X-CSRF-Token`)
- Cloudflare Turnstile tokens and `TURNSTILE_SECRET_KEY`
- Hugging Face token (`HF_TOKEN`)
- `SESSION_SECRET`, `SERVICE_SHARED_SECRET`, `DATABASE_URL_POOLED`
- Internal service signatures (`x-service-signature`)

## Other protections
- Error responses to users for server errors are generic (`Internal server error`); details stay in the server log.
- `.env` files are excluded from Git by `.gitignore`; only `.env.example` with placeholder values is committed.
- Secrets in production are stored as Vercel environment variables, not in code.

## Rule for future changes
Any new log line must log only error messages, IDs or counts, never full request objects, headers, cookies or environment variables.

## Result
Reviewed on 18 Nov 2026: **no sensitive data is written to logs. No code change required.**