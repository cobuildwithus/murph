# WHOOP BLE HRV ingestion

Status: completed
Created: 2026-07-10
Updated: 2026-07-11

## Goal

- Let the iOS companion derive a bounded spot RMSSD observation from a user-initiated direct WHOOP 5/MG BLE capture and send only the compact typed result into Murph's canonical hosted vault path.

## Success criteria

- A bearer-authenticated companion route validates and accepts only bounded derived RMSSD observations; raw RR intervals and BLE packets are rejected.
- Accepted observations are durably staged, wake hosted device sync, and import idempotently through importer/core ownership as canonical `hrv` milliseconds.
- The resulting query projection resolves as `hrv-rmssd` with explicit direct-WHOOP provenance.
- Synthetic end-to-end tests prove auth, validation, replay/idempotency, dirty-state handoff, canonical import, and query visibility without real health data.
- Durable architecture, privacy, and device-provider docs describe the boundary and deploy compatibility.

## Scope

- In scope: companion API contract and route; hosted staging/wake wiring; provider/importer normalization; canonical/query proof; docs and tests.
- Out of scope: raw BLE packet or RR persistence/upload; background overnight capture; WHOOP proprietary daily Recovery/HRV recreation; Apple Health writes; public release authorization.

## Constraints

- Preserve existing Privy bearer auth and launch-consent gates.
- Keep raw beat intervals on-device and in memory only.
- Reuse canonical device import/core/query owners; no direct vault writes or health truth in Postgres/runtime state.
- Keep the ingress additive and deploy the runtime consumer before web begins
  accepting observations.
- Preserve unrelated work and avoid new dependencies.

## Risks and mitigations

1. Risk: health data leaks through payload persistence or diagnostics.
   Mitigation: allowlist a compact derived envelope, encrypt dirty payloads, reject unknown/raw fields, and log metadata only.
2. Risk: retries create duplicate observations.
   Mitigation: require a client-generated capture id and derive stable provider/external references from it.
3. Risk: RMSSD is confused with Apple SDNN or WHOOP's proprietary overnight value.
   Mitigation: persist the method explicitly as RMSSD, document the spot-capture window, and keep Apple SDNN separate.
4. Risk: mixed deployment drops accepted observations.
   Mitigation: use additive resource jobs; deploy the runtime consumer with an
   immediate container rollout and runner-fingerprint/functional smoke before
   web acceptance, release iOS last, and reverse that order after staged jobs
   drain during rollback.

## Tasks

1. Trace existing companion auth, hosted dirty-state, importer/core, and query contracts.
2. Define the smallest derived-observation contract and provider ownership.
3. Implement importer/runtime support and canonical round-trip tests.
4. Implement the authenticated companion ingress and durable wake handoff.
5. Add route, privacy, idempotency, and handoff-boundary tests.
6. Update durable architecture/device docs.
7. Run required verification, security/privacy and coverage audits, final review, commit, push, PR, and ReviewGPT loop.

## Decisions

- Upload only a derived spot RMSSD observation plus bounded quality/method metadata; never upload raw RR intervals or BLE frames.
- Treat Apple Health HRV SDNN as a separate comparison/fallback metric rather than relabeling it as RMSSD.
- Keep direct WHOOP BLE transport and parsing in the iOS repo; the monorepo begins at the typed derived-observation ingress.
- Use explicit deployment order instead of a per-request availability probe:
  runtime consumer first with an immediate container rollout plus
  runner-fingerprint and functional smoke, then web acceptance, then iOS;
  rollback web acceptance first, drain, then runtime.
- Treat each capture UUID as immutable: exact compact-envelope replay is idempotent, while changed content under the same UUID is rejected.
- Keep origin confidence and the bounded BLE pulse-interval method in query output instead of promoting limited readings to high confidence.

## Verification

- `pnpm test:diff apps/web packages/contracts packages/device-syncd packages/importers packages/core packages/query`
- Focused companion route, provider/importer, and canonical query tests.
- Direct synthetic ingress-to-vault scenario with replay.
- `git diff --check` and privacy/path scans.

## Progress

- Recovered backend and iOS work that had stopped during stash application; resolved the overlapping companion-metadata changes without discarding either lane.
- iOS simulator verification passes 91/91 MurphCompanion tests and 46/46
  MurphBluetoothSpike tests.
- The full backend diff lane passes package/app typechecks and tests; the web
  suite passes 4,270 tests with its existing skips, and the minimal frozen-lockfile
  install plus scenario, docs-drift, dependency-guard, and ignored-build checks pass.
- Coverage audit added canonical-vault local-day proof and exposed a UTC-day
  bug; the normalizer now uses the vault timezone and the full importer suite
  passes. Security review exposed malformed-body detail reaching shared logs;
  the route now replaces JSON parse errors with a fixed error and the regression
  proves raw markers stay out of every console level.
- Final security review reports no remaining medium-or-higher finding, and the
  post-review diff lane plus repository guards pass.
- Remaining: scoped commits, base reconciliation, pushes, PRs, and final-head
  CI. The real-device 60-second scenario is unavailable because no physical
  iOS device is connected.
Completed: 2026-07-11
