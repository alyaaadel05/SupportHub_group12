# Search, Feedback & Analytics Service — Architecture

GitHub renders the diagrams below automatically.

## 1. Whole picture

```mermaid
flowchart LR
  user["Browser<br/>(reader / author / editor)"]

  subgraph CF["Cloudflare Pages — supporthub-group12.pages.dev"]
    fe["Frontend<br/>HTML / CSS / JS<br/>articles.html, analytics.html"]
    proxy["Pages Function<br/>functions/api/[[path]].js<br/>forwards /api/*"]
  end

  subgraph VC["Vercel (each owner's project)"]
    idsvc["Identity Service<br/>(Alyaa)<br/>login, sessions"]
    artsvc["Article Service<br/>(Alyaa)"]
    edsvc["Editorial Service<br/>(Salma)"]
    search["Search & Analytics<br/>(Nermeen)<br/>Express API"]
  end

  subgraph NEON["Neon PostgreSQL (shared)"]
    sess[("user_sessions")]
    arts[("articles<br/>categories")]
    mine[("search_published_articles<br/>search_query_logs<br/>search_result_clicks<br/>article_views<br/>helpfulness_votes<br/>article_feedback")]
  end

  ts["Cloudflare Turnstile<br/>(siteverify)"]
  hf["Hugging Face<br/>sentiment API"]

  user --> fe --> proxy
  proxy -- "/api/auth/*" --> idsvc
  proxy -- "/api/public/*<br/>/api/articles/:id/votes<br/>/api/analytics/*" --> search
  proxy -- "other /api/*" --> artsvc

  idsvc -- "writes session<br/>cookie supporthub.sid" --> sess
  search -- "reads session<br/>(same SESSION_SECRET)" --> sess
  search -- "parameterized SQL" --> mine
  search -. "read-only: category names" .-> arts

  edsvc -- "signed POST /internal/publications<br/>(HMAC, 5-min window)" --> search
  search -- "GET /internal/articles/:id<br/>(confirm status = published)" --> artsvc

  search -- "votes / feedback" --> ts
  search -. "optional" .-> hf
```

## 2. AWS on Floci (local Docker demonstration)

```mermaid
flowchart LR
  subgraph DOCKER["Docker on the laptop"]
    svc["nermeen-search<br/>container (port 3004)"]
    subgraph FLOCI["nermeen-floci — AWS emulator (port 4566)"]
      ddb[("DynamoDB<br/>supporthub-search-counters<br/>TERM#… / ARTICLE#…")]
      cw["CloudWatch<br/>namespace SupportHub/Search"]
      s3[("S3 bucket<br/>supporthub-search-analytics-exports<br/>exports/*.csv — private, AES256")]
      iam["IAM user search-analytics-service<br/>policy SearchAnalyticsLeastPrivilege"]
    end
  end
  neon[("Neon PostgreSQL<br/>source of truth")]

  svc -- "batched UpdateItem every 5 s<br/>Scan for live counters" --> ddb
  svc -- "batched PutMetricData every 10 s<br/>Searches, Latency, Errors, RateLimited" --> cw
  svc -- "PutObject / GetObject / ListBucket<br/>(exports/ prefix only)" --> s3
  iam -. "allows only these actions" .-> svc
  svc -- "all business data" --> neon
```

## 3. Request flow: a logged-in vote

```mermaid
sequenceDiagram
  participant B as Browser
  participant P as Cloudflare Pages proxy
  participant S as Search & Analytics
  participant T as Turnstile
  participant N as Neon
  B->>P: POST /api/articles/1/votes {helpful, turnstileToken}<br/>cookie supporthub.sid + X-CSRF-Token
  P->>S: forward (same cookie and headers)
  S->>N: load session from user_sessions
  S->>S: check login, Origin, CSRF token
  S->>T: siteverify(token)
  T-->>S: success
  S->>N: INSERT … ON CONFLICT (article_id, user_id) DO UPDATE
  S-->>B: 200 {saved: true}
```

## 4. Notes

| Part | Role |
|---|---|
| Express API | Stateless; routes → controllers → services; rate limit, Helmet, CORS, no-store on private data |
| Neon | Source of truth for searches, views, votes, feedback and analytics |
| Shared authentication | Identity creates the session; this service only reads it (no login code here) |
| DynamoDB | Live counters for the dashboard (not the source of truth) |
| CloudWatch | Operational metrics (traffic, latency, errors, rate limiting) |
| S3 | Private CSV exports of aggregate analytics |
| IAM | Least-privilege user: only its own table, metrics and `exports/` prefix |
| Vercel | Hosts the API online; AWS features are switched off there because Floci is local only |
| Cloudflare Pages | Hosts the frontend and forwards `/api/*`, so the session cookie stays first-party |