Goal (incl. success criteria):
- Replace PR #560 with the smallest maintainable implementation of silent Linq group-reaction context.
- A validated reaction may inform the next natural message turn in the same established group, but never wakes Murph, reopens an active turn, or invalidates queued delivery.
- Success means a compact base-to-head diff, focused production-path coverage, required audits with no unresolved findings, green CI, and a passing exact-head ReviewGPT round on a new PR.

Constraints/Assumptions:
- Start from current `main`; do not copy PR #560 wholesale or modify/close its branch.
- Snapshot semantics are intentional: only context already available when a later actionable turn is selected can inform that turn.
- Reuse the existing one-shot group-route context seam and fold one bounded snapshot into the next ordinary message before it enters the assistant-input lifecycle; add no reaction mailbox kind, wake, assistant candidate, queue cursor, reconciliation loop, or delivery-commit guard.
- Treat Linq payloads and reacted-message content as sensitive untrusted data; keep validation, bounds, and account/route authority explicit.
- Preserve unrelated worktrees, processes, active plans, and ReviewGPT runs.

Key decisions:
- Prefer a narrow producer-to-existing-input path over mid-turn causal invalidation.
- Keep one encrypted, latest-write-wins snapshot on the established group route, analogous to the existing participant-addition hint. It is optional lossy ingress context, not product truth or a queue, and the next normal group-message transaction consumes it into the existing tolerant mailbox-input sidecar.
- Missing, malformed, or crypto-unavailable optional context must fail open for the ordinary inbound message; reaction facts never become assistant reply candidates themselves.
- If an existing primitive cannot express silent context without new lifecycle machinery, narrow the product behavior rather than adding machinery.
- Keep tests proportional: prove trust-boundary rejection, silence, same-group inclusion, and cross-group exclusion without duplicating broad assistant lifecycle suites.

State:
- In progress: rebase the latest `main`, then shared-host verification.

Done:
- Reconstructed PR #560 growth and identified review-driven mid-turn invalidation as the main complexity ratchet.
- Created an isolated branch from current `main`.
- Implemented one encrypted, account-bound route snapshot that folds into the next ordinary group message without creating a reaction mailbox item or wake.
- Carried the bounded context through the existing mailbox sidecar and rendered it only as a quoted weak/untrusted prompt hint.
- Added focused ingress, privacy, route transaction, contract, sidecar, prompt, and captureless-turn proof; the coverage-write audit has no unresolved findings.
- Rebased cleanly onto PR #640 and enabled its shared-host verification profile with host concurrency left at the default of one.
- Corrected reaction account authority to derive the sole active self line from the canonical live roster instead of relying on an undocumented webhook field.
- Deleted the speculative account filter on the generic route reader, unused ignored-reason taxonomy, and unnecessary reaction-target part wrappers identified by the simplification pass.
- Kept authoritative join-offer reactions out of ambient next-message context; the simplification review has no remaining findings.
- Added the canonical `is_from_me` fast rejection so self-reactions stop before route or provider reads.

Now:
- Complete the queued local verification and rerun CI after deleting the obsolete participant-only prompt mock exposed by assistant coverage.

Next:
- Run the parent final review, close the plan with the scoped commit, push, open the replacement PR, and run ReviewGPT concurrently with CI.

Open questions (UNCONFIRMED if needed):
- None. Snapshot semantics are the working product decision unless current code proves they cannot preserve the stated outcome.

Working set (initial; narrow as investigation resolves ownership):
- apps/web/src/lib/hosted-onboarding/**
- apps/web/test/hosted-onboarding-*.test.ts
- packages/hosted-execution/src/**
- packages/hosted-execution/test/**
- packages/assistant-runtime/src/hosted-runtime/**
- packages/assistant-runtime/test/**
- packages/assistant-engine/src/assistant/hosted-mailbox-input-items.ts
- packages/assistant-engine/src/assistant/input-source.ts
- packages/assistant-engine/src/assistant/automation/{prompt-builder,reply}.ts
- agent-docs/product-specs/**
- ARCHITECTURE.md
