
# SupportHub System Architecture

## Overview
SupportHub is a secure cloud-based customer support
knowledge base management system.

## Frontend
- HTML5
- CSS3
- JavaScript
- Cloudflare Pages

## Backend
- Node.js
- Express REST API
- Vercel hosting
- Session-based authentication

## Database
- Neon Serverless PostgreSQL
- Parameterized SQL queries
- Persistent application data
- Persistent session storage

## External Security Service
Cloudflare Turnstile is used during registration
and feedback submission.

The backend validates each token through Siteverify.

## Application Roles
Author:
- Create categories
- Create and edit owned articles
- Delete eligible drafts
- Submit articles for review

Editor:
- Review submitted articles
- Approve or reject articles
- Publish articles
- Flag outdated articles
- Access analytics

Admin:
- Has both author and editor capabilities

## Main Workflow
1. Author logs in.
2. Author creates an article draft.
3. Author submits the draft.
4. Editor reviews the submitted article.
5. Editor approves or rejects the article.
6. Approved articles become publicly visible.
7. Visitors search, read, and rate articles.
8. Editors view analytics.

## Cloud Architecture
Browser -> Cloudflare Pages -> Express API on Vercel
-> Neon PostgreSQL

The Cloudflare Pages Function proxies /api requests
to the Vercel backend.

## Monitoring
- Backend server logs
- Vercel function logs
- audit_logs database table

## Deployment Status
To be completed after actual cloud deployment.

