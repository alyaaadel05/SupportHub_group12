SupportHub k6 WORKFLOW load test - 2026-11-25T19:32:28.391Z
Target: http://frontend:8080 (integrated Floci stack, RATE_LIMIT_PROFILE=loadtest)
Duration: 26.4 s   Peak VUs: 14 (6 author, 2 editor, 6 reader)   Throughput: 37.9 req/s

| Metric | Result |
|---|---|
| Total requests | 1001 |
| Setup requests | 11 |
| Author requests | 440 |
| Editor requests | 300 |
| Reader requests | 250 |
| Successful (2xx + expected denials + tolerated 409) | 995 |
| Failed (unexpected status) | 6 |
| HTTP 2xx | 874 |
| HTTP 4xx | 127 (of which expected authorization denials: 121) |
| HTTP 5xx | 0 |
| Average response time | 20.9 ms |
| Median response time | 11.2 ms |
| P90 | 39.8 ms |
| P95 | 64.1 ms |
| Max | 347.2 ms |
| Throughput | 37.9 req/s |
| Error rate (unexpected) | 0.60 % |
| k6 http_req_failed rate | 0.00 % |

Per role:
| Role | Requests | 2xx | 4xx | expected denials | 5xx | failed | avg | median | p90 | p95 | max |
|---|---|---|---|---|---|---|---|---|---|---|---|
| setup | 11 | 11 | 0 | 0 | 0 | 0 | 135.4 ms | 58.0 ms | 270.9 ms | 309.1 ms | 347.2 ms |
| author | 440 | 385 | 55 | 55 | 0 | 0 | 14.7 ms | 10.6 ms | 28.6 ms | 39.0 ms | 115.4 ms |
| editor | 300 | 240 | 60 | 60 | 0 | 0 | 34.9 ms | 28.7 ms | 64.8 ms | 105.9 ms | 210.3 ms |
| reader | 250 | 238 | 12 | 6 | 0 | 6 | 9.8 ms | 5.9 ms | 16.1 ms | 25.6 ms | 119.0 ms |

Per endpoint:
| Endpoint | Requests | avg | p95 |
|---|---|---|---|
| auth_csrf | 5 | 15.4 ms | 47.4 ms |
| auth_login | 5 | 274.4 ms | 332.0 ms |
| articles_mine | 55 | 18.8 ms | 112.0 ms |
| article_create | 55 | 18.1 ms | 45.2 ms |
| article_edit | 55 | 19.1 ms | 38.5 ms |
| article_versions | 55 | 10.8 ms | 29.3 ms |
| article_duplicates | 55 | 13.2 ms | 28.1 ms |
| article_get | 55 | 10.4 ms | 24.9 ms |
| article_submit | 55 | 14.8 ms | 27.5 ms |
| author_tries_review_queue | 55 | 12.2 ms | 61.1 ms |
| reviews_queue | 60 | 43.8 ms | 114.5 ms |
| review_decision | 60 | 29.6 ms | 68.4 ms |
| publication | 50 | 48.3 ms | 104.2 ms |
| editorial_published | 70 | 45.2 ms | 153.9 ms |
| editor_tries_create_article | 60 | 8.4 ms | 14.8 ms |
| public_search | 226 | 10.1 ms | 23.1 ms |
| public_article | 6 | 8.4 ms | 20.6 ms |
| search_click | 6 | 10.4 ms | 28.9 ms |
| vote | 6 | 9.4 ms | 21.4 ms |
| anonymous_vote | 6 | 2.1 ms | 3.1 ms |
| categories | 1 | 40.0 ms | 40.0 ms |

Checks: 984 passed, 6 failed
