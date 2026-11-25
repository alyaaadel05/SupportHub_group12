SupportHub k6 WORKFLOW load test - 2026-11-25T19:33:51.630Z
Target: http://frontend:8080 (integrated Floci stack, RATE_LIMIT_PROFILE=loadtest)
Duration: 35.5 s   Peak VUs: 14 (6 author, 2 editor, 6 reader)   Throughput: 28.2 req/s

| Metric | Result |
|---|---|
| Total requests | 1001 |
| Setup requests | 11 |
| Author requests | 440 |
| Editor requests | 300 |
| Reader requests | 250 |
| Successful (2xx + expected denials + tolerated 409) | 1001 |
| Failed (unexpected status) | 0 |
| HTTP 2xx | 841 |
| HTTP 4xx | 160 (of which expected authorization denials: 160) |
| HTTP 5xx | 0 |
| Average response time | 56.4 ms |
| Median response time | 32.1 ms |
| P90 | 113.8 ms |
| P95 | 192.7 ms |
| Max | 1548.0 ms |
| Throughput | 28.2 req/s |
| Error rate (unexpected) | 0.00 % |
| k6 http_req_failed rate | 0.00 % |

Per role:
| Role | Requests | 2xx | 4xx | expected denials | 5xx | failed | avg | median | p90 | p95 | max |
|---|---|---|---|---|---|---|---|---|---|---|---|
| setup | 11 | 11 | 0 | 0 | 0 | 0 | 179.6 ms | 53.7 ms | 368.2 ms | 383.4 ms | 398.7 ms |
| author | 440 | 385 | 55 | 55 | 0 | 0 | 50.7 ms | 35.4 ms | 96.2 ms | 143.9 ms | 451.7 ms |
| editor | 300 | 240 | 60 | 60 | 0 | 0 | 91.9 ms | 63.9 ms | 196.2 ms | 251.4 ms | 1548.0 ms |
| reader | 250 | 205 | 45 | 45 | 0 | 0 | 18.3 ms | 16.3 ms | 31.6 ms | 38.6 ms | 89.3 ms |

Per endpoint:
| Endpoint | Requests | avg | p95 |
|---|---|---|---|
| auth_csrf | 5 | 15.9 ms | 45.2 ms |
| auth_login | 5 | 371.0 ms | 392.6 ms |
| articles_mine | 55 | 66.0 ms | 280.3 ms |
| article_create | 55 | 82.1 ms | 319.0 ms |
| article_edit | 55 | 65.6 ms | 148.5 ms |
| article_versions | 55 | 39.7 ms | 81.3 ms |
| article_duplicates | 55 | 43.8 ms | 99.9 ms |
| article_get | 55 | 36.6 ms | 82.2 ms |
| article_submit | 55 | 48.9 ms | 102.4 ms |
| author_tries_review_queue | 55 | 23.3 ms | 94.8 ms |
| reviews_queue | 60 | 91.6 ms | 320.8 ms |
| review_decision | 60 | 65.7 ms | 144.2 ms |
| publication | 45 | 90.3 ms | 246.3 ms |
| editorial_published | 75 | 166.5 ms | 309.6 ms |
| editor_tries_create_article | 60 | 26.3 ms | 73.8 ms |
| public_search | 70 | 22.7 ms | 77.8 ms |
| public_article | 45 | 17.5 ms | 30.0 ms |
| search_click | 45 | 19.3 ms | 31.0 ms |
| vote | 45 | 24.5 ms | 39.3 ms |
| anonymous_vote | 45 | 4.7 ms | 8.2 ms |
| categories | 1 | 41.0 ms | 41.0 ms |

Checks: 990 passed, 0 failed
