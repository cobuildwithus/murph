# Expire generated image captures after 14 days

Status: active
Created: 2026-08-04
Updated: 2026-08-04

## Goal

- Automatically retire assistant-generated image capture bytes after 14 days
  while preserving truthful canonical history and generated-tool replay
  semantics through the smallest existing retention owner.

## Success criteria

- Generated image captures older than 14 days lose their raw media bytes through
  one per-capture canonical, receipt-guarded mutation.
- Fresh generated captures, non-generated captures, explicitly durable visual
  tracking captures, and protected in-flight work are not retired incorrectly.
- Generated-image retry lookup semantics cannot resurrect expired media and
  remain internally consistent with the event ledger and raw artifacts.
- Hosted maintenance schedules and checkpoints the cleanup using existing
  retention wake/maintenance primitives, without a new scheduler, queue, or
  persisted state owner.
- Focused tests and typechecks pass; exact-head CI and required ReviewGPT gates
  are green.

## Scope

- In scope: generated capture classification, canonical 14-day retention,
  lookup/event/raw-media consistency, existing hosted retention maintenance,
  tests, and durable contract documentation.
- Out of scope: changing inbox retention, automatic meal-photo retention,
  user-authored durable progress-photo behavior, UI work, or a general capture
  lifecycle redesign.

## Constraints

- Technical constraints: reuse existing event deletion/tombstone, capture lookup,
  canonical batch, and hosted retention wake owners; preserve idempotency and
  fail closed on integrity or ownership mismatch.
- Product/process constraints: privacy deletion must not degrade durable visual
  tracking intent, and the implementation must stay small, composable, and
  independently reviewable.

## Risks and mitigations

1. Risk: deleting canonical media without updating retry lookup state can
   resurrect or corrupt a generated capture.
   Mitigation: use one core-owned per-capture atomic operation that validates
   all coupled state before mutation and tests replay after expiry.
2. Risk: a new background subsystem duplicates existing retention scheduling.
   Mitigation: extend the current hosted retention maintenance/wake path only.
3. Risk: age calculation or interrupted cleanup deletes fresh or protected
   media.
   Mitigation: use canonical timestamps, exact cutoff tests, bounded batches,
   receipt guards, and retry-safe idempotency tests.

## Tasks

1. Ask ReviewGPT Pro for a scoped implementation patch using existing owners.
2. Inspect current capture, lookup, delete-event, and hosted retention flows.
3. Apply or rework the returned patch at the smallest correct ownership
   boundary.
4. Run focused core/runtime tests, typechecks, and direct retry/integrity proof.
5. Commit and push a candidate, open a PR, and run specialist plus final
   ReviewGPT gates concurrently with CI.
6. Resolve accepted findings, complete the final review, archive this plan, and
   push the final exact head.

## Decisions

- The 14-day policy applies to assistant-generated capture media, not every
  canonical capture; user-requested durable longitudinal imagery remains
  durable.
- No new scheduler, queue, manager, or database state owner is permitted unless
  current primitives are proven insufficient.
- Every generated-image vault write uses the existing capture lookup. A stable
  tool-call identity keeps its replay behavior; a write without one receives a
  unique retention-only identity so it remains discoverable without inventing
  a second index.
- Retirement commits each capture independently so an integrity-blocked capture
  remains unchanged and scheduled for retry while valid neighbors progress.
- Hosted restore keeps `raw/**` and `derived/**` lazy. Retention therefore
  materializes the lookup before discovery and only due image/manifest paths
  before their receipt checks.
- Dormant pre-deploy snapshots are enrolled once by
  `20260805010000_rearm_generated_image_capture_retention`, which reuses the
  existing `inbox_media_retention` wake, workspace CAS version, and bounded
  hourly dispatcher.
- Each successful generated-image canonical write carries its exact 14-day
  cutoff into the same receipt checkpoint. Multiple writes keep the earliest
  cutoff, including when shutdown begins before the idle snapshot.
- Retirement itself runs inside the existing hosted canonical-write boundary.
  Guarded text-replacement receipts preserve raw-write authority and the
  inspected preimage, so replay is idempotent at the tombstone, replaces only
  the original bytes, and rejects a third state. Legacy lazy snapshots
  materialize receipt targets before checking that preimage.
- The existing execution-context normalizer preserves the generated-capture
  persistence callback like its adjacent materialization capability. This is
  the mandatory production boundary between the workspace runner and
  synchronous/group generated-image tool contexts.

## Review anomaly retrospective

- Trigger: final ReviewGPT correction round 2 repeated the lookup-visibility and
  exact-wake ownership mechanisms, and the next substantive run is round 3.
- Original requirement: retire every assistant-generated payload after 14 days
  without member activity, preserve deleted retry identity across restore, and
  leave durable user captures untouched using existing owners.
- Shape movement: the first-reviewed head contained 843 added and 184 deleted
  source lines. Before this retrospective, the corrected patch contains 1,204
  added and 314 deleted source lines. Review-driven work added universal lookup
  enrollment, per-capture isolation, exact wake metadata, guarded receipt
  replay, lazy materialization, and rollout re-arm; the repeated defects came
  from leaving lookup preparation and wake persistence optional at call sites.
- Decision: continue this indivisible PR, but collapse both responsibilities
  into the existing generated-image/hosted canonical-write path. The generated
  image owner must materialize the one shared lookup before any lookup read and
  fail closed when hosted private delivery lacks the existing persistence
  callback. The hosted workspace runner must supply that callback to every
  synchronous and group path and checkpoint the exact cutoff through a
  deadline-specific instance of its existing canonical-write port. Detached
  generation continues through its existing controller boundary.
- Alternatives rejected: reverting universal lookup enrollment leaves
  supported group-generated images outside retention; splitting would ship the
  same privacy gap; a new index, scheduler, queue, cursor, manager, or repair
  pass duplicates existing owners. Continuation adds no persisted state owner
  and requires production-shaped cold-restore/group and interruption proofs.
- Round 4 confirmed the execution-context correction and required only PR-body
  inventory: the shared normalizer is now named as an affected surface with its
  regression proof, and the hot-path disclosure records the existing cold
  lookup materialization read. Production source remained unchanged.

## Verification

- Passed locally: core, assistant-engine, assistant-runtime, and hosted-Web
  typechecks; the complete 774-test core suite including 48 focused retention
  tests; 95 image-generation/group-tool tests; 66 assistant service/runtime
  tests including the execution-context boundary regression; the complete
  2,039-test assistant-runtime suite (2,036 passed, 3 skipped); 10 static Web
  migration tests; the local PostgreSQL re-arm proof; workspace-boundary
  verification; documentation drift; and diff hygiene.
- Remaining: exact-head GitHub Actions and ReviewGPT round 5 on the documented
  round-4 body-only correction.
- Expected outcomes: old generated media is retired atomically and cannot be
  resurrected; fresh, unrelated, durable, and protected captures remain; all
  checks and reviews pass.
