# Paused native companion access

Status: active
Created: 2026-08-09
Updated: 2026-08-10

## Goal

- Let a non-suspended member whose own billing is paused open the native
  companion and keep its existing health-sync connection usable, while
  preserving the ordinary active-access gate for assistant/model work and
  other paid product authority.

## Success criteria

- Companion admission, Junction token refresh, onboarding projection, sync
  status, and companion health-data ingress accept paused members.
- Suspended members and non-paused inactive billing states remain blocked with
  their existing stable errors.
- Historical launch consent remains required and mandatory launch request and
  response shapes do not change, so existing iOS and Android builds recover
  after a Web deployment without an app release.
- Optional meal-photo capture remains paid-access gated, and its enrollment or
  activation denial no longer presents as whole-account loss to released iOS
  builds.
- Focused regression tests, Web typecheck, required review gates, and exact-head
  CI pass without unresolved accepted findings.

## Scope

- In scope: the companion-specific member-access predicate, bearer-auth helper,
  native launch/sync route wiring, contact-card handoff redemption, deterministic
  device-sync system-mailbox consumption, focused tests, and durable companion
  access documentation, plus feature-scoped mapping for paused meal-photo setup
  denial and the user-requested ReviewGPT dependency refresh required for the
  final review gate.
- Out of scope: canonical assistant/runtime entitlement, browser billing
  recovery, Stripe state, native client code, and paid meal-photo capture
  authority.

## Constraints

- Technical constraints: keep Privy bearer verification, administrative
  suspension, member binding, launch consent, and device-connection lifecycle
  checks unchanged; do not add persisted state or a second entitlement owner.
- Product/process constraints: access to the companion shell and existing
  health sync must not imply renewed billing or paid AI access; preserve
  compatibility with already-released native clients.

## Risks and mitigations

1. Risk: a general entitlement relaxation re-enables paid runtime work.
   Mitigation: add one companion-owned predicate and use it only on native
   companion launch and health-sync boundaries.
2. Risk: admission succeeds but a later mandatory launch request still returns
   `HOSTED_ACCESS_REQUIRED`.
   Mitigation: trace the existing client launch sequence and cover admission,
   sign-in token, onboarding, and status with focused tests.
3. Risk: paused access bypasses suspension or health-data consent.
   Mitigation: preserve the existing suspension assertion and route-local
   consent checks, with negative regression cases.
4. Risk: accepted health ingress remains staged because the hosted runtime is
   active-access gated, or relaxing that gate admits model-capable work.
   Mitigation: admit only pending system-lane lag after companion access,
   historical launch consent, and health-data consent checks; remove
   conversation and ordinary workspace-wake authority; preserve
   lane-contiguous import durability for older accepted system work but execute
   only the existing `run-device-sync-wake` route in model-free system-mailbox
   mode; suppress device-activity automation scheduling in that restricted
   invocation; and retain the provider-egress fence. An exact persisted retry
   marker may retain only that device-sync route's `device-sync.reconcile` wake
   after failure, while a dirty receipt requeues the same executable local
   item, or while another exact local device item remains. Serialize companion
   ingress and dirty acknowledgement with the existing health-data admission
   lock so either commit order produces another executable pass.
5. Risk: a native signed contact-card handoff still fails at the browser
   redemption boundary.
   Mitigation: bind companion redemption to the exact HMAC-signed, server-owned
   native session marker; retain active access for every other handoff and
   ambient browser session.

## Tasks

1. Add the narrow paused-companion access derivation and bearer-auth wrapper.
2. Route mandatory companion launch and health-sync endpoints through it.
3. Preserve connection lifecycle, contact-card, meal-photo, and hosted-runtime
   boundaries while completing the released-client journey.
4. Add focused access and route regressions; update the durable companion
   architecture/security contract.
5. Run focused verification, commit and push the exact candidate, open the PR,
   and complete preliminary specialist ReviewGPT, final ReviewGPT, and CI.

## Decisions

- Ship this as a backend compatibility change across Web/Vercel and the hosted
  runtime/Cloudflare container. No native request, response, error, or
  state-machine contract changes, so no App Store or Play Store release is
  required.
- Keep meal-photo capture enrollment and upload on active paid access because
  they can authorize assistant/model processing and are not required to open
  or sync the companion.
- A paused member may resume exactly one established Junction connection. An
  explicit connect and a legacy omitted-intent request with no provider row
  remain lifecycle mutations and fail closed.
- Map inactive meal-photo enrollment/activation to the feature-scoped conflict
  only when that member independently satisfies paused companion access.
  Canceled, unpaid, suspended, and other inactive states retain the canonical
  account-level access response.
- Process accepted paused health ingress only through the existing
  `system_mailbox` runtime mode. Reconciliation normally exposes system lag
  alone and removes conversation/default/workspace wake authority. The runtime
  preserves lane-contiguous import and bounded import-time durability effects
  for older accepted system work, then executes only `run-device-sync-wake`
  through the existing durable checkpoint and acknowledgement flow. It does not
  execute unrelated pending route actions, assistant automation, conversation
  work, delivery, or model admission, and the restricted device-sync action
  requests a credential-free snapshot, skips provider scheduling and unrelated
  retention/staleness maintenance, claims only provider-egress-free
  credential-independent canonical import/delete jobs, and suppresses
  device-activity automation scheduling. Junction source-reference imports and
  credential-scoped wearable jobs remain queued for ordinary active/default
  execution. A failed preparation or post-checkpoint receipt, a scheduled
  provider-egress-free local retry, or another exact local device item may
  persist one exact device-sync retry marker and `device-sync.reconcile` wake.
  Generic dirty state alone is not executable paused work: after
  acknowledgement the restricted path retains the item only when its filtered
  local worker schedule has an eligible retry. Deferred provider payloads remain
  durable without a paused marker or reconcile wake. Web holds its existing
  health-data admission lock across the dirty acknowledgement and pending-dirty
  query, serializing both commit orders with companion ingress. Each new
  companion payload appends a payload-identity mailbox wake even while the
  connection is dirty, so later companion ingress does not depend on a
  clean-to-dirty transition.
  The restricted pass always commits the post-receipt exact local queue,
  marker, and wake in its normal final `idle_shutdown` snapshot before return,
  while every earlier canonical checkpoint that can advance the system
  watermark carries that same exact continuation so committed-progress
  recovery cannot strand it if the final checkpoint fails. An exact empty
  device-item reread clears the marker and any stale paired device wake.
- The native repository has no release tag or other durable mapping from the
  App Store binary to a source commit. Compatibility is therefore based on the
  unchanged HTTP shapes plus inspection of the current native resume/connect
  and error contracts; do not claim exact released-binary/source identity.
- Run the final gate with the current public npm `latest` release of
  `@cobuild/review-gpt` (0.5.124), pinned in Murph's manifest, lockfile, and
  minimum-release-age exception rather than relying on a machine-global CLI.

## Verification

- Passed: focused Vitest suites for companion access, bearer auth, admission,
  sign-in token, onboarding, status, health ingress, connection lifecycle,
  contact-card redemption, meal-photo paid-boundary mapping, runtime signal,
  and reconciliation (8 files, 371 tests).
- Passed after the final reconciliation tightening: focused reconciliation
  facts suite (1 file, 48 tests).
- Passed after the round-5 correction: focused runtime event, system-mailbox,
  assistant-phase, and entrypoint suites (4 files, 606 tests), including dirty
  continuation after a successful receipt, clean marker clearing, restricted
  automation suppression, exact-item re-execution, remaining-item marker
  retention, device-only route execution, and preservation of unrelated
  accepted system work without executing its pending route actions, plus an
  intermediate canonical commit that retains the exact paused continuation
  when the final checkpoint fails.
- Passed after the round-4 corrections: hosted dirty-ack authority suite (1
  file, 48 tests), including shared-transaction pending queries and both
  serialized ingress/acknowledgement commit orders.
- Passed after the fourth diagnostic round-5 correction: affected device-sync
  runtime suites (4 files, 448 tests), including a cold-restored paused system
  mailbox that imports a companion HRV observation from a credential-free
  snapshot, leaves a higher-priority direct-provider reconcile queued, and
  makes zero provider requests until an ordinary active pass runs it.
- Passed: the full device-syncd suite (44 files, 884 tests).
- Passed after the fifth diagnostic correction: the 78-test hosted device-sync
  classifier suite plus three existing Junction provider-path tests prove that
  all source-reference aliases require provider lookup, self-contained inline
  imports do not, and active/default execution retains its lookup behavior.
- Passed: `pnpm --dir apps/web typecheck:prepared`, assistant-runtime
  typecheck, and Cloudflare typecheck.
- Passed: ESLint over every changed Web TypeScript file.
- Passed: focused Cloudflare runner identity/egress-fence proof (2 files,
  3 selected tests).
- Passed after the later round-5 correction: Cloudflare transport-failure
  recovery suite (1 file, 24 tests), including recovery of a zero-lag paused
  device continuation from an intermediate canonical commit.
- Passed after the later round-5 correction: hosted runner bundle assembly and
  parity probes; the latest exact macOS assembly measured a 7,982,116-byte
  static closure and 9,959,861-byte total under the 9,992,629-byte ratcheted
  ceiling.
- Authored: a production-path hosted local E2E that cold-restores a paused
  member, submits 17 distinct companion observations without waiting for each
  one to drain, crosses the dirty-ack boundary, and asserts zero
  assistant-provider requests. Local execution is blocked before test start
  because Docker is not installed (`spawn docker ENOENT`); the test remains
  available for a Docker-capable hosted-local lane.
- Passed: `git diff --check` and changed-line direct-identifier review; only
  pre-existing synthetic fixtures appeared in whole-file scanning.
- The first reviewed head passed exact-head GitHub Actions and preliminary
  specialist review. Final ReviewGPT round 1 returned accepted lifecycle,
  contact-card, meal mapping, and deterministic-runtime findings; those
  findings produced the remediations above.
- Final ReviewGPT round 2 found that import-only paused processing could advance
  the Web watermark while leaving device-sync dirty state local and unexecuted.
  The accepted finding is remediated by the exact device-only execution and
  retry contract above.
- Final ReviewGPT round 3 found that a successful acknowledgement could still
  report dirty work after overlapping ingress, and that the restricted
  device-sync action still scheduled device-activity automations. The accepted
  findings are remediated by propagating the existing `stillDirty` result into
  the existing retry marker, suppressing automation scheduling only for the
  exact restricted action, bursting the hosted-local backlog test, and
  documenting lane-contiguous import-time effects for already accepted work.
- Final ReviewGPT round 4 found that the runtime deleted an executable local
  device item when its acknowledgement remained dirty, the Web acknowledgement
  could interleave with companion ingress, and the retry marker did not include
  a second exact local device item. The accepted findings are remediated by
  requeuing the same item without its spent receipt, sharing the existing
  health-data admission lock, and deriving marker retention from exact local
  device work.
- A diagnostic round-5 capture had inconclusive textual model attestation but
  identified a real final durability gap: the restricted branch returned its
  post-receipt marker and wake without committing the ordinary final
  `idle_shutdown` snapshot. The correction reuses that existing snapshot owner,
  and a focused entrypoint regression proves the exact local item, marker, and
  wake are inside the committed snapshot before return. The same substantive
  round number must be retried because the diagnostic capture is not a valid
  reviewed round.
- The same-number diagnostic retry again had inconclusive textual model
  attestation and found that Cloudflare could accept an earlier canonical
  checkpoint after a failed final snapshot. That earlier checkpoint advanced
  the imported system watermark without the exact paused marker. The correction
  projects the existing exact local item, marker, and device wake into every
  recoverable intermediate canonical commit while retaining the final clean
  snapshot as the only clearing boundary. Runtime entrypoint coverage injects
  the final checkpoint failure, Cloudflare recovery coverage preserves the
  marker and wake after transport failure, and the existing Web facts coverage
  admits that pair at zero system lag.
- A third same-number diagnostic capture again had inconclusive textual model
  attestation and found that a future first device item could block a fresh
  successor without reporting progress. The raw final pass status then erased
  the inherited marker even though both exact local items remained. The
  correction makes intermediate and final checkpoint projection share one
  exact local-queue reread, retains the phase-owned backoff time when present,
  and clears an inherited paused marker and paired wake only after the final
  reread is empty. A cold-restore entrypoint regression imports the successor,
  proves zero-lag marker/wake retention with both local items intact, then
  drains the queue and proves the final clean boundary clears the pair.
- A fourth same-number diagnostic capture again had inconclusive textual model
  attestation and found that the restricted action still entered the full
  device-sync lifecycle: it fetched credential material, ran the all-account
  scheduler, and let the generic worker claim direct wearable-provider jobs.
  The correction reuses the existing credential-free snapshot option and
  credential-independent job classifier, skips provider scheduling and
  unrelated device maintenance, and filters both seed and batch claims while
  leaving credential-scoped jobs and their wake projection to the ordinary
  active/default pass. Focused service, maintenance, event-bridge, and runtime
  entrypoint regressions prove the restricted boundary, including a
  production-path cold restore that completes credential-independent companion
  import work while direct wearable-provider egress remains at zero.
- A fifth same-number diagnostic capture again had inconclusive model
  attestation and found that the inherited Junction inline classifier proved
  only independence from replaceable connection credentials. Source-reference
  sleep or sleep-cycle jobs still use the platform Junction key for a
  provider-list lookup. The correction shares the executor's pure lookup
  predicate with the restricted worker authority, leaving those jobs queued
  until active/default processing while self-contained inline imports remain
  eligible.
- A sixth same-number diagnostic capture again had inconclusive model
  attestation and found that generic `stillDirty` acknowledgement semantics
  could requeue a paused item forever when only provider-dependent payloads
  remained. The correction takes paused retry timing from the restricted local
  worker schedule, retires deferred-only items and stale device wakes, and gives
  every newly accepted companion payload a deterministic payload-identity
  mailbox handoff. The production-shaped cold-restore regression starts with a
  persisted Junction source-reference payload, proves zero paused provider
  egress and a dormant durable payload without a retry loop, then proves the
  ordinary active pass still executes the provider lookup.
- Passed after the sixth diagnostic correction: the three central hosted
  runtime suites (3 files, 596 tests) and the focused Web hosted device-sync
  wake suite (1 file, 117 tests). The production-shaped runtime case proves a
  deferred provider payload cannot preserve a paused marker or immediate wake,
  while the Web case proves a later accepted companion payload receives its
  own deterministic handoff while the connection remains dirty.
- Passed after the sixth diagnostic correction: assistant-runtime and Web
  typechecks, scoped Web ESLint, agent-docs drift, `git diff --check`, and the
  changed-diff direct-identifier scan.
- Required after remediation: final ReviewGPT round-5 retry and exact-head
  GitHub Actions.
- Passed after the user-requested review-tool refresh: npm `latest` and the
  workspace-installed CLI both report 0.5.124; frozen install, CLI typecheck,
  and the directly coupled release/configuration coverage suite pass. The
  final review retry must run from that workspace-installed version on the
  exact remediated head.
