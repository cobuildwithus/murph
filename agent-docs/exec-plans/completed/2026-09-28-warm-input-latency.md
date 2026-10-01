# Reduce foreground system-mailbox preparation cost

Status: completed
Created: 2026-09-28
Updated: 2026-09-28

## Outcome and scope

Reduce actual foreground preparation work without changing typing placement.
The existing system-mailbox owner should avoid acquiring a write lock when a
read-only snapshot has no candidate for this pass. Conversation occurrence
reads are deferred until the snapshot contains a candidate, then resolved outside
the write lock to preserve short critical sections.
No new persisted state, cache, queue, protocol, or authority is introduced.

Outcome: ordinary replies reach execution with fewer filesystem operations.
Reaches: fresh and restored conversations, including shared runtime write-lock contention.
Proof: deterministic contention, cutoff, stale-positive and later-arrival tests;
existing mailbox ordering/recovery tests; package typecheck.

## Evidence and invariants

Source inspection shows every preparation takes the shared runtime write lock,
even when selection returns null. Foreground selection eagerly reads current
input records before learning whether there is an assistant completion.
Tests must demonstrate the unnecessary wait before optimization.

The unlocked snapshot can only reject a selection, never authorize execution.
Positive candidates are re-read and selected under the existing write lock.
Items arriving after a negative snapshot remain durably queued for a later pass.
Completion chronology, consent, checkpointing, retries, and retained device hint
retirement remain owned by the same code. No production mutation is authorized.

## Tasks

1. Reproduce unnecessary empty-selection locking and eager cutoff reads.
2. Add a read-only negative preflight and defer cutoff resolution until needed.
3. Verify positive-selection revalidation, late arrivals, ordering, and recovery.
4. Run focused tests/typecheck, review diff, and commit the scoped result.

## Risks and rollout

A stale positive snapshot must not resurrect removed or changed work; locked
selection remains authoritative. A negative snapshot must not consume or clear
work. Readers and writers keep the same persisted schema and wire contracts;
mixed runtime versions retain ordinary compatibility. Production savings need
post-deploy measurement; synthetic timing is not a production latency estimate.

## Verification

- Regression proof: before the change, three empty preparation passes wrote
  three runtime lock metadata files. After the change, they write zero and
  resolve no conversation cutoff. Both missing and persisted empty state pass.
- A real held runtime write lock cannot block a negative selection. Stale
  positive snapshots are revalidated; later arrivals survive a negative read.
  Static and lazy cutoffs preserve strict completion ordering, including null,
  malformed, equal, earlier, and later timestamps.
- `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts`
  with `hosted-runtime-system-mailbox-empty.test.ts`,
  `hosted-runtime-system-mailbox-notification.test.ts`,
  `hosted-runtime-workspace-assistant-phase-foreground.test.ts`, and
  `hosted-runtime-workspace-entrypoint-causal-input.test.ts`: 313 passed.
- `pnpm --filter @murphai/assistant-runtime typecheck`: passed.
- `pnpm complexity:diff`: passed; system-mailbox debt unchanged, workspace
  assistant-phase debt reduced by three. Existing unrelated hotspots remain.
- `pnpm --dir apps/web changelog:generate` and the focused
  `apps/web/test/changelog-page.test.tsx` run: passed, 10 tests.
- The broader system-mailbox entrypoint file had six failures. The same six
  were reproduced with unchanged base production source: daily-metric and
  dirty-ack projection cases. Tracked in the task-owned Frog entry; no unrelated
  production code was changed to work around them.

Product UX: Ready for local candidate review. Typing placement, channel routing,
completion precedence, and delivery policy remain unchanged. No provider-input
text, tools, model settings, or network calls change. Positive selections add
one bounded local state read, while empty selections remove write-lock
acquisition/release and foreground occurrence reads. Conversation timestamp
reads remain outside the write critical section.

Changelog: updated, `less-wait-before-reply-preparation`; no numeric production
claim. Parent candidate review checked stale reads, atomic state publication,
late arrivals, cutoff failures, and unchanged device hint retirement.

This is a local candidate only. PR publication, exact-head CI and final
ReviewGPT, deployment, and production latency measurement have not been run.

Completed: 2026-09-28
