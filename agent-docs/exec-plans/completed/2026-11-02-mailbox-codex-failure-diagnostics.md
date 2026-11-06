# Preserve Codex failure categories in mailbox warnings

Status: completed
Created: 2026-11-02
Updated: 2026-11-02

## Outcome and invariant

Retain a finite Codex provider failure subtype and bounded HTTP status in the
existing system-mailbox warning. Preserve durable pending work, checkpoint
ordering, error classification, quota enforcement, retries, and all external
behavior. This diagnostic does not prove recovery or repair a provider failure.

## Owner and evidence

The assistant engine already attaches structured Codex failure information to
VaultCliError.context. System-mailbox preparation reduces this to code/message,
and workspace phase logging therefore loses the useful subtype. The existing
log event and runtime-log pipeline own this observation. A synthetic provider
failure must demonstrate the omission before implementation.

## Decisions and boundaries

- ReviewGPT authors the small implementation and regression tests.
- Project only a finite literal category plus unknown, and an integer HTTP
  status within the protocol range. Never copy arbitrary context or messages.
- Read only bounded own data properties; accessors, unknown values and reflection
  failures cannot create another processing failure. No generic traversal.
- Carry diagnostics transiently between existing preparation and log owners;
  add no persisted mailbox fields, state owner, dependencies, I/O or log events.
- Prove the current deployed runtime-log parser accepts additive safe metadata.
  Old producers omit it; old readers must accept it before runtime rollout.
- No member-visible product behavior, tool, prompt or delivery change; public
  changelog and live assistant journey are not applicable.
- Thirteen open PR file inventories checked. Two overlapping-file diffs change
  reconnect target removal and automation receipts, not this failure seam.

## Verification and completion

1. Run current focused mailbox and phase-warning tests.
2. Apply authored new proof alone; confirm omission fails on baseline.
3. Apply implementation; prove exception to preparation to existing parsed warning,
   bounded privacy, pending retention, no completion and unchanged retry time.
4. Run focused tests, runtime typecheck, lint, docs drift and complexity review.
5. Parent review, scoped commit, draft PR, final exact-head ReviewGPT and required CI.
6. Merge and canonical deployment under existing authorization. Verify actual
   serving runtime revision; observe immediately and every 30 minutes for four hours.

## Progress

- Isolated owned worktree at base 3a75cbc8; frozen dependency install passed.
- ReviewGPT authored the source and composed tests; accepted response hash and
  preceding-user-turn signature verified. Parent moved the classification guard
  into the same extractor to preserve existing caller complexity.
- New tests alone: 35 expected missing-field failures, 6 preserved passes.
- Implementation: 138 focused tests pass; final localized cleanup reran 47
  affected tests, runtime typecheck and complexity successfully. Existing reader
  parses the added fields; no reader/schema changes.
- Docs drift and diff checks pass. Existing complexity debt/maxima are unchanged
  (system mailbox 12/29, workspace phase 277/115); no new hotspot.
- Local Node 24.14.1 is below the required 24.22.1; exact-head supported CI remains
  mandatory. Runtime package declares no separate lint command.
- Parent review found no privacy, state, timing, authority or external-call change.
- Final exact-head ReviewGPT, required CI and production observation remain the
  shipping gates, tracked in the owning task rather than this closed snapshot.
- Underlying provider failure and eventual repair outcome remain unresolved.
Completed: 2026-11-02
