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
watermark because the receipt was already durable. The callback now always
checkpoints dirty mailbox progress when a canonical receipt exists, including
idempotent imports whose receipt is already durable. Exact usage-denial codes
are also recognized through the transport cause chain so the active invocation
ends cleanly instead of preserving its write fence as an authorization failure.

A subsequent full matrix passed the mailbox recovery scenario and isolated the
remaining rejected-snapshot failure: its five receipts were internally ordered,
but the first append base was absent from the prior published snapshot. Snapshot
archive construction and publication did not hold the canonical-write lock, so
a canonical mutation could change the local base across that boundary. The v2
snapshot transaction now holds the existing lock through publication, and a
focused bridge test proves a canonical writer cannot enter during that window.
The final coverage/write audit tightened that proof to queue one writer while
archive construction is blocked and keep it excluded through upload and
publication; this guards the entire documented boundary rather than only the
completion call.

Final-head CI and the local full-stack scenario then proved a second ordering
defect behind the same fallback: the prior snapshot was valid but shorter than
the first pending audit append base. The outer initial mailbox import bypassed
the runner's canonical mailbox-write port, so its canonical inbox/audit effects
had no receipt even though later managed-automation receipts depended on those
bytes. The initial import now runs as a mailbox-only pass through the same
runner primitive as later imports. It preserves the existing bootstrap lanes,
conversation deferral, prefetch, and deferred enrichment timing while
atomically checkpointing any canonical receipt with the imported watermark.
Cold restore can therefore replay the complete receipt sequence over the prior
snapshot before reimporting already-accounted mailbox rows.

Focused assistant-runtime tests (87), Cloudflare mailbox-port tests (3), the
snapshot-bridge suite (25), the workspace entrypoint suite (206), and both
package typechecks pass. The exact hosted-local snapshot-publication fallback
scenario now passes through the intentional rejection, cold restore, second
reply, and clean replacement snapshot. Final affected verification passes all
repository guards, the assistant-runtime typecheck and 1,528 tests, plus the
Cloudflare app typecheck and 1,734 tests. The final coverage/write audit added
entrypoint proof that the initial mailbox checkpoint atomically carries the
receipt fingerprint, both mailbox watermarks, and workspace-version advance;
the focused suite, typecheck, and affected verification still pass. The final
security/privacy audit found no medium-or-higher issue. Scoped commit, push,
and final-head CI remain.
