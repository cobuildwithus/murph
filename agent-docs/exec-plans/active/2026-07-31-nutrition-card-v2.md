# Goal-aware nutrition response card V2

Status: active
Created: 2026-07-31
Updated: 2026-07-31

## Goal

- Ship the approved compact nutrition card through the existing Murph response
  card and Messages extension owners.
- Add canonical fiber totals and optional frozen goal context without creating
  another state, delivery, or rendering owner.

## Success criteria

- Existing V1 cards remain parseable, deliverable, and readable.
- New V2 cards carry the exact canonical five-metric meal totals plus nullable
  per-metric goal snapshots.
- A goal snapshot contains only a target and Murph's frozen semantic assessment;
  the native renderer does not invent thresholds.
- Missing or untrusted goals stay absent and render neutrally.
- The existing private-direct closeout, outbox, Linq capability fallback, SMS
  fallback, and immutable inline URL behavior remain unchanged.
- The paired iOS extension renders V1 and V2 offline from
  `selectedMessage.url`, with no account, network, persistence, or second data
  owner.

## Scope

- Closed response-card contracts, encoding, deterministic text, and focused
  tests.
- The managed automatic-meal-closeout skill and response-card tool description.
- Current response-card reliability and architecture documentation.
- The paired Messages decoder, production SwiftUI view, local card studio,
  focused tests, and review evidence.

## Constraints

- No database, API, auth flow, cleanup job, queue, extension networking,
  dependency, or generic card framework.
- V1 remains a first-class compatibility input for retained outbox/checkpoint
  state and already-sent messages.
- Deploy and verify the backward-compatible iOS reader before the backend emits
  V2.
- Copy meal totals exactly from the immediately preceding canonical read.
- Read only current active canonical goals when considering a target; never
  fabricate a target or infer one from the day's total.
- Treat goal status as a frozen presentation assessment, not canonical goal
  progress or future product truth.

## Tasks

1. [x] Add the V2 contract while retaining V1 compatibility.
2. [x] Port the approved production SwiftUI card and V1/V2 decoder.
3. [x] Update the closeout skill, deterministic fallback, and focused tests.
4. [x] Capture exact-head iOS simulator evidence and run focused verification.
5. [ ] Push both candidate heads and run preliminary and final ReviewGPT gates
   concurrently with CI.
6. [ ] Resolve findings, complete parent review, close this plan, and record the
   physical-device/deployment gates.

## Verification log

- Backend focused typechecks passed for contracts, operator config, assistant
  engine, and hosted execution.
- Backend focused response-card, skill, outbox, and hosted-runtime coverage
  passed: 217 tests across nine suites.
- Backend affected-code verification passed, including dependency and boundary
  checks, all affected package typechecks and tests, the Web verification and
  production build, and the Cloudflare Node and Workers suites.
- iOS formatting passed with no files requiring changes.
- iOS Messages extension build and tests passed: 27 tests, no failures or
  skips.
- iOS Studio Debug, host Debug, and host Release simulator builds passed. The
  host builds embed the Messages extension.
- Five synthetic Studio fixtures were captured from the production renderer
  across goal, selection, missing-goal, dark-mode, and accessibility states.
