# KMS and Garmin production recovery

Status: completed
Created: 2026-08-20
Updated: 2026-08-20

## Goal

- Restore reliable hosted encrypted-state reads during transient Cloud KMS latency and determine the smallest truthful recovery for connected Garmin sources that have stopped delivering data.

## Product UX

- Outcome: Existing members can complete hosted Web journeys that need encrypted state, while members with stale Garmin data receive an accurate recoverable status.
- Reaches: Hosted connect, experiment, and invitation-success reads; existing Junction-backed Garmin connections and their source-health journey.
- Proof: Focused failure/recovery tests at the KMS boundary, source-health recovery tests if behavior changes, and redacted production-log/state validation after deployment where authorized.

## Success criteria

- Transient retryable KMS failures receive one bounded retry without retrying terminal failures or weakening authentication/envelope validation.
- Hosted request latency remains explicitly bounded and existing successful decrypt behavior is unchanged.
- The five stale Garmin sources are classified from provider/runtime/control evidence, with code changed only if an existing recovery promise is broken.
- Focused tests and relevant package typechecks pass.
- Required review, CI, privacy, changelog, and PR gates complete on an exact pushed head.

## Scope

- In scope: hosted GCP KMS call policy; callers that consume the existing domain-root owner; Garmin/Junction stopped-delivering classification and its existing recovery path; focused tests and required durable docs/changelog.
- Out of scope: new cryptographic architecture, new queues/state owners, broad provider resyncs, unrelated Junction webhook-source admission failures, and manually mutating member health data.

## Constraints

- Technical constraints: preserve authenticated encryption and provider authority; keep retries idempotent, narrowly classified, and bounded; do not place network work inside database transactions; keep provider-specific recovery in its current owner.
- Product/process constraints: treat production evidence as private; preserve existing onboarding, connect, sync, and invite flows; avoid claiming recovery from an internal retry alone.

## Risks and mitigations

1. Risk: Retrying KMS calls can multiply latency or load during an outage.
   Mitigation: retry only documented transient failures, at most once, within one aggregate deadline budget, with deterministic tests.
2. Risk: Treating provider inactivity as a Murph bug could trigger destructive or noisy reconnect behavior.
   Mitigation: prove the provider/control/runtime boundary first and reuse the existing explicit member recovery journey only when its trigger is incorrect.
3. Risk: Active device-sync branches may overlap implementation surfaces.
   Mitigation: keep this work isolated, inspect active plan paths and current heads, and stop before editing an overlapping owner.

## Tasks

1. Correlate KMS failures with implementation, current provider guidance, tests, and recent changes; define the minimal bounded policy.
2. Correlate stalled Garmin sources across source-health projection, provider scheduling/import, runtime handoff, and current production state.
3. Add focused failing tests, implement only the proven corrections, and run targeted proof/typechecks.
4. Perform Product UX walkthrough and parent diff review; create the changelog decision and exact-head PR evidence.
5. Run required specialist/final review gates with CI, resolve accepted findings, close the plan, and hand off deployment concerns.

## Decisions

- Product UX effort is Patch: this restores existing reliability and recovery promises without adding a new surface, audience, or data source.
- KMS and Garmin stay separate ownership seams inside one production-recovery task; neither may add a shared retry/state abstraction without concrete need.
- Google documents Decrypt as idempotent and retries only deadline/unavailable
  failures by default. Keep the SDK's much broader retry budget disabled, but
  give Decrypt one local retry: two ten-second attempts, 100–300 ms of
  abortable jitter, and one 25-second aggregate deadline. Permission,
  authentication, quota, input, integrity, encrypt, and signing failures stay
  single-attempt and fail closed.
- The five Garmin sources are established and recently advertised by Junction,
  have complete historical coverage, and have no provider or import errors;
  their only broken edge is automatic recovery. The existing recovery gate is
  parsed by device-sync but was omitted from the trusted Worker-to-runner
  environment allowlist, so production could never enable it.
- Keep Garmin recovery disabled until a scoped operator attempt proves the
  vendor's gated historical-pull endpoint is enabled. One affected connection
  owns another source, so reset or deregistration is not a safe shortcut.

## Verification

- Commands to run: focused Web KMS tests; focused source-health/device-sync tests if changed; relevant Web/device-sync/query typechecks; diff/privacy checks; required exact-head CI and ReviewGPT gates.
- Expected outcomes: retryable KMS latency recovers within the bounded policy, terminal failures remain immediate, and Garmin status/recovery matches the proven source state without broad resync or data mutation.
- Direct proof completed:
  - Web KMS boundary and official-SDK suites: 34 tests passed.
  - Cloudflare runner environment suite: 48 tests passed.
  - Assistant-runtime device-sync provider config suite: 3 tests passed.
  - Web, Cloudflare, and assistant-runtime package typechecks passed.
  - `git diff --check` passed; production evidence remains summarized and no
    production row contents or identifiers were written to the repository.

## Review record

- Preliminary completion specialists reviewed first head
  `17a0bc5d652b43ce1dda1480e90ac7d3a3bc479d` for Product UX and coverage.
  Product purpose was `Ready` as a Patch; prompt and frontend lenses were not
  applicable.
- One medium coverage finding was accepted: provider-status and aggregate
  timeout tests did not directly prove that an official SDK call hanging past
  its local attempt deadline is canceled before the retry. The parent added
  that exact official-boundary proof; the focused KMS suites now pass 34 tests
  and Web typecheck remains green.
- The optional specialist patch artifact was not applied. Review capture
  metadata could not authorize its download after a managed-browser hydration
  failure, so the parent authored and verified the equivalent test at the
  requested test-only boundary.
- Final ReviewGPT round 1 returned `PASS` with zero findings against the same
  first-reviewed head after a full-snapshot audit. The test-only specialist
  remediation does not create another substantive round.
- Managed-browser capture required manual export after the exact thread rendered
  duplicate response nodes. Both specialist and final exports were accepted
  only after their completed response markers, durations, requested model,
  attachment/response identities, and exact preceding committed user-turn IDs
  were verified against the original capture metadata.
- Exact-head GitHub app/package verification passed on the original candidate
  and on the test-remediated head. Pull-request evidence and Vercel checks are
  green; the protected native iOS lane is not required for this change.
- Parent final review re-read the full task diff and affected KMS, environment,
  runner, and provider-config call paths. No remaining proof gap, privacy leak,
  disproportionate abstraction, or unresolved accepted finding remains. Garmin
  production activation intentionally remains held at the documented provider
  endpoint proof boundary.
Completed: 2026-08-20
