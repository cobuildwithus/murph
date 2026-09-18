# Restore Temporal release integration fixtures and deploy recovery

Status: active
Created: 2026-09-17
Updated: 2026-09-17

## Goal

Restore full integration coverage so the reviewed Temporal recovery-sweep response parser can reach production.

## Success criteria

- Hosted-local fairness and Temporal scenarios exercise current contracts and pass.
- Exact-head CI and final ReviewGPT pass for the public fixture correction.
- A fresh immutable public/private source pair passes worker release admission and protected deployment.
- Read-only production checks confirm the new Current worker and successful recovery sweeps.

## Scope

- Update stale E2E setup and assertions: minimum runner idle TTL, system work without recent iMessage inbound, and inactive-member retention.
- Preserve model-free processing, pending-mailbox ownership, retention and non-starvation assertions.
- No product behavior, production defaults, routing policy, or schedule changes.

## Constraints

- The normal protected private release workflow owns deployment and production credentials.
- Any source drift requires a fresh integration candidate; no bypass or rollback.
- Preserve unrelated work and use synthetic test members only.

## Risks and mitigations

1. An obsolete engagement-block assertion can conceal a retention regression. Keep explicit retention completion, inactive access, unconsumed mailbox, cleared pointer, and no-model-turn checks.
2. Other merges can invalidate a release tuple. Recheck current heads at each gate and dispatch a fresh candidate when necessary.

## Tasks

1. Correct the two stale integration fixtures and run focused scenarios.
2. Review the diff, obtain exact-head CI and final ReviewGPT, then merge the scoped public PR.
3. Dispatch the normal private worker release and follow admission and deployment.
4. Verify live routing and bounded post-deploy recovery results.

## Decisions

- Existing public PR #3551 already corrected the checkpoint test-control failures; do not duplicate that fix.
- iMessage inactivity belongs to proactive delivery gating, not global system processing.

## Verification

- Passed: four focused runner lifecycle/TTL unit tests; complexity diff and whitespace checks.
- Passed: 67 Web reconciliation/frontier tests and the production runner bundle build.
- Local composed E2E proof is unavailable: Docker runner init exits before scenario execution because child-subreaper support is absent. The owned attempt was stopped; full Linux release integration remains mandatory before deployment.
- Pending: exact-head public CI, final ReviewGPT, private full integration and release admission.
- Pending: read-only production routing and recovery-sweep outcomes.

## Review disposition

- Final ReviewGPT round 1 found that ordinary mailbox signals require active access, so the paused-member fixture would fail before Temporal admission. Accepted.
- Correct only isolated test scaffolding: append while active, pause billing, and forward the existing committed-checkpoint input through the test helper. Assert acknowledgement and retain every retention/ownership assertion. Production access and runtime owners are unchanged.
- The Non-Production Remediation exception applies: only test files and this plan change; no production source, configuration, runtime artifact, external state, or data changes.
- All 33 signal-owner tests pass, including added paused-member checkpoint cases and existing expected-owner rejection. Final round 2 and exact-head CI remain pending.

- Exact-head CI exposed a cross-app type boundary in the test helper: importing the production signal input type pulled Web internals into the Cloudflare typecheck and widened the local system-only checkpoint seam. Derive the optional input from the existing isolated test interface instead. Cloudflare typecheck passes; before/after helper JavaScript is byte-identical. The in-progress round-2 snapshot remains immutable and its result will be retained.
