# Remaining blockers (human action)

Verified 2026-11-25 on Windows / Docker Desktop, in the isolated stack (`supporthub-iso-*`:
own Floci 2.5.0 and own PostgreSQL) unless a line says otherwise. Neon, Vercel and Cloudflare were
not changed. Statuses: PASS (run and verified), IMPLEMENTED / NOT VERIFIED, FAIL, BLOCKED, OPTIONAL.

1. **Rotate the Neon password (urgent).** It is in Git history (commit d0a2a2b). Then update Vercel and
   the local `.env` files. Skip only if this was already done.
2. **Deploy the final version.** The production site does not send the CSP header defined in this branch.
3. **Test production** with test accounts: login, submit, approve, publish, search, vote. Read-only
   checks passed (`evidence/final/integration/production-read-only-probe-*.txt`).
4. **Rebuild the team containers** (`supporthub-*`) if you demo with them; they were not touched.
5. **Decide** whether publication should retry automatically when Search is down (doc 02).
6. **Check the AI rules** (brief section 11) and disclose AI assistance. Work from this session must
   not be presented as personally written without review and understanding.
7. **Review and sign** the contribution statements. In `06-contribution-statements.md` the Editorial
   test count (169) and "optional sentiment analysis" are out of date: now 175 and local sentiment.
8. Record the demo video, submit on e-learning, attend the discussion.
9. Optional: re-run Gitleaks; review `tests/load/stack/docker-compose.loadtest.yml.backup` before
   committing; that compose file now starts with a byte-order mark.
