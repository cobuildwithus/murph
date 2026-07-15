# Bind hosted runner principal

## Goal

Close the hosted runner-to-Worker principal-binding defect at the existing
route owners without adding another identity source or dispatch layer.

Success criteria:

- Internal runner requests require an exact active runtime write fence that
  binds the claimed member, attempt, and lease generation before dispatch.
- A mismatched member, missing or stale fence, or unavailable fence validation
  fails before web callbacks, storage reads, or durable mutations.
- Legitimate active-runtime requests retain their existing routes, request
  shapes, callback semantics, and write-fence checks.
- The deliberately unattributable, log-only container-fatal route keeps its
  documented pre-binding exception.
- Focused regression tests and required specialist audits pass locally; any
  unrelated repository-wide acceptance failure is isolated and documented.
- ReviewGPT, PR CI, and merge-conflict proof pass on the final pushed head.

## Constraints

- Use the existing UserRunner runtime write fence; do not add a second identity
  store, mapping table, token, or lifecycle mechanism.
- Do not derive authority from Cloudflare `ctx.containerId`: production treats
  it as opaque and prior identity inference through it was removed.
- Keep runtime authority headers single-owned by the existing transport or
  operation-specific client.
- Do not expose member identifiers, mailbox content, workspace content,
  provider data, credentials, local account names, or home paths in committed
  artifacts or logs.
- Preserve unrelated worktree and coordination-ledger changes.
- Do not duplicate the independent meal-photo or Family-checkout PRs.

## Approach

1. Revalidate the current source-to-sink path and Cloudflare container context
   semantics on the current `origin/main` head.
2. Add focused boundary tests that prove a request header cannot select a
   different member and that a legitimate active runtime still succeeds.
3. Require the existing exact active runtime write fence at each owning route,
   validating the claimed member against UserRunner before any private read or
   effect. Delete the web-control route's partial operation list in favor of
   one uniform allowlisted-route rule.
4. Attach that existing fence to the legacy artifact-read and diagnostic-log
   clients, the legitimate internal paths that currently omit it.
5. Preserve the narrow container-fatal diagnostic exception before route
   dispatch.
6. Update durable architecture/security documentation for the enforced
   identity source and deploy-skew behavior.
7. Run focused proof, full acceptance, required local audits, scoped plan
   closure, PR publication, ReviewGPT, CI, and final base-conflict proof.

## Verification

- Focused Cloudflare runner-egress suite: 4 files and 606 tests passed.
- Cloudflare owner lane: 103 files and 1,778 tests passed.
- Coverage-write follow-up: `runner-platform.test.ts`, 120 tests passed.
- `pnpm verify:acceptance` passed repository policy checks, full workspace
  typecheck, documentation checks, runtime artifact preparation, CLI package
  shape, artifact hygiene, and fixture smoke coverage. Its later parallel app
  coverage phase did not complete because unrelated suites exceeded their
  50-60 second resource limits; the two relevant Cloudflare fixtures surfaced
  before that failure were corrected and the full Cloudflare owner lane then
  passed.
- Mandatory `security-privacy-review`: zero qualifying critical, high, or
  medium findings.
- Mandatory `coverage-write`: one test-only assertion gap corrected; no
  remaining coverage gap.
- Parent diff, call-path, simplification, deploy-skew, and privacy review
  completed.
- Post-push gates: ReviewGPT zero accepted findings, green PR CI, and final
  base-conflict proof on the exact PR head.

## State

Active.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
