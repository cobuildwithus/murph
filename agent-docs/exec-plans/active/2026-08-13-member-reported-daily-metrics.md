# Member-reported daily metric corrections

Status: active
Created: 2026-08-13
Updated: 2026-08-14

## Goal

- Let Murph durably record an exact group participant's stated daily metric
  value without changing or deleting device evidence.
- Surface the member-reported value through the existing consented group share
  projection with explicit manual-source provenance.

## Success criteria

- An exact current group sender can supply a dated daily metric value that is
  durably handed to their personal runtime and stored in their canonical vault.
- The existing group projection exposes the value as a separate `manual`
  source, and repeated delivery is idempotent.
- Murph acknowledges only durable acceptance, never claims that a device value
  changed, and treats contradicted visible snapshots as stale or unverified.
- Focused tests, package typechecks, preliminary specialist review, final
  ReviewGPT, and exact-head CI complete without unresolved accepted findings.

## Scope

- Exact accepted-message sender resolution in hosted groups.
- Existing encrypted mailbox delivery into a personal hosted runtime.
- Canonical manual observation import and existing group-share projection.
- Assistant tool guidance, focused contracts, tests, durable docs, and
  changelog.

## Constraints

- Keep canonical health values in the member vault and Web authoritative only
  for group identity, grants, and encrypted projections.
- Preserve provider observations as immutable evidence; corrections are
  separately sourced member reports.
- Reuse the existing mailbox, core write, and projection owners. Add no table,
  queue, scheduler, or override hierarchy.
- Bind every group correction to the exact accepted input and server-resolved
  current participant. The model must never select a member id.
- Keep private examples and direct identifiers out of repository artifacts and
  review packets.

## Tasks

1. [x] Trace the current group sender, mailbox, canonical observation, CLI, and
   shared-projection owners and choose the smallest composable seam.
2. [x] Implement the exact-sender report action, personal-runtime import,
   projection handoff, and assistant guidance.
3. [x] Run focused tests, direct scenario proof, package typechecks, changelog
   validation, and durable-doc checks.
4. [x] Commit and push an exact candidate head, open a PR, and start the
   preliminary specialist and final ReviewGPT passes concurrently with CI.
5. [ ] Resolve accepted findings, complete parent review, close this plan via
   `scripts/finish-task`, and prove exact-head CI and mergeability.

## Verification log

- Initial architecture trace found that daily shared projections already
  preserve `manual` as a separate public source and select the latest same-day
  observation within each source. The missing seam is a trusted exact-sender
  handoff into the existing personal-runtime canonical write path.
- The action itself is the bounded assistant tool; a second generic CLI flag
  would duplicate validation without adding an owner or user outcome.
- Focused contracts, hosted-execution, assistant-runtime, assistant-engine, and
  Web tests pass. All affected package typechecks pass after generated Web
  prerequisites are prepared.
- ReviewGPT's first exact-head pass found revoked-consent admission, discarded
  projection results, noncanonical units, and a redundant replay owner. The
  correction pass now checks consent under the existing sender lock, passes the
  existing projection owner's exact result into the durable receipt, validates
  canonical values through `health-metrics`, and leaves replay ownership solely
  with the mailbox append.
- Full affected suites pass for assistant engine (3,704 tests), assistant
  runtime (2,290), CLI (1,166), hosted execution (524), hosted control (57),
  setup CLI (124), and the focused Web paths (181). All affected typechecks and
  docs drift pass. The Docker-backed hosted-local journey is committed for CI;
  this host has no Docker executable, so local startup could not run it.
- The canonical diff lane also reported two existing workspace-boundary
  violations in untouched Web tests. Its first CLI pass then self-waited when a
  repair subprocess lost the outer workspace-lock marker; rebuilding the
  prepared runtime outside that lock made the full CLI workspace pass.
- ReviewGPT round 2 required a retrospective because the new durable action was
  omitted from Cloudflare's existing exact-request replay classifier. The
  retrospective continued this PR with the existing transport replay and a
  deterministic mailbox item identity; exact committed requests resolve before
  changed authority or consent, while new admission still rechecks both and the
  generic mailbox append remains the sole payload/conflict owner.
- The correction passes Web typecheck, the full Web suite (9,973 tests), and the
  full Cloudflare node suite (2,440 tests). Proxy and direct lost-response tests
  prove byte-identical replay; Web coverage proves one committed report resolves
  after authority/consent changes and changed values still conflict.
- ReviewGPT round 3 found that two distinct reports can share the transport's
  second-precision timestamp, leaving the opaque metric-point id to choose the
  apparent latest correction. The importer now carries the mailbox owner's
  existing causal sequence into a bounded canonical qualifier, the metric query
  exposes it only for manual daily reports, and same-source selection compares
  two valid causal sequences before the legacy synthetic-time, recorded-time,
  and id fallback.
- Manual external references no longer enter the wearable summary resolver, so
  a provider summary cannot suppress separately sourced member evidence. The
  focused mixed-source proof writes 8,000 then 9,000 at one timestamp, chooses
  ids that would otherwise prefer the older report, preserves 7,500 device
  evidence, selects and projects 9,000, reloads the vault, and replays safely.
- ReviewGPT round 4 showed the sequence was still subordinate to the canonical
  event's timezone-derived local-noon instant, so a timezone change between two
  reports could keep the older value visible. The required anomaly retrospective
  continued with the same mailbox ordering owner and moved its comparison ahead
  of synthetic observed time; legacy points without two valid sequences retain
  the complete prior fallback. Parameterized end-to-end proof covers both
  timezone directions and equal/unequal report timestamps. The retrospective is
  recorded at
  `https://github.com/cobuildwithus/murph/pull/1794#issuecomment-5292431858`.
- ReviewGPT round 5 found that pairwise sequence comparison was non-transitive
  when a same-day legacy Manual point lacked a sequence, and that the shared
  sender-authority reader still imposed Assistant Ask's text requirement on
  evidence-originated metric reports. Selection now reduces valid reports to
  the greatest mailbox sequence inside the existing top date/source cohort,
  then applies the unchanged legacy time/id fallback. The base authority reader
  accepts textless and long-captioned messages while both Ask wrappers retain
  their exact nonempty bounded-question policy.
- Node 24 proofs cover all six permutations of the three-point ordering cycle,
  general and series selection, mixed legacy/report projection and disk
  rebuild, deep/REM Manual correction projection, captionless Linq and Telegram
  evidence, long captions, and unchanged Ask rejection. The canonical diff
  verifier passed all selected typechecks, package tests, Web tests/build, and
  Cloudflare Node/Workers tests; it reported only the two pre-existing
  workspace-boundary findings in untouched Web tests.
