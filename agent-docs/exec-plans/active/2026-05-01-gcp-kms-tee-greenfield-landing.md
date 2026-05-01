# GCP KMS TEE Greenfield Landing

## Goal

Finish landing the supplied GCP KMS TEE greenfield hosted crypto patch against the current dirty checkout.

Success criteria:

- Production Cloudflare call sites use the signed web runtime crypto-context route for ingress/runtime roots.
- Web-side hosted crypto hardening from the patch is present without overwriting unrelated changes.
- Focused tests, owner typechecks, required audit passes, and scoped commit handling are completed or blocked with evidence.

## Constraints / Assumptions

- The supplied patch is stale and does not apply cleanly.
- Preserve unrelated dirty work, including active Cloudflare runner alarm/test edits.
- Do not expose local user identifiers, secrets, raw credentials, or `.env` contents.
- High-risk crypto/auth/runtime boundary work requires security/privacy review and final task review.

## Key Decisions

- Keep the earlier externally closed `gcp-kms-tee-greenfield-patch` completed artifact untouched.
- Use this active plan for the remaining manual patch landing and completion workflow.

## State

in_progress

## Done

- Added shared hosted runtime crypto-context route export.
- Added Cloudflare web-backed runtime user crypto context and removed the R2 key-authority path from production call sites.
- Removed dead activation-bootstrap compatibility code and updated local dev/runtime env sanitization to use only the new hosted-crypto key surface.
- Applied web/runtime crypto hardening and focused tests.
- Focused Cloudflare/web/runtime-state tests passed.
- Cloudflare, hosted-web, runtime-state, and hosted-execution owner typechecks passed after a test env fix.

## Now

- Review diff shape, run required audit passes, then run final verification.

## Next

- Address audit findings if any.
- Run scoped/full verification as allowed by current dirty-tree state.
- Use `scripts/finish-task` if a safe scoped commit is possible.

## Open Questions

- UNCONFIRMED: whether the current dirty tree will permit a scoped commit without overlapping active work.

## Working Set

- `apps/cloudflare/src/hosted-crypto/runtime-user-crypto-context.ts`
- `apps/cloudflare/src/hosted-crypto/runtime-crypto-context.ts`
- `apps/cloudflare/src/hosted-email/worker-ingress.ts`
- `apps/cloudflare/src/runner-outbound/shared-web-control-policy.ts`
- `apps/cloudflare/src/runner-outbound/shared.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/worker-routes/shared.ts`
- `apps/cloudflare/test/hosted-runtime-crypto-context*.test.ts`
- `apps/cloudflare/test/runner-outbound.test.ts`
- `scripts/dev-hosted-local/**`
- `apps/web/prisma/migrations/20260501000001_hosted_user_crypto_envelope_hardening/migration.sql`
- `apps/web/src/lib/hosted-crypto/**`
- `apps/web/test/hosted-crypto*.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/environment.ts`
- `packages/hosted-execution/src/routes.ts`
- `packages/runtime-state/src/hosted-domain-crypto.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
