# Search & Analytics Service – Health-Check Strategy

## 1. Health endpoint
| Item | Value |
|---|---|
| URL | `GET /api/health` |
| Login needed | No |
| Local address | http://localhost:3004/api/health |

## 2. What it checks
1. **The service is running** – the Express server answers the request.
2. **The database is reachable** – it runs `SELECT 1` on the Neon PostgreSQL database.

## 3. Possible responses
| Situation | HTTP status | Response |
|---|---|---|
| Service and database OK | 200 | `{"status":"ok","service":"search-analytics-service","database":"connected"}` |
| Database unreachable | 500 | `{"error":"Internal server error"}` (details logged on the server only) |
| Service not running | no response | Connection refused / timeout |

The response never includes passwords, connection strings or other secrets.

## 4. Who uses the health check
| User | How |
|---|---|
| Developer (local) | Open the URL in a browser or run `curl http://localhost:3004/api/health` |
| Docker | A container health check calls `/api/health` regularly and marks the container *unhealthy* if it fails |
| Vercel (production) | After each deployment, the health URL is opened to confirm the live service and database work |
| Other services / demo | Shows the Search service is available before testing search, votes and analytics |

## 5. What to do if it fails
1. **No response** → the service is not running. Start it (`npm start`) or check the Docker container (`docker ps`, `docker logs <container>`).
2. **500 error** → the service runs but cannot reach the database. Check `DATABASE_URL_POOLED` in `.env` (local) or in Vercel environment variables, and check that Neon is online.
3. Check the server logs for the message `Search & Analytics API error:` to find the cause.
4. After fixing, call `/api/health` again and confirm it returns `200` and `"database":"connected"`.

## 6. Limitations
- It checks the database only. It does **not** check the Article Service, Cloudflare Turnstile or Hugging Face; if those are down, the related features return their own errors (e.g. 502/503) while search keeps working.