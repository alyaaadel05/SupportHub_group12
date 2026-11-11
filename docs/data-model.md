
# SupportHub Data Model

## Users
Stores registered accounts.

Fields:
id, name, email, password_hash, role, created_at

## Categories
Stores knowledge base categories.

Fields:
id, name, created_at

## Articles
Stores knowledge base articles.

Fields:
id, title, content, category_id, author_id,
status, review_comment, views, created_at,
updated_at, published_at

## Reviews
Stores editorial decisions.

Fields:
id, article_id, reviewer_id, decision,
comment, created_at

## Feedback
Stores article helpfulness votes.

Fields:
id, article_id, voter_id, helpful, created_at

## Search Logs
Stores submitted search terms.

Fields:
id, term, created_at

## Audit Logs
Stores application security and workflow events.

Fields:
id, user_id, action, target_id,
details, created_at

## Sessions
The connect-pg-simple session store maintains
persistent authentication sessions.

## Relationships
- One user can author many articles.
- One category can contain many articles.
- One article can have many reviews.
- One article can receive many feedback entries.
- Each review belongs to one reviewer.

## Integrity Controls
- Foreign keys
- Unique email addresses
- Unique category names
- Role constraints
- Article status constraints
- Unique article/voter feedback pairs

