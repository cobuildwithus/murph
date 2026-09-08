# Seed the billing matrix activation line

## Goal and scope

Restore the live Starter-to-Pulse browser scenario by configuring its synthetic
Linq home line in the isolated hosted-local database. Test configuration only.

## Evidence and implementation

PR #2825 corrected messaging readiness. Main run 33919057442 now reaches the
Starter enrollment endpoint but receives HTTP 500. Its setup log explicitly
reports that no conversation phone numbers were configured and line seeding
was skipped. Web enrollment requires an assignable home line.

A local PostgreSQL reproduction exercises the real web enrollment service:
with no line it rejects with LINQ_CONVERSATION_PHONE_REQUIRED; after canonical
line seeding the same enrollment succeeds. Configure a reserved synthetic line
through the existing harness environment so its canonical setup seeds the row.

## Verification and delivery

Run the local PostgreSQL diagnostic, focused billing fixture and readiness tests,
Cloudflare typecheck, and complexity guard. Remove the temporary diagnostic
before committing. Required PR CI owns broad proof and the protected main
Stripe workflow owns live sandbox validation. Review the exact diff, merge the
validated head, and inspect the post-merge result.

No production behavior, API, messaging policy, schema, or deployment changes.
Product UX, public changelog, and final ReviewGPT are not applicable under the
test-only route. The parent owns final review.

Local proof passed: 27 tests including the canonical-seeder PostgreSQL
reproduction, Cloudflare typecheck, and complexity guard. Parent final review
confirmed the two-line change is confined to the live test fixture.
Status: completed
Updated: 2026-09-04
Completed: 2026-09-04
