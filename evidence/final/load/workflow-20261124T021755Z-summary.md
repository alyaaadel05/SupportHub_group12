SupportHub k6 WORKFLOW load test - 2026-11-24T02:17:55.945Z
Target: http://frontend:8080 (integrated Floci stack, RATE_LIMIT_PROFILE=loadtest)
Duration: 25.9 s   Peak VUs: 14 (6 author, 2 editor, 6 reader)   Throughput: 38.6 req/s

| Metric | Result |
|---|---|
| Total requests | 1001 |
| Setup requests | 11 |
| Author requests | 440 |
| Editor requests | 300 |
| Reader requests | 250 |
| Successful (2xx + expected denials + tolerated 409) | 1001 |
| Failed (unexpected status) | 0 |
| HTTP 2xx | 858 |
| HTTP 4xx | 143 (of which expected authorization denials: 143) |
| HTTP 5xx | 0 |
| Average response time | 20.3 ms |
| Median response time | 13.1 ms |
| P90 | 36.8 ms |
| P95 | 61.4 ms |
| Max | 333.3 ms |
| Throughput | 38.6 req/s |
| Error rate (unexpected) | 0.00 % |
| k6 http_req_failed rate | 0.00 % |

Per role:
| Role | Requests | 2xx | 4xx | expected denials | 5xx | failed | avg | median | p90 | p95 | max |
|---|---|---|---|---|---|---|---|---|---|---|---|
| setup | 11 | 11 | 0 | 0 | 0 | 0 | 151.5 ms | 19.8 ms | 329.0 ms | 331.2 ms | 333.3 ms |
| author | 440 | 385 | 55 | 55 | 0 | 0 | 15.0 ms | 11.6 ms | 28.2 ms | 32.7 ms | 86.0 ms |
| editor | 300 | 240 | 60 | 60 | 0 | 0 | 30.6 ms | 23.5 ms | 63.5 ms | 77.5 ms | 308.0 ms |
| reader | 250 | 222 | 28 | 28 | 0 | 0 | 11.6 ms | 8.7 ms | 19.7 ms | 28.8 ms | 68.2 ms |

Per endpoint:
| Endpoint | Requests | avg | p95 |
|---|---|---|---|
| auth_csrf | 5 | 7.2 ms | 16.7 ms |
| auth_login | 5 | 324.8 ms | 332.4 ms |
| articles_mine | 55 | 15.4 ms | 72.2 ms |
| article_create | 55 | 18.9 ms | 33.3 ms |
| article_edit | 55 | 20.8 ms | 38.5 ms |
| article_versions | 55 | 12.9 ms | 30.0 ms |
| article_duplicates | 55 | 13.8 ms | 30.3 ms |
| article_get | 55 | 11.6 ms | 22.8 ms |
| article_submit | 55 | 16.4 ms | 31.3 ms |
| author_tries_review_queue | 55 | 9.9 ms | 41.1 ms |
| reviews_queue | 60 | 67.2 ms | 126.7 ms |
| review_decision | 60 | 25.4 ms | 47.9 ms |
| publication | 40 | 35.6 ms | 52.8 ms |
| editorial_published | 80 | 24.1 ms | 47.8 ms |
| editor_tries_create_article | 60 | 4.6 ms | 9.5 ms |
| public_search | 138 | 12.1 ms | 29.7 ms |
| public_article | 28 | 9.8 ms | 19.3 ms |
| search_click | 28 | 13.3 ms | 24.8 ms |
| vote | 28 | 17.6 ms | 39.9 ms |
| anonymous_vote | 28 | 3.6 ms | 8.8 ms |
| categories | 1 | 6.5 ms | 6.5 ms |

Checks: 990 passed, 0 failed
