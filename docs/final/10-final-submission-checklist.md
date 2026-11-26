# Final submission checklist

Verified 2026-11-25 on Windows / Docker Desktop, in the isolated stack (`supporthub-iso-*`:
own Floci 2.5.0 and own PostgreSQL) unless a line says otherwise. Neon, Vercel and Cloudflare were
not changed. Statuses: PASS (run and verified), IMPLEMENTED / NOT VERIFIED, FAIL, BLOCKED, OPTIONAL.

- [x] Neon password rotated (done 2026-11-26; old credential rejected, services on restricted roles:
      `evidence/production-security/database-credential-rotation.txt`)
- [ ] All local changes reviewed by their owners
- [ ] Commits made by the right student for their own component
- [ ] Final version deployed; CSP header visible on the production site
- [ ] Production end-to-end demo done with test accounts
- [ ] Group technical report assembled (start: `02-technical-evidence-pack.md`)
- [ ] Contribution statements corrected and signed
- [ ] AI use disclosed according to the module rules
- [ ] Repository link added to the report
- [ ] Video of at most five minutes recorded (`07-demo-plan.md`)
- [ ] Submitted on e-learning
- [ ] Each student rehearsed: demo, one rejected request, logs, limitations
- [x] Unit tests 370/370
- [x] End-to-end 47/47, browser 20/20, resilience 60/60
- [x] IAM 47 pass, 0 fail, 1 emulator limit
- [x] Load test 1,001 requests with role breakdown
- [x] Production rate limits 4/4
