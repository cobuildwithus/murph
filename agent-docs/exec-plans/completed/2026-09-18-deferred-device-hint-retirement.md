# Retire device hints already transferred to retained work

Status: completed
Created: 2026-09-18
Updated: 2026-09-18

## Outcome and invariant

An accepted plain device webhook already deferred to its durable continuation
must not hold the mailbox handling frontier until a historical job retries.
Preserve every exact retained job, provider backoff, authority binding, fresh
dirty-work admission and foreground priority.

## Owner and evidence

The system mailbox owns both the retained continuation and redundant hints.
Post-checkpoint retention assigns unabsorbed hints the owner's retry deadline,
but idle retirement removes only superseded schedules. A deferred webhook thus
blocks handling even after the canonical dirty acknowledgement succeeds.
Reproduce this with synthetic persisted state before correcting the owner.

## Scope and approach

Extend the existing coverage and retirement path to plain covered webhook hints
with the same future retry as a validated continuation. Reuse post-checkpoint
retention and post-import retirement for new and restored state. No new state,
queue, provider calls, alert suppression, schema, or retry policy.
Equal/newer scheduled cadence remains an independent reconciliation requirement.

## Product UX

Outcome: reflect durable transfer accurately without delaying new wearable work.
Reaches: retained history retries, deferred duplicate hints, fresh arrivals,
authority barriers, and cold restore.
Proof: deterministic coverage, persisted mailbox, and composed restore tests.
Model behavior, prompts, tools, and replies are outside this change.

## Failure and deployment

Retirement must be atomic with the existing mailbox update and use validated
continuation authority. Invalid bindings and projection failures stay blocked.
Old snapshots recover through the corrected reader without changing format.
Old runners retain the defect; deployment and live verification remain separate
from this local fix. No production mutations are authorized by this plan.

## Tasks

1. Reproduce deferred-hint frontier blockage before changes.
2. Correct coverage/retirement while retaining fresh admission and all barriers.
3. Prove atomic retention, restore, retry expiry, and real sync continuation.
4. Run focused tests, package typecheck, complexity and documentation checks.
5. Review the complete diff, update owners, close this plan and commit.

## Verification and review

- Before the fix, the coverage and persisted preparation regressions both
  failed: the duplicate remained pending with no executable work.
- Four focused suites pass: 277 tests across device hint coverage, empty
  mailbox preparation, notification execution, and mailbox state.
- Six composed workspace restore scenarios pass, including deferred and equal
  cadence cases. Web checkpoint handling advances before the history deadline;
  no history resource is fetched early, and the original resource executes once
  when due. Fresh connection/manual work and dirty revisions remain supported.
- Focused commands: package-local Vitest with the four named mailbox suites;
  package-local Vitest on the workspace entrypoint system-mailbox suite with
  the pattern `system mailbox retains only necessary device work across restore`.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm docs:drift`, `pnpm complexity:diff` and `git diff --check` passed.
  Complexity debt and hotspot maxima are unchanged. Existing large functions
  only reuse retirement or rename its now-broader result; no extraction needed.
- Parent review: one coverage projection and one atomic retirement path; the
  retained job set and retry timestamps remain unchanged. Binding, sequence,
  admission filters, ordering barriers and whole-projection validation preserve
  authority. Post-checkpoint retirement now validates the same imported owner
  projection as idle retirement, using one local mailbox-watermark read.
- Product UX: Ready for this scoped acknowledgement correction. Retained device
  work remains durable, fresh work remains eligible, and no prompt, tool,
  provider-input or foreground reply I/O is changed. No live-model proof needed.
- Changelog: not applicable; internal completion bookkeeping changes neither
  provider backoff nor the member-facing capability or data contract.
- No new Frog entry: no repository workaround was required; dependency setup
  and the documented focused commands worked.
- Deployment: runner-only correction, unchanged serialized state and Web/
  orchestration protocol. Corrected readers retire already-deferred legacy hints
  on ordinary admission; old readers keep the defect. Returning to an old reader
  cannot lose the retained jobs because the existing owner and job hints remain.
  No production changes were made. PR CI, final ReviewGPT and live rollout
  verification remain for the PR/deployment lane, which was not requested.
  After deployment, confirm the corrected runner version and observe handling
  advance while the retained jobs still respect their original deadlines.

Completed: 2026-09-18
