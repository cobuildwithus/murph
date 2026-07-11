# PR 556 Hosted E2E Recovery

## Goal

Make PR 556's hosted regression gates merge-ready by correcting the two
production control-flow failures exposed by the final hosted E2E matrix:
usage-gated mailbox wakes must end cleanly, and a rejected snapshot publication
must remain recoverable from the prior snapshot plus canonical receipts.

## Constraints

- Preserve the mailbox usage gate, canonical append validation, and atomic
  mailbox-watermark/receipt checkpoint invariant.
- Keep changes narrow; do not add new persisted state, retry managers, or
  compatibility machinery.
- Do not run ReviewGPT or browser review in this recovery batch.
- Do not signal or terminate processes not started by this session.
- Run focused tests, affected tests/typechecks, mandated completion audits, and
  final-head CI before handoff.

## Plan

1. Prove both failures from final-head CI logs and their source paths.
2. Add focused regression tests for controlled mailbox denial and receipt-based
   snapshot fallback.
3. Implement the smallest production corrections and run focused verification.
4. Run affected verification and mandated audits, then commit and push.
5. Resolve final CI/review feedback, update the required checks and PR body, and
   stop before ReviewGPT with the requested recovery token.

## Verification

- Focused tests for each corrected path.
- `pnpm test:diff` for all touched files with constrained workspace concurrency.
- Final GitHub hosted E2E matrix and stable aggregate gates at the pushed head.

## State

Active. CI proved that an assistant checkpoint could publish a mailbox receipt
before the import watermark, after which the mailbox callback skipped the
watermark because the receipt was already durable. The same race left the
rejected-snapshot scenario with conversation sequence zero and a five-receipt
audit chain whose first append base was absent from the prior published
snapshot. The callback now always checkpoints dirty mailbox progress when a
canonical receipt exists, including idempotent imports whose receipt is already
durable. Exact usage-denial codes are also recognized through the transport
cause chain so the active invocation ends cleanly instead of preserving its
write fence as an authorization failure.

Focused assistant-runtime tests (87), Cloudflare mailbox-port tests (3), and
both package typechecks pass. The pre-fix full affected diff gate passed all
affected tests, typechecks, builds, lint, and dev smoke; final affected
verification remains required after the recovery commit.
