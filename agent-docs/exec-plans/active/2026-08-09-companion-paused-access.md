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
  denial.
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
   conversation and ordinary workspace-wake authority; execute only the
   existing `run-device-sync-wake` route in model-free system-mailbox mode; and
   retain the provider-egress fence. An exact persisted retry marker may retain
   only that device-sync route's `device-sync.reconcile` wake.
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
  imports and executes only `run-device-sync-wake` through the existing durable
  checkpoint and acknowledgement flow; it does not enter assistant automation,
  conversation work, delivery, or model admission. A failed preparation or
  post-checkpoint receipt may persist one exact device-sync retry marker and
  `device-sync.reconcile` wake, which is cleared after a successful receipt.
- The native repository has no release tag or other durable mapping from the
  App Store binary to a source commit. Compatibility is therefore based on the
  unchanged HTTP shapes plus inspection of the current native resume/connect
  and error contracts; do not claim exact released-binary/source identity.

## Verification

- Passed: focused Vitest suites for companion access, bearer auth, admission,
  sign-in token, onboarding, status, health ingress, connection lifecycle,
  contact-card redemption, meal-photo paid-boundary mapping, runtime signal,
  and reconciliation (8 files, 371 tests).
- Passed after the final reconciliation tightening: focused reconciliation
  facts suite (1 file, 48 tests).
- Passed: complete focused assistant runtime phase and entrypoint suites
  (2 files, 551 tests), including preparation retry, receipt retry, successful
  marker clearing, device-only execution, and preservation of unrelated
  system-work wake authority.
- Passed: `pnpm --dir apps/web typecheck:prepared`, assistant-runtime
  typecheck, and Cloudflare typecheck.
- Passed: ESLint over every changed Web TypeScript file.
- Passed: focused Cloudflare runner identity/egress-fence proof (2 files,
  3 selected tests).
- Passed: hosted runner bundle assembly and parity probes; measured total
  9,948,429 bytes under the 9,981,197-byte ratcheted ceiling.
- Authored: a production-path hosted local E2E that cold-restores a paused
  member, accepts 17 distinct companion observations, crosses the dirty-ack
  boundary, and asserts zero assistant-provider requests. Local execution is
  blocked before test start because Docker is not installed (`spawn docker
  ENOENT`); the test remains available for a Docker-capable hosted-local lane.
- Passed: `git diff --check` and changed-line direct-identifier review; only
  pre-existing synthetic fixtures appeared in whole-file scanning.
- Passed on the first reviewed head: exact-head GitHub Actions, preliminary
  specialist ReviewGPT, and final ReviewGPT round 1. Accepted round-1 findings
  produced the lifecycle, contact-card, meal mapping, and deterministic runtime
  remediations above.
- Final ReviewGPT round 2 found that import-only paused processing could advance
  the Web watermark while leaving device-sync dirty state local and unexecuted.
  The accepted finding is remediated by the exact device-only execution and
  retry contract above.
- Required after remediation: final ReviewGPT round 3 and exact-head GitHub
  Actions.
