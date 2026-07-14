# PR 559 final audit round 2

## Goal

Resolve the two validated final-head ReviewGPT findings while preserving
already accepted companion observations and the hosted connection authority
boundary.

## Success criteria

- Newly accepted companion RMSSD envelopes carry one deterministic admission
  identity through encrypted dirty-payload storage, local job dedupe, evidence,
  and canonical external references.
- The bounded receipt remains keyed by capture ID while every accepted payload
  uses the strict aggregate envelope's deterministic admission identity.
- A local account bound to one hosted connection cannot be adopted or mutated
  by another hosted connection through mutable provider identity.
- Terminal privacy scrubs are hydrated before active entries from the same
  snapshot, so disconnect A followed by reconnect B produces distinct,
  correctly bound local accounts regardless of snapshot input order.
- Focused owner tests/typechecks, repository-routed verification, serialized
  completion audits, one clean corrected-head ReviewGPT audit, GitHub CI, and
  final head/review/mergeability gates pass.

## Working set

- `packages/contracts/src/companion-observation.ts` and focused tests.
- `apps/web/src/lib/device-sync/{wake-service,prisma-store/dirty-connections}.ts`
  and focused companion-ingress/dirty-store tests.
- `packages/assistant-runtime/src/hosted-device-sync-runtime.ts` and focused
  hosted runtime tests.
- `packages/device-syncd/src/{config/provider-manifests,providers/junction}.ts`,
  `packages/device-syncd/src/store/{accounts,hosted-account-hydration}.ts`, and
  focused provider/store tests.
- `packages/importers/src/device-providers/junction.ts` and focused importer
  tests.
- Matching durable architecture/security/device-sync documentation.

## Persisted-state classification

No new retry owner or database state is introduced. The admission identity is
a deterministic digest stored inside the already encrypted dirty resource and
local job payload. The existing Postgres receipt remains sparse, bounded replay
metadata keyed by capture ID rather than product health truth.

## Verification plan

- Prove distinct pending dirty rows and local jobs for two post-retention
  admissions that reuse a capture ID with changed strict envelopes.
- Prove both admissions become distinct canonical observations while an exact
  replay of one admission remains idempotent.
- Prove active-B/terminal-A snapshots produce separate accounts in either
  input order, and active B without A's terminal predecessor fails closed
  without changing A's state or credential.
- Run focused contracts, web, device-syncd, importer, and assistant-runtime
  tests/typechecks, then diff-aware verification and serialized security and
  coverage audits.
- Close this plan in a scoped commit, push one stable correction head, run one
  substantive clean ReviewGPT audit on that exact head, and wait for green CI.

## External proof limitation

The real 60-second capture-to-query proof still requires the owned physical
iPhone/WHOOP surface and authenticated session. It must not be simulated.

## Completion evidence

- Focused changed-path tests passed: contracts 7/7, web 98/98,
  assistant-runtime 68/68, device-syncd 315/315, importers 137/137, and query
  91/91. All six owner typechecks passed.
- The diff-aware lane passed 22 affected package typechecks, all selected
  reverse-dependent package suites, hosted package-boundary checks, web
  verification and production build (4,503 passed, 135 skipped), and
  Cloudflare verification (1,736/1,736).
- The required security/privacy audit traced every changed production boundary
  and returned zero medium-or-higher findings.
- The coverage-write audit added one assertion that the web builder hashes the
  exact serialized observation and carries that digest into the staged payload;
  its focused web file passed 80/80 after the change.
- `pnpm docs:drift`, `git diff --check`, and the scoped identifier/credential
  pattern scan passed.
- Parent final review found no remaining evidence-backed defect or unjustified
  state, abstraction, or compatibility path in the correction diff.

## Final review decisions

- The bounded receipt remains capture-keyed; admission identity begins only
  after an envelope is accepted and owns dirty-payload, local-job, and canonical
  idempotency.
- The companion flow is unmerged on `origin/main`, so no production legacy
  capture-keyed job or canonical-reference adapter is warranted.
- Hosted connection ID is the immutable local binding authority. Terminal
  entries hydrate before active entries, cross-hosted adoption fails before
  mutation, and unique unbound legacy adoption remains compatible.
- Raw BLE packets, R-R intervals, device identity, heart-rate samples, and Apple
  Health comparison values remain outside the uploaded and logged contract.

## State

Active.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
