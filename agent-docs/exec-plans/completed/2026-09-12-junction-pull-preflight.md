# Avoid unchanged Junction reconciliation wakes

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Goal and scope

Avoid ordinary scheduled container wakes when bounded Junction reads prove the
same content was already imported and checkpointed. Measure comparison outcomes,
provider collection cost, fallback reasons, and successfully avoided wakes before
considering a lower polling frequency. Keep the current cadence and canonical
import owner. No new queue, vendor refresh request, or canonical health store.

## Product UX

Patch. Outcome: unchanged scheduled checks can finish without member execution.
Reaches: settled Junction connections; new/updated data still uses existing durable
wake/import work. New connections, unfinished history, daily repair, dirty work,
revoked access, unavailable providers, and old checkpoints preserve their current
path. Proof: provider-shaped correction/no-change tests, import-failure and
checkpoint/cold-restore tests, and locked Web authority/idle-work/CAS tests.

## Design and constraints

- Reuse ordinary summary readers and the latest globally closed calendar-day
  readers; introspection counters are not negative change evidence.
- A keyed content digest covers actual records and inventory/configuration/source
  lifecycle binding. Persist only a bounded versioned proof, not provider data.
- Carry partial digest through existing summary continuation payloads. Publish the
  completed proof through the existing checkpoint completion fence; generic
  precheckpoint metadata updates must withhold it.
- Keep the original summary start while checking through current time. Expire
  proof at the next UTC day, global provider-day closure, vault-local midnight, or fixed-lag authority closure across DST.
  Ordinary daily/full repair and scheduler-owned history remain available.
- Web may skip only with current consent/access/connection/source authority and
  the durable mailbox/checkpoint/dirty state proving no pending accepted work.
  Provider work runs outside database transactions. Final CAS advances cadence
  only; it cannot acknowledge dirty work, mark import success, or extend proof.
- Bound sweep preflights, execution concurrency, collection pages, and wall time.
  Unchanged callbacks count as avoided wakes only after the final CAS succeeds.
- Collection/decoded-record metrics are not HTTP request totals, cold starts,
  canonical novelty, or a billing estimate.

## Tasks

1. Implement provider content proof and read-only comparison with bounded fetches.
2. Fence proof publication and cold recovery using existing runtime protocol.
3. Add Web admission/CAS and aggregate telemetry to the due sweep.
4. Prove corrections, failures, history/day boundaries, and authority races.
5. Update owner documentation, review complexity/privacy, run focused checks.
6. Commit/push draft candidate, run required final ReviewGPT with exact-head CI,
   resolve findings, and close the plan after completion gates pass.

## Evidence and remaining work

- Provider content proof: 17 scenarios passed, including actual-value correction,
  closed-day measurement correction, collection ordering, partial continuation,
  import failure, reconnect, local restore counters, and repair expiry.
- Existing provider client/resource/webhook regressions: 105 scenarios passed.
- Shared runtime/manifest contracts: 142 scenarios passed.
- Checkpoint/cold-restore runtime: four focused scenarios passed.
- Web preflight/sweeper: 28 scenarios passed, including injected concurrent
  authority, consent, mailbox, checkpoint, and CAS changes. Live PostgreSQL
  concurrency is not claimed by these mocks.
- Device-syncd, assistant-runtime, and Web typechecks passed.
- Parent diff/privacy review and complexity guard passed. Existing provider and
  runtime hotspots retain or reduce debt; source authority and mailbox idle proof
  remain distinct small functions. No new dependencies or database tables.
- Product UX: Ready for candidate review based on synthetic boundary proof.
  Changelog not applicable: internal execution suppression and telemetry preserve
  member-facing polling cadence, data paths, and interactions.
- Final ReviewGPT is resolved on the implementation head. Required CI remains
  the final PR-head handoff gate; no deployment, measured container reduction,
  or savings is claimed by local checks.

## Candidate review

- Round 1: PASS on `9eec099a100bbdeea38ef3f1df473ae3df7c5bfe`.
  Vonneumann lane, captured model `gpt-6-pro`, response SHA verified against
  capture/model metadata. Attached full snapshot and exact commit were reviewed;
  response took over ten minutes and covered the interacting owners. No findings.
  Reviewer did not independently run repository suites or live PostgreSQL.
- Parent review reproduced and fixed two additional bugs: SDK-decoded Date
  timestamps hashed as empty objects, and autumn DST could make fixed-lag daily
  repair eligible before proof expiry. Added regression tests, bound digest scope
  to its original window/expiry/timezone, and checked continued proof timezone.
- Initial CI found a Web prefer-const lint error. The fallback now takes webhook
  age explicitly, retaining the same telemetry behavior without mutable closure.
- Provider regression tests (17), affected typechecks, and complexity guard pass.
  Corrected-head final review and CI remain required before completion.

- Round 2: PASS on `cbaba72ec9fad11f3b6e17b184f01ffc12de6491`.
  Same Vonneumann conversation, full snapshot, verified `gpt-6-pro` response hash,
  over ten minutes, no findings. Reviewed the corrections and interacting owners;
  21 reviewer assertions passed, with no independent repository-suite claim.
- CI then exposed the generic hint reader missing the manifest's new continuation
  field. Added that field to the existing closed allowlist; the manifest-derived
  producer/reader contract reproduces the rejection and verifies transport.
- The old package graph guard assumed recovery never read providers. This task
  intentionally adds that capability: permit only the recovery route's exact
  preflight-to-existing-registry edge. Keep checking every other recovery edge
  and control route against the provider-free rule; no dynamic-import bypass or
  duplicate provider/config factory was added.

## Final implementation evidence

- Round 3: PASS on `142366dfb058467f65962bb5a796a2c601ca43f4`, with
  zero findings. The same Vonneumann conversation received a full snapshot with
  verified first/previous/current lineage. Captured `gpt-6-pro` model and exact
  response hashes agree; the completed review exceeded the three-minute minimum.
  Its source-level checks reproduced the old reader rejection and tested narrow
  graph exceptions. No independent repository-suite or live-DB claim is made.
- All 205 focused provider/manifest/hosted-hint/runtime/package-boundary tests
  passed after the final source correction; device-syncd typecheck and complexity
  guard passed. Earlier 105 provider regressions, 28 Web tests, four checkpoint
  recovery cases, and assistant-runtime/Web typechecks also passed.
- Parent final review confirmed the one-field reader change and the exact graph
  exception, retained the existing import/checkpoint/scheduling owners, and
  reviewed the complete authored diff and privacy boundaries. No open findings.
- Implementation and review are complete. This plan-only closing commit changes
  no behavior; required CI on that final PR head remains a handoff gate. Merge,
  deployment, member rollout, and measurement of production outcomes are separate.
Completed: 2026-09-12
