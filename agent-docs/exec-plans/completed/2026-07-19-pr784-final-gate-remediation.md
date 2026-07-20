# PR 784 Final-Gate Remediation

## Goal

Close the three exact-head CI failures without restoring ambient scheduled-turn
authority or adding another state/effect owner:

1. Make attended E2E expectations use the attended dynamic-tool resolver, so
   scheduled-only tools remain intentionally absent.
2. Supply canonical and device-activity experiment-support turns with one
   bounded progress snapshot derived by the existing plan-owned automation
   precondition from its immutable experiment support-series identity.
3. Update experiment guidance and the wearable replay proof so scheduled turns
   decide from owner-supplied context and never invoke a shell or operator CLI.
4. Close the two adjacent capability-parity gaps found by the scheduled-skill
   audit: deterministic experiment follow-up decisions through the same support
   snapshot, and provider-neutral sleep-pattern analysis through the existing
   bounded scheduled-read owner.
5. Delete dormant external-monitoring presets that require unattended web
   authority instead of broadening the scheduled runtime to support them.

## Constraints

- Keep scheduled App Servers shell-free and selector-free.
- Treat the existing exact support-series id, support kind, canonical automation
  id, and revision as the typed authority; add no model-selectable experiment
  lookup, second authority type, queue, manager, or persisted state.
- Load experiment progress only in the package/core query owner during
  precondition preparation, and keep the existing commit/delivery rechecks.
- Preserve canonical experiment lifecycle behavior and device-activity replay
  deduplication.
- Bind every derived device-activity job and outbox intent to the exact current
  parent revision, and reuse the existing lifecycle authority gate immediately
  before transport so consent revocation fails closed.
- Keep the attended-tool correction test-only.
- Preserve the canonical sleep-pattern query semantics rather than asking the
  model to reconstruct cross-midnight, timezone, nap, overlap, or missingness
  rules from generic records.
- Do not grant generic network or web access to scheduled notifications.
- Preserve unrelated ledger rows and the already-integrated work represented by
  the overlapping experiment-lifecycle and hosted-local-stub rows.

## Working Set

- `packages/assistant-engine/src/assistant/experiment-support-automations.ts`
- `packages/assistant-engine/src/assistant/cron/execution.ts` and focused tests
- `packages/assistant-engine/skills/experiment-onboarding/SKILL.md` and its
  guidance/hash tests
- `apps/cloudflare/test/helpers/hosted-local-e2e-support.ts` and helper tests
- `apps/cloudflare/test/hosted-local-device-sync-junction-wearable-direct-resource-replay-e2e.test.ts`
- matching experiment support, cron, and hosted E2E tests
- scheduled-read sleep-pattern action, sleep/circadian guidance, and focused
  authority/query tests
- unsupported external-monitoring cron presets and their exact catalog tests
- scheduled active-experiment context and managed-automation guidance that
  still advertises unavailable CLI/web capabilities
- `packages/assistant-engine/src/assistant/device-activity-cron-tags.ts`,
  `packages/assistant-engine/src/assistant/outbox.ts`, and focused derived-job
  and delayed-delivery authority tests
- durable experiment/scheduled-authority documentation only if the existing
  contract does not already describe the owner-supplied snapshot

## Verification Plan

- Focused assistant-engine and Cloudflare helper tests plus affected package
  typechecks.
- Targeted hosted-local attended-tool and Junction wearable replay E2Es from
  the isolated worktree profile.
- Final architecture/simplicity/security owner-boundary audit and coverage-write
  audit for the new snapshot paths.
- Real runner bundle policy/build if the production bundle graph changes.
- Full serial `pnpm verify:acceptance`, exact-head GitHub CI, privacy scan, and
  diff check.
- Record the ReviewGPT cap retrospective and obtain the required explicit
  continuation before any substantive round beyond round 5.

## State

Local completion gates are green; ready to package for exact-head CI and the
authorized final ReviewGPT round.

## Evidence So Far

- Exact-head CI proves two attended E2E failures are stale expectations: both
  compare against the global tool union instead of the attended resolver.
- Exact-head Junction replay proves ingestion, dedupe, sensed-session creation,
  and one nudge all work; its scheduled script then attempts the intentionally
  removed native shell to read experiment progress.
- The existing plan-owned precondition already resolves exact immutable
  experiment ownership and consent, but currently returns no bounded progress
  context and is not used by derived device-activity jobs.
- The scheduled-skill audit proved active experiment support also needs the
  existing deterministic follow-up-due query, while opt-in sleep reviews need
  the existing provider-neutral sleep-pattern query. Four deferred presets
  require external monitoring that the scheduled runtime intentionally cannot
  perform and have no task-bound source owner.
- A derived device-activity intent has no independent automation authority.
  Its authority key now covers the stable live parent fields that affect the
  turn, including tags and support kind, while the existing owner is re-read at
  provider entry, delivery, commit, and delayed outbox delivery. Volatile
  bookkeeping fields remain outside the key so a derived occurrence cannot
  invalidate itself merely by being recorded.
- ReviewGPT round 5 found that restoring selector-free group-health authority
  through the old verbose raw envelope could exceed the dynamic-tool 256 KB
  response limit at the admitted 32-member cardinality. The correction reuses
  the existing bounded projection store and canonical weekly-summary owner,
  emitting indexed scope/metric dictionaries plus explicit retained sleep
  windows. It adds no pagination, state owner, or new authority surface.
- The max-cardinality group-health test covers 32 members, every current health
  scope, and seven retained records per scope; the result stays within the
  response limit while source and current-route assertions still run before
  the read. Focused scheduled-read and scheduled-task integration tests pass.
- Focused assistant-engine coverage passes 376/376 tests; Cloudflare helper
  coverage passes 20/20; both affected typechecks pass. The real isolated
  Junction replay passes 4/4 and proves provider ingestion, deduplication,
  canonical sensed-session progress, and a scheduled nudge without shell or
  operator CLI use. The full assistant-engine suite passes 2,693 tests with 5
  intentional skips when run serially with an 8 GB Node heap.
- The required `coverage-write` pass strengthened the maximum-cardinality
  health fixture with 32 parser-valid 120-character multibyte display names and
  found no other meaningful proof gap. Its focused scheduled-read suite passes
  31/31.
- The canonical serial `pnpm verify:acceptance` gate passes end to end: repo
  guards, every workspace typecheck, all package coverage, hosted-web build,
  smoke, lint, and 5,866 tests, Cloudflare verification with 1,842 tests, and
  fixture/scenario integrity. The final diff check and durable-artifact privacy
  scan are clean.

## ReviewGPT Round 5 Cap Retrospective

Round 5's single high-severity finding was review-induced: the preceding
remediation restored all-health reachability with a verbose raw projection and
tested only a one-member fixture. The missed invariant was the product's
admitted maximum cardinality, not the authority boundary itself. The fix uses
the existing projection and weekly-summary owners and adds direct
max-cardinality proof. No other completion gate is being waived. The user
explicitly resumed this exact PR finalization and authorized continuation after
the shared-runner/typed-authority architecture was explained; a round beyond
the normal cap may start only after all other required local and exact-head CI
gates are green.

Updated: 2026-07-19
Status: completed
Completed: 2026-07-19
