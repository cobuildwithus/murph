# Fix Junction preflight fallbacks and checkpointed cadence

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Goal and invariants

Restore unchanged-content wake avoidance for all ordinary Junction candidates in
the selected sweep cohort. Publish only checkpoint-proven provider cadence while
preserving exact future job recovery, consent, source admission, and daily repair.

## Scope and owners

- Remove the separate five-preflight cap in the Web due sweeper. Existing cohort,
  concurrency, collection, and timeout bounds remain the execution controls.
- Accept SDK-decoded sleep-cycle and menstrual-cycle collections at the Junction client boundary;
  keep strict malformed-response rejection and version the content binding.
- Publish cadence immediately after a successful current-admission checkpoint
  while keeping future history jobs retained. Exclude yielded passes and restored
  recording records; recover prior checkpointed cadence on subsequent admission.
- Reuse existing account state, wake hints, and version-fenced control updates;
  no persisted fields, queues, dependencies, or production configuration changes.

## Evidence and risks

The SDK decodes sleep_cycle/menstrual_cycle to camelCase keys, rejected by the
strict extractor.
The sweeper consumes its five slots before eligibility. Retained jobs currently
hold the Web cadence at the baseline even after a continuation is checkpointed.
Provider failures must still request ordinary recovery. Mixed versions must
fall back on a content-binding mismatch, never certify incompatible evidence.
Cadence replay must fence connection epoch and preserve an earlier local due time.

## Product UX

Outcome: Reduce unnecessary background wakes while preserving wearable freshness.
Reaches: Unchanged and changed accounts, malformed provider responses, accounts
with delayed history, cold restores, reconnects, and concurrent accepted work.
Proof: SDK-backed collection/probe tests, sweep cohort regressions, and retained
wake publication/recovery tests. No assistant prompt or UI behavior changes.

## Tasks

1. Add focused regressions and implement the three existing-owner corrections.
2. Update ingestion and reliability contracts.
3. Run affected tests, typechecks, complexity guard, and parent diff review.
4. Close the plan and make a scoped commit. Production rollout remains separate.

## Verification

- Device-sync client and preflight files: 62 tests passed, including real SDK
  decoding for empty and populated sleep/menstrual-cycle collections, all summary
  resources, incompatible bindings, malformed responses, and changed content.
- Hosted runtime and system mailbox files: 304 tests passed. The cadence
  cold-restore regression first failed against the original implementation.
  Focused checkpoint/completion cases were rerun after the final type narrowing
  correction: 14 passed. Exact future jobs survive cadence publication; yielded
  and restored recording paths retain their owner without publication.
- Web due sweeper: 11 tests passed; Web preflight: 18 passed. Every selected
  ordinary candidate is checked, while dirty recovery, authority races, failed
  provider reads, and failed CAS preserve normal recovery.
- `pnpm --dir packages/device-syncd typecheck`,
  `pnpm --dir packages/assistant-runtime typecheck`, and
  `pnpm --dir apps/web typecheck` passed; Web prepared typecheck was rerun after
  the runtime changes and passed.
- `pnpm complexity:diff` passed. Sweeper complexity decreased from 20 to 17;
  existing owner hotspots gained no complexity debt. No new abstraction is needed.
- Parent review: Ready. No new persisted shapes or protocol fields. SDK binding
  version changes force ordinary reconciliation across old/new deployment skew.
  Existing checkpoint, connection epoch, version fence, and retained retry owner
  remain authoritative. No private production evidence is included.
- Local implementation and scoped commit only. PR CI, applicable final ReviewGPT,
  deployment, and post-deploy wake/cost measurements remain rollout work.

## Deployment and operational bounds

Web and runtime use the existing hint/proof schema in either deployment order;
an old/new content binding mismatch requires ordinary execution. Old runtimes
retain the prior less-efficient cadence publication until replaced. The selected
cohort remains 25 by default (maximum 250), with five concurrent workers and
20-second provider budgets per probe. Removing the total-probe cap increases
provider reads for eligible accounts, with no added foreground work. Post-checkpoint
publication uses one bounded current-connection fetch and at most one versioned
update while retaining future jobs. No production settings were modified.

## Changelog

Not applicable: internal execution efficiency and cadence publication; no new
member action, UI, or changed data ingestion promise.
Completed: 2026-09-14
