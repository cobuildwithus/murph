# Restore Temporal release integration fixtures and deploy recovery

Status: completed
Created: 2026-09-17
Updated: 2026-09-18

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
- Preserve snapshot rejection authority while returning a conflict for mismatched managed-upload completion metadata.
- No production defaults, routing policy, or schedule changes.

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
- Passed: PR #3558 exact-head required public CI and final ReviewGPT; merged.
- Fresh full integration passes Temporal orchestration but exposes three remaining blockers: managed snapshot identity rejection becomes HTTP 500, the fairness observer requires a retired admission event, and the media fixture's idle period exceeds its completion deadline.
- Passed: 357 snapshot/outbound and admission-window tests, Cloudflare typecheck, and the complexity guard for the follow-up correction. PR #3570 passed final ReviewGPT and exact-head CI and merged. Fresh integration passed checkpoint durability and fairness; its media lane reached a later provider-handoff scenario and exposed a one-shot webhook sender that omitted the existing bounded retry contract. Reuse the common signed sender; retain the handoff race and all provider/completion assertions. The later full integration and admission run passed.
- PR #3574 passed exact-head CI and final ReviewGPT, then merged the shared sender correction. A fresh integration candidate exposed a redundant lost-operation test expiry after the runtime fence was already cleared. PR #3576 removed that call while preserving recovery and subsequent fresh-message assertions; focused test-control checks, typecheck, exact-head CI, and final ReviewGPT passed.
- Passed: both release builds and all 14 composed Linux integration lanes on the final candidate.
- Passed: exact-source admission, synthetic and protected-history replay, and the normal protected worker deployment.
- Passed: read-only checks confirmed the fixed worker is Current, recurring recovery sweeps complete with the bounded continuation response, and the former worker is suspended.
- No production schedule changes, manual routing overrides, rollbacks, or failed-run replays were needed.

## Review disposition

- Final ReviewGPT round 1 found that ordinary mailbox signals require active access, so the paused-member fixture would fail before Temporal admission. Accepted.
- Correct only isolated test scaffolding: append while active, pause billing, and forward the existing committed-checkpoint input through the test helper. Assert acknowledgement and retain every retention/ownership assertion. Production access and runtime owners are unchanged.
- The Non-Production Remediation exception applies: only test files and this plan change; no production source, configuration, runtime artifact, external state, or data changes.
- All 33 signal-owner tests pass, including added paused-member checkpoint cases and existing expected-owner rejection. Round 2's isolated type-boundary finding was corrected and round 3 passed before merge.

- Exact-head CI exposed a cross-app type boundary in the test helper: importing the production signal input type pulled Web internals into the Cloudflare typecheck and widened the local system-only checkpoint seam. Derive the optional input from the existing isolated test interface instead. Cloudflare typecheck passes; before/after helper JavaScript is byte-identical. The in-progress round-2 snapshot remains immutable and its result will be retained.
Completed: 2026-09-18
