# Remove the Environment feature and bespoke infrastructure

Status: completed
Created: 2026-10-19
Updated: 2026-10-19

## Outcome and protected invariants

Retire the Environment dashboard, print/share reports, interviews, voice capture,
and live conditions. Delete feature-owned code rather than replacing it with
flags, shims, or a new service. Preserve canonical Habitat records and CLI,
ordinary assistant context, shared weather tools, audio transcription, Browser
Vault refresh, mailbox ordering, and private-data cleanup.

## Ownership and evidence

The dashboard and API routes own admission and presentation. Hosted-execution
contracts and Cloudflare staging own dedicated event/audio transport. Runtime
Environment handlers and the habitat-voice maintenance profile own extraction.
Canonical Habitat records have independent assistant, CLI, and Journal callers.
OpenWeather also serves connected-app weather tools. These shared owners stay.
Claude independently reviews the removal scope; implementation is partitioned
between Web, hosted infrastructure/contracts, and runtime/assistant owners.

## Product UX

- Outcome: no Environment destination or advertised report/capture capability.
- Entry: homepage and dashboard navigation omit the retired feature; old URLs
  receive the ordinary missing-route response.
- Affected people: new visitors, signed-in dashboard members, and holders of
  old Environment links. Other dashboard and conversational journeys remain.
- Proof: focused navigation/render/auth tests; shared Habitat and mailbox tests;
  typechecks; search for remaining feature imports and live links.
- Done when: the feature and dedicated infrastructure are absent, surviving
  journeys pass, and the rollout prerequisite is explicit.

## Deployment and retained data

The existing retired-mailbox registry keeps historical metadata readable and
skips unimported retired items before payload fetch; new appends are rejected.
Already-imported snapshot state still needs the previous runtime to finish.
Before deploying the final consumer removal, disable Environment ingress on
Web while retaining old consumers, drain both Environment wake kinds and local
post-checkpoint audio-deletion records, then advance Web/Worker/runners together.
Historical accepted events and canonical Habitat records are not deleted by
this source change. Retired kind metadata uses the existing retention-window
contract; it carries no active Environment payload schema or executor. Keep the existing legacy recording prefix sweep and 24-hour
R2 expiration safety for already-staged private audio. No production mutation
is part of this task. A deployment before those checks is unsupported.

## Tasks

1. Inventory feature owners and shared consumers with an independent Claude review.
2. Delete Web feature, promotion, demos, dedicated assets and admission helpers.
3. Delete event contracts, Cloudflare routes, runtime processing and maintenance profile.
4. Update surviving regression coverage, active owner docs and member changelog.
5. Run focused tests/typechecks and complexity checks, inspect full diff and privacy.
6. Close plan and create a scoped local commit; report deployment/review limits.

## Verification

- Web full and prepared typechecks passed. Fifteen affected Web suites passed
  (479 tests); additional shared browser voice, goal/pattern art, homepage and
  changelog rendering proof passed (47 tests). The retired-kind append suite
  passed after adding both Environment kinds (75 tests).
- Hosted-execution, Cloudflare control, Cloudflare app, assistant-engine,
  assistant-runtime, contracts and runtime-state typechecks passed.
- Hosted-execution parser/control and Cloudflare route/store/bundle tests passed;
  contract retirement proof verifies readable old metadata and rejected active
  wakes. Runtime proof preserves mailbox order, device imports, foreground
  preemption, checkpointing and delivery; expanded focused run passed 344 tests.
  Retired-kind routing/import/bridge proof passed another 164 focused tests.
- Assistant maintenance/prompt/notification proof passed 233 tests. Surviving
  prompt branches are unchanged; the removed voice-only live journey was
  deleted, with no new stochastic behavior introduced.
- Contracts Habitat coverage (11), core Habitat mutations (6), CLI Habitat
  commands (9), query Browser Vault replica (23), and runtime issue storage (6)
  tests passed. Shared Habitat artwork references all resolve.
- Frozen dependency installation, complexity guard, docs drift and diff whitespace
  checks passed. Complexity hotspots are existing shared owners; the deletion
  reduces or preserves their complexity, with no new owner or abstraction.
- Claude's independent scope audit confirmed shared owners and residual cleanup;
  its additional unused SDK and report-scoring metadata findings were removed.
- Product walkthrough: navigation, auth return, Journal and changelog no longer
  offer Environment; canonical context and separate voice calls remain. Focused
  production-component server rendering and interactions pass: Ready locally.
- No production data, cloud resource, or deployment was mutated. Full hosted
  Docker/Temporal E2E, external ReviewGPT and exact-head CI were not run.

PR publication, external review, CI and production deployment are separate from
this local implementation task.
Completed: 2026-10-19
