# Bound consented group-share freshness

## Goal

Prevent routine personal-runtime device-sync dirty wakes from indefinitely
starving the existing consented vault-share projection offer, while preserving
fresh human-message and explicit device-command priority and the current
Web-owned share/control boundary.

## Proven production symptom

- A personal runtime had current wearable data while both active group step
  projections remained on an older snapshot.
- Runtime logs showed successful checkpoints followed by repeated pending
  `device-sync.wake` work. The projection refreshed only after the runtime
  eventually obtained a long enough idle window.
- The provider connection, device-sync dirty handoff, mailbox watermarks,
  grants, and group read path were healthy. The failing boundary is the
  personal runtime's best-effort outbound projection scheduling.

## Architecture constraints

- Foreground human input and explicit device lifecycle/manual work remain
  strictly higher priority than projection and background dirty maintenance.
- Web remains the owner of active grants and encrypted group snapshots; the
  personal runtime remains the only reader of personal vault source data.
- Reuse the existing checkpoint and runtime-wake loop. Do not add another
  scheduler, queue, persisted freshness state, or group-side device-sync path.
- A projection must never expose source state that has not first passed the
  existing successful checkpoint boundary.
- Keep best-effort projection failure isolated from primary runtime work, but
  make repeated dirty-hint churn unable to starve a bounded refresh forever.
- Shutdown remains authoritative: do not import mailbox rows or enter/re-enter
  projection after the retiring invocation observes shutdown.

## Implementation

1. Ask ReviewGPT for the smallest maintainable patch and regression test,
   grounded in the production timeline and current runtime loop.
2. Inspect the returned patch as untrusted intent, reject new ownership or
   speculative abstractions, and apply only the minimal proven correction.
3. Add focused runtime coverage proving repeated dirty wakes cannot starve an
   active post-checkpoint projection while fresh conversation and explicit
   device commands still preempt it.
4. Prove transient classifier failure reuses the existing foreground refetch,
   exact successful prefetches are reused once with serial fetch concurrency,
   and shutdown produces an immediate replacement-runtime handoff.
5. Run focused runtime tests and affected typecheck, then complete the required
   ReviewGPT gates on the exact pushed PR head.
6. Complete the parent review, close this plan, and commit the scoped result.

## Review findings resolved in the candidate

- Preliminary specialists accepted: initial classifier rejection currently
  bypasses the existing foreground refetch; shutdown timing assertion is too
  weak; exact prefetch reuse and peak fetch concurrency need deterministic
  proof.
- Final round 1 accepted: classification waits need shutdown checks before and
  after each await; the retained-import-after-shutdown mode should be deleted;
  only production `device-sync:dirty:` hints may defer behind projection; the
  initial classification failure must fall back to ordinary foreground work.
- No finding requires a new owner, protocol, persisted state, scheduler, or
  compatibility layer. Remediation should simplify the source patch.
- One additional parent-review race was closed at the ordinary foreground
  prefetch boundary: shutdown now wins while a classifier-fallback fetch is in
  flight, while a live transient failure still reaches the existing single
  refetch owner.

## Round 2 requirement-level retrospective

- Trigger: round 2 found that the accepted source-classification correction
  still treated a bounded visible prefix as the complete pending system lane.
  A full dirty prefix can therefore hide a later explicit device command, the
  same underlying source-evidence gap as round 1.
- Original requirement: dirty hints may wait behind checkpointed projection,
  but explicit device commands and human work remain foreground at the maximum
  admitted backlog.
- Shape comparison: the first-reviewed source patch was 279 additions and 100
  deletions. The round-2 head was 303 additions and 91 deletions after adding
  shared classification, dirty-prefix provenance, exact-prefetch fallback,
  shutdown authority, and replacement handoff while deleting partial import
  after shutdown. Review-driven tests grew from 588 to 1,180 added lines.
- Decision: continue with a shrinking correction at the existing classifier.
  Deferral requires the same bounded response to prove that the visible system
  suffix reaches its lane-wide `maxSeqByLane` high-water; incomplete or invalid
  evidence fails open to foreground import. Reuse the one existing serial read,
  exact prefetch, and durable mailbox continuation. Add no owner, state, queue,
  lease, fence, lifecycle, or reconciliation path.
- Required composed proof: fill the visible prefix entirely with dirty hints,
  place an explicit command immediately beyond it, prove projection yields to
  foreground continuation until the command is imported, and retain peak fetch
  concurrency one.

## Verification

- Focused regressions reproduce the old repeated-dirty starvation and prove a
  projection delivery occurs without weakening foreground priority.
- Existing vault-share cancellation, failed-checkpoint, mailbox-wake, and
  device-sync scheduling tests remain green.
- `@murphai/assistant-runtime` typecheck passes.
- Exact-head CI and the required later ReviewGPT round pass after remediation.
- Direct code-path review confirms no new persisted state, scheduler, queue,
  raw health-data logging, or group-runtime device sync was introduced.

## Local proof completed

- Six focused entrypoint regressions pass, including maximum-prefix dirty-wake
  pressure, exact fetch reuse and peak concurrency, transient classifier
  fallback through assistant admission, both classification shutdown windows,
  failed-classifier fallback shutdown, and explicit lifecycle/manual-command
  preemption.
- The complete hosted-runtime entrypoint test file and package typecheck pass.
- The complete assistant-runtime coverage suite passes: 86 files, 2,171 tests,
  with 4 skipped. Two pre-existing shutdown expectations were updated to the
  reviewed no-import, immediate-replacement contract after the first exact-head
  CI run exposed them; the consumed-replay case also proves the replacement
  invocation imports the still-durable row.
- The Cloudflare due-wake owner-release regression and agent-doc drift check
  pass.
- Final exact-head ReviewGPT round 2 required the retrospective above. Its
  production-shaped maximum-prefix reproduction now fails against the reviewed
  head and will gate the shrinking correction and next exact-head round.

Status: in progress
Updated: 2026-08-11
