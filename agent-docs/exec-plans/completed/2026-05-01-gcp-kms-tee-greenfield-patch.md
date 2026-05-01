# GCP KMS TEE Greenfield Patch

## Goal

Land the supplied greenfield hosted crypto patch against the current checkout, preserving the existing signed web crypto-context authority and moving Cloudflare production runtime key access to that signed callback path.

Success criteria:

- Cloudflare hosted execution no longer imports the old user-key-store authority for production runtime roots.
- Cloudflare fetches signed runtime crypto context from web and unwraps only allowed ingress/runtime recipient envelopes.
- Web-side hosted crypto envelope hardening, KMS production guards, and signed envelope validation remain fail-closed.
- Existing unrelated dirty work is preserved.
- Focused tests, typecheck, required audit passes, and the scoped completion/commit flow are handled or explicitly blocked with evidence.

## Constraints / Assumptions

- Treat the patch as behavioral intent because it does not apply cleanly to the current dirty checkout.
- Do not expose local user identifiers, secrets, raw keys, or `.env` contents.
- Do not revert unrelated active ledger work.
- This is high-risk hosted crypto/auth/runtime work; use security/privacy review and normal completion review.
- Cloudflare must not gain GCP KMS decrypt authority.

## Key Decisions

- Use a new plan name rather than reviving the already-closed hosted GCP KMS crypto plan artifact.
- Port manually over current source files and keep existing in-tree hardening that already landed.

## State

completed

## Done

- Loaded repo workflow, security, reliability, verification, and Cloudflare skill guidance.
- Confirmed the supplied patch fails `git apply --check` on current checkout.
- Landed the hosted crypto GCP KMS envelope/signing path, signed web runtime
  crypto-context callback, Cloudflare ingress/runtime unwrap path, production
  static-token guard, and focused Cloudflare/web coverage in scoped commits.
- Added web-side boundary coverage for signed ingress/runtime context envelopes.
- Tightened optional recovery and TEE recipient env validation to fail closed on
  partial configuration.
- Ran focused hosted crypto tests, focused Cloudflare runtime crypto-context
  tests, web typecheck, root typecheck, docs drift, diff-check, and privacy scan.

## Now

- Done. Code changes are committed in scoped hosted-crypto commits.

## Next

- None for this task. Remaining active ledger dirt is unrelated overlapping work.

## Open Questions

- None.

## Working Set

- `apps/web/src/lib/hosted-crypto/**`
- `apps/web/prisma/migrations/**`
- `apps/web/test/hosted-crypto*.test.ts`
- `packages/runtime-state/src/hosted-domain-crypto.ts`
- `packages/hosted-execution/src/routes.ts`
- `apps/cloudflare/src/**`
- `apps/cloudflare/test/**`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
