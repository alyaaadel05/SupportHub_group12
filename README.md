
# SupportHub — Group 12

A Secure Cloud-Based Customer Support Knowledge
Base Management System.

## Cloud Computing & Cloud Security
BUE — Group 12

## Project Components

Student 1: Article and Category Management
- Create categories
- Create articles
- Edit article drafts
- Delete eligible drafts
- Submit articles for review

Student 2: Editorial Review and Publishing
- Review queue
- Approve and publish articles
- Reject articles with comments
- Flag outdated articles

Student 3: Search, Feedback and Analytics
- Search published articles
- Filter by category
- Record article views
- Record helpfulness feedback
- Display dashboard statistics

## Technologies

Frontend:
HTML, CSS, JavaScript, Cloudflare Pages

Backend:
Node.js, Express, Vercel

Database:
Neon Serverless PostgreSQL

Security:
bcrypt, sessions, CSRF protection, RBAC,
parameterized queries, rate limiting,
Cloudflare Turnstile and audit logging.

## Local Development

### Frontend

cd frontend
npm install
npm start

Website:
http://localhost:8080

### Backend

cd backend
npm install

Copy .env.example to .env and configure the values.

Run:
npm run dev

API:
http://localhost:3000/api

Health check:
http://localhost:3000/api/health

## Database Setup

1. Create a Neon PostgreSQL database.
2. Copy the database connection string.
3. Add it to backend/.env.
4. Execute backend/db/schema.sql.
5. Start the backend.

## User Roles

New registrations receive the author role.

For development, an authorized database administrator
can assign an editor or admin role directly in SQL.

After a role change, the user must log out and
log back in for the session to reflect the new role.

## Testing

cd backend
npm test

Additional end-to-end and deployed security tests
are described in docs/test-plan.md.

## Cloud Deployment

1. Deploy the backend to Vercel.
2. Set backend environment variables.
3. Deploy frontend to Cloudflare Pages.
4. Configure the API proxy backend origin.
5. Configure the Turnstile site and secret keys.
6. Verify authentication, database connectivity,
   authorization, and security controls.

## Status

Implementation code prepared.
Cloud deployment, integration testing, and
security testing must be completed and documented.
