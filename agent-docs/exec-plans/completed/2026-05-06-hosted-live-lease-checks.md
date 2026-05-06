# Hosted Live Lease Checks

## Goal

Reintroduce live Durable Object lease validation on hosted runner outbound side-effect paths so stale invocations fail closed before externally visible effects.

## Constraints

- Keep the fix simple: direct live lease checks at side-effect boundaries; no cache unless later measurements prove it necessary.
- Preserve unrelated dirty work in the checkout, especially hosted-local HTTP bridge edits in `results.ts` and `web-control.ts`.
- Do not change provider payloads, log payload bodies, or expose identifiers.
- Use focused stale-lease tests where `ownsActiveInvocationLease` returns false and the side effect returns 401.

## Plan

1. Route provider effects, email send, mailbox payload decode, artifact PUT, browser-vault writes, and workspace checkpoint proxying through the existing live lease helper.
2. Keep write-header/body consistency checks for checkpoint and write-style routes.
3. Update focused `runner-outbound` tests from no-DO-call expectations to live-lease/stale-lease behavior.
4. Run focused Cloudflare outbound tests, Cloudflare typecheck, and Workers probe where relevant.
5. Complete required security/privacy and final review audits before commit.

## Verification

- PASS: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-outbound.test.ts --no-coverage` (78 tests)
- PASS: `pnpm --dir apps/cloudflare typecheck`
- PASS: `pnpm --dir apps/cloudflare test:workers` (1 test)
- PASS: `pnpm --dir apps/cloudflare verify` (64 files / 793 tests)

## State

- Live Durable Object lease validation now gates provider effects, email sends, mailbox payload decode, artifact PUTs, browser-vault writes, and workspace checkpoint proxying.
- Security review found body parsing before live lease validation on provider effects, mailbox decode, and checkpoint proxying; fixed by moving live checks earlier.
- Simplify review found no simplification changes worth making.
- Final review pending.
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
