# Analytics — Calculations and Business Value

All analytics come from **real events stored in Neon** by this service (no hard-coded numbers).
Code: `services/analyticsService.js` → `GET /api/analytics/overview` (reviewer / editor / admin only).
Tests: `tests/analytics-calculations.test.js`.

## 1. Where the data comes from

| Table | One row is created when… | Time column |
|---|---|---|
| `search_query_logs` | someone searches (query text + number of results) | `searched_at` |
| `search_result_clicks` | someone clicks a search result | `clicked_at` |
| `article_views` | someone opens a published article | `viewed_at` |
| `helpfulness_votes` | a logged-in user votes (one row per user per article, updated if they change their vote) | `created_at` |
| `article_feedback` | a logged-in user writes feedback (+ sentiment if available) | `created_at` |
| `search_published_articles` | an article is published (copy used for search) | `published_at` |

**Neon is the source of truth.** DynamoDB only holds live counters for the dashboard
(see `AWS-DYNAMODB.md`); CloudWatch holds operational metrics, not business data.

## 2. Calculations

Percentages use `percent(n, d) = d > 0 ? round(100 × n / d, 2 decimals) : 0`,
so empty data gives **0 %**, never an error or `NaN`.

| Metric | Formula | Meaning |
|---|---|---|
| Total searches | `COUNT(*)` of `search_query_logs` | Demand for help |
| Successful searches | searches with `result_count > 0` | Searches that found something |
| Zero-result searches | searches with `result_count = 0` | Searches that found nothing |
| Search success rate | successful ÷ total × 100 | How often users find an answer |
| Zero-result rate | zero-result ÷ total × 100 | How often the knowledge base fails |
| Searches with clicks | distinct `search_id` in `search_result_clicks` | Searches where a result looked useful |
| Click-through rate | searches with clicks ÷ total × 100 | Are results relevant enough to open? |
| Total article views | `COUNT(*)` of `article_views` | Reading activity |
| Total / helpful / unhelpful votes | `COUNT(*)`, `FILTER (WHERE helpful)`, `FILTER (WHERE NOT helpful)` | Reader satisfaction |
| Helpfulness rate | helpful ÷ total votes × 100 | Overall content quality |
| Most-searched terms | `LOWER(query_text)` grouped, top 10 by count | What users need most |
| Knowledge gaps | same, but only `result_count = 0`, top 10 | Topics users search for that have **no article** |
| Most-viewed articles | views per published article + helpful / unhelpful votes, top 10 | Most important articles |
| Trending articles | views in the **last 7 days**, top 5 | What is popular **now** (all-time totals can hide this) |
| Daily activity | searches, views and votes for each of the last 7 days; `generate_series` fills empty days with 0 | Usage trend over time |
| Poorly rated articles | articles with **at least `POORLY_RATED_MIN_VOTES` votes (default 3)** **and** more unhelpful than helpful votes; ordered by lowest helpfulness rate | Articles that need rewriting |
| Sentiment breakdown | `article_feedback` grouped by `sentiment_label` where analysis completed | Tone of written feedback |

### Sample-size rule
One unhappy reader should not mark an article as bad. An article only appears in
**Poorly rated** after at least 3 votes (configurable). Live check on 21 Nov: an article
with 1 unhelpful vote (0 % helpful) was correctly **not** listed.

### Worked example (automated test)
10 searches, 8 with results, 2 without, 4 clicked; 4 votes (3 helpful, 1 unhelpful):
success rate **80 %**, zero-result rate **20 %**, click-through **40 %**, helpfulness **75 %**.
2 of 3 successful → **66.67 %** (rounded to 2 decimals). No data → all rates **0 %**.

## 3. Business value — what a reviewer does with this

| Question | Metric that answers it | Action |
|---|---|---|
| What are users looking for that we don't have? | **Knowledge gaps**, zero-result rate | Write new articles for those terms (e.g. "router" and "billing" have many searches but no article) |
| Which articles are confusing or outdated? | **Poorly rated articles**, unhelpful votes, sentiment | Rewrite or update them |
| Are search results relevant? | Click-through rate, success rate | Improve titles, categories or ranking |
| What is important right now? | **Trending articles**, daily activity | Keep popular articles up to date; spot sudden spikes (e.g. an outage) |
| Is the knowledge base improving? | Success rate and helpfulness rate over time | Measure the effect of new or rewritten articles |

## 4. Interpreting the current numbers carefully

- **Load tests inflate search counts.** The 19 Nov spike (~16,800 searches) and the very high
  counts for "login", "account", "router", "billing", "email" and "password" come from k6 load
  tests, not real users. In a real report these should be filtered out or reset.
- **Security tests appear as terms** (e.g. `'; drop table search_query_logs; --`). They are stored
  as plain text, which also proves the SQL-injection protection works.
- **Small samples:** with very few votes, helpfulness percentages swing a lot (1 vote = 0 % or 100 %).
  The minimum-vote rule protects the "poorly rated" list; the overall rate should be read together
  with `totalVotes`.
- **Time zone:** daily activity uses UTC days.
- **Sentiment** uses free local word-based classification (POSITIVE, NEGATIVE, NEUTRAL); feedback is
  still saved (see `SECURITY.md` S20).

## 5. Privacy

Analytics and CSV exports contain only **aggregates** (counts, rates, article titles, search terms).
No user IDs, emails, sessions or feedback authors are exported. Export cells are protected against
CSV injection (see `SECURITY.md` T9).