# SupportHub — Performance and Reliability

Automated Article tests: 46/46 passed
Automated Identity tests: 6/6 passed

## Article health test
100 requests, 20 concurrent clients
100 HTTP 200 responses
Average 351.13 ms; P95 785.47 ms
Throughput 51.25 requests/sec

## Identity health test
100 requests, 20 concurrent clients
100 HTTP 200 responses
Average 358.55 ms; P95 755.02 ms
Throughput 52.03 requests/sec

## Concurrent Identity logins
10 successful logins / 10 attempts
10 authenticated sessions
Average 4668.94 ms; P95 4758.60 ms

## Concurrent Article submissions
8 submitted / 8 attempts
Submission duration 1.49 seconds
8 events automatically published to Floci SQS

## Outbox recovery
Failed SQS connection recorded as ECONNREFUSED
Event remained pending after failure
Automatic retry changed status to published
Final attempts: 2; last_error: null

## Important limitations
Health endpoint load is not full application load
8 submissions do not prove horizontal scaling
Editorial consumption is not yet verified
