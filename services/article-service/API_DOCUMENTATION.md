
# SupportHub — Article Management Service

**Developer:** Alyaa Adel  
**Service:** Article Management Service  
**Default Port:** 3001  
**Tested Local Port:** 3011  
**Technology:** Node.js, Express, PostgreSQL

## Startup

From `services/article-service`:

```bash
npm start
```

The service uses the `PORT` environment variable, defaulting to 3001.

## Health Check

GET /api/health

Tested URL: http://localhost:3011/api/health

Verified response:

```json
{
  "status": "ok",
  "service": "article-service"
}
```

The health endpoint checks database connectivity.

## Article Routes

| Method | Endpoint | Description |
|---|---|---|
| POST | /api/articles/check-duplicates | Check duplicate articles |
| GET | /api/articles/mine | List author's articles |
| POST | /api/articles | Create article draft |
| GET | /api/articles/:id | Retrieve article |
| PATCH | /api/articles/:id | Update article |
| DELETE | /api/articles/:id | Delete article |

These routes require the author or admin role.

## Category Routes

| Method | Endpoint | Description |
|---|---|---|
| GET | /api/categories | List categories |
| POST | /api/categories | Create category |
| PATCH | /api/categories/:id | Update category |
| DELETE | /api/categories/:id | Delete category |

Category modification requires the author or admin role.

## Reference Routes

| Method | Endpoint | Description |
|---|---|---|
| GET | /api/articles/related-questions | Retrieve related questions |

Requires author or reviewer role. Limited to 25 requests per 15 minutes.

## Version Routes

| Method | Endpoint | Description |
|---|---|---|
| GET | /api/articles/:id/versions | List article versions |
| GET | /api/articles/:id/versions/compare | Compare article versions |
| GET | /api/articles/:id/versions/:versionId | Retrieve a version |
| POST | /api/articles/:id/restore | Restore article version |

Requires author or reviewer role.

## Additional Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | /api/articles/csrf | Obtain CSRF token |
| GET | /internal/articles/:id | Internal article retrieval |
| PATCH | /internal/articles/:id/status | Internal status transition |

The internal endpoints require signed service-to-service requests.

## Security Controls

- Role-based access control
- Session authentication shared with Identity Service
- CSRF protection for modifying browser requests
- Origin validation
- API rate limiting
- HMAC-authenticated internal communication
- PostgreSQL-backed audit logging
- Restricted access to unpublished content for Search Service

## Verification

- Dedicated service folder: Verified
- Independent startup: Verified on port 3011
- Health endpoint: Verified
- Database connectivity through health check: Verified
- Other API endpoints: Listed from source code; not individually tested in this verification

