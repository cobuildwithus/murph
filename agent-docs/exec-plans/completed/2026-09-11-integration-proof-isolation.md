# Restore Linq delivery and integration proof

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

Correct the public runtime and test defects blocking trustworthy scheduler integration evidence. The original public runtime ownership fix is merged. After this public correction merges, the completion owner will run the private scheduler integration against the resulting public main before its authorized merge.

## Success criteria

- Identify each failing assertion at its actual runtime or test owner.
- Preserve bounded device progress, exactly one reminder delivery, scoped provider requests, and foreground completion proof.
- Pass affected integration scenarios and relevant typechecking on the candidate.
- Keep required public CI green and obtain final review before merging this correction.

## Scope

- In scope: diagnostic improvements and proven corrections needed for integration proof; local test environment parity.
- Out of scope: unrelated runtime changes and production operations. The broader verification audit is reported separately.

## Constraints

Use synthetic evidence and closed diagnostic fields. Preserve unrelated work. Do not weaken assertions or add unscoped provider responses to hide unexplained retries.

## Risks and mitigations

- A test failure may expose a runtime defect. Trace the actual composed owners before choosing the fix.
- Local database defaults can differ from CI. Validate connection timezone explicitly without changing shared server settings.

## Tasks

1. Reproduce Junction requests and fairness yields with finite failure diagnostics.
2. Trace the foreground Environment completion failure.
3. Make the smallest proven correction and run focused integration proof plus typechecking.
4. Review, commit, obtain required public CI, and hand the merged public head to private scheduler integration.

## Reminder concurrency

- Outcome: A due, authorized reminder can run while a device download remains active, using the existing single assistant and workspace owners.
- Entry and promise: A scheduled occurrence becomes due during a system-only import; its delivery does not await that unrelated download.
- Reaches: Already-due and newly-due reminders, ordinary conversations, blocked assistant execution, empty wake hints, and receipt-capacity recovery.
- Architecture: Extend the existing foreground admission check to canonical due assistant work and wake its existing completion wait at the projected deadline. Retain import claims, canonical write serialization, receipt bounds and snapshot ownership. Add no persisted state, queue, service or processing mode.
- Proof: Hold a synthetic download open, observe one reminder delivery, release and verify one import and exact acknowledgment; preserve blocked-policy and conversation concurrency regressions.
- Done when: Focused composed proof and affected CI pass; no reminder or import duplication and no authorization bypass. Product walkthrough is Ready: focused held-download proof and final full-stack fairness E2E passed.

## Decisions

- Keep the Junction global request-count assertion while identifying any extra request owner.
- A fairness pass may yield before processing jobs; its shutdown barrier must not prevent the retry needed to establish progress.
- Initial local reproduction reached an earlier delivery failure with database-generated timestamps offset from UTC. Test the UTC connection hypothesis before changing behavior.

## Verification

- Scheduler full local verification passed after base reconciliation; exact-head Verify CI passed.
- Fresh integration CI failed Junction request count, fairness positive-progress wait, and foreground Environment completion.
- Cloudflare typecheck completed without diagnostics after adding failure-only fields.
- UTC local Junction reproduction passed all eight cases after the wire-key correction, including exact model-request count and one accepted nudge.
- Operator-config adapter tests passed 81 cases, both affected package typechecks passed, and changelog rendering passed 10 cases.
- Current public main was reconciled without conflicts. Its shared host-upstream correction replaces the temporary per-fixture host URL workaround.
- Fairness proof uses a budget for real log visibility and scheduler backoff; no admission or delivery assertion was relaxed.
- That rerun exposed a production callback replacement: system-mode device work supplied a reminder-only yield predicate, discarding the receipt-capacity predicate after admission. A focused regression failed on the old owner when capacity became exhausted during the pass. Full local fairness E2E passed after restoring that guard, including positive receipt-bounded progress, one accepted reminder and final backlog drain.
- The subsequent reminder-concurrency change removes the override parameter entirely: receipt capacity stays with independent work, and the projected deadline wakes assistant admission. The held-download concurrency suite passed all ten cases; the system-preemption fixture callbacks were then updated to supply their required checkpoint reasons.

## Broader verification audit

1. `scripts/workspace-verify.sh` returns from the repository-internal fast path before honoring `runVerifyCli`. The real diff classifier marks `scripts/build-test-runtime-prepared.mjs` for both; a composed route probe omitted CLI verification.
2. Root configuration and smoke fixture changes can select only generic guards locally. `package.json`, `tsconfig.json`, and `vitest.config.ts` are fast-path roots; smoke fixtures lack a behavior owner. Required broad CI limits this local gap, but the testing map overstates local coverage.
3. Local `verify:acceptance` omits `test:repo-tools`, which required host-support CI runs separately. A local acceptance result therefore does not cover the repository verification tools themselves.
4. `scripts/linq-production-canary-ci.test.mjs` and `scripts/review-gpt-pr-base-fetch.test.mjs` are outside the automatic Node/Vitest inventories. Direct execution works; entrypoint discovery does not include them.
5. Hosted-local process filters validate the number of declared patterns and trust Vitest exit status. An unmatched synthetic pattern exits successfully with all tests skipped. Current patterns match, but there is no guard proving the intended integration inventory is covered exactly once.
6. `apps/cloudflare/test/hosted-local-stale-deferred-replay-e2e.test.ts` is absent from the scenario registry. Its cold restore with a stale invocation is distinct from the registered case that warms the runtime first. Ordinary node tests exclude E2E files.
7. The Web PostgreSQL pool does not enforce the UTC session semantics assumed by the installed Prisma adapter. A read-only adapter probe under a non-UTC database default returned timestamps offset from UTC; the UTC session did not. This is a connection-owner precondition hidden by UTC CI databases. It does not by itself prove the cause of a particular delivery timeout.

8. Non-Linux hosted-local provider forwarding retained `host.docker.internal` as a host-native Worker upstream. On a host without that Docker-only DNS alias, authorized delivery failed before reaching the synthetic stub. Linux selected an explicit bridge address through a different branch. This was independently resolved in main by PR #3254; the candidate now reuses that shared owner and removes its temporary fixture workaround.

Findings 1–7 remain audit findings, not completed fixes. The first three have broader required CI coverage; the inventory omissions affect automatic coverage itself. Finding 8 is resolved by the reconciled main change.

## Candidate progress

- Junction's real device-activity key builder produces a 272-character provider key for synthetic fixture-shaped metadata; Linq accepts at most 255. The stub correctly rejects this send, while the E2E incorrectly counts the observed request as delivery. Preserve the full internal authority key and compact only oversized wire keys at the Linq adapter.
- Product patch outcome: restore authorized activity nudges that fail provider key validation. Reaches: existing-chat text, new-chat text, rich-link siblings, and app-card sends through the shared adapter. Proof: boundary-sized keys, stable retries, distinct sibling keys, and accepted Junction delivery with the original exact model-request count. Model instructions and decisions are unchanged; this is a deterministic transport contract.
- The full ordering process passed all four cases with host-side provider URLs and UTC connections.

- Moved two Environment recovery cases to the existing 10-second ordering process; retained their semantic assertions.
- A missed optional stub parameter in the moved preemption case was corrected; the full ordering process then passed all four cases.
- Harness suite tests passed (32/32); Cloudflare typecheck passed after the scenario corrections.
- Local Linq delivery errors originated in host-native Worker fetch before the stub; UTC corrected database clock offsets but did not resolve this separate network boundary. The shared main fix now owns host reachability.
- The old fairness overlap spent up to 30 seconds observing a zero-job pass and then required at least 30 seconds of progress backoff. The test now budgets two log flushes, the 120-second backoff level, and processing time before its reminder, while keeping the first 30-second admission window unchanged.
- PR #3281 is ready for required CI. Draft checks intentionally do not run broad verification until readiness.

## Final candidate review and verification

- The final reminder-concurrency bundle passed the full local fairness E2E with one accepted reminder, receipt-bounded positive progress and complete backlog drain. Junction passed eight cases and the ordering process passed four cases.
- Final ReviewGPT on `40bac0c47bb34c430d4a31d62653c79ed40bd549` returned PASS, with no qualifying findings. Parent review confirmed the shared admission helper, receipt guard, deadline cancellation, provider key identity and product success paths.
- Required CI on that head passed compatibility, builds/typechecks and all coverage shards except platform-a. Its 18 failures came from two convergence spies retaining the old diagnostic request suffix and two dirty-ack scenarios retaining the old no-assistant expectation.
- Isolated proof corrections retain all convergence assertions and exercise actual default-owned preparation once in the original invocation. They preserve consumed-reminder wake removal, pending-input handoff, future default wakes, checkpoint and shared-projection before acknowledgment, final Browser Vault publication, and the device deadline across restore. Browser-before-ack remains required in dedicated system completion; promoted work uses the existing foreground publication order.
- All 84 tests in the three affected files passed. Runtime typechecking and documentation drift checks passed after the proof correction. Production source remains identical to the reviewed head; isolated test and explanatory evidence changes use the existing review-loop exception.
- Implementation and local product proof are complete. Exact-head public CI and current-base mergeability remain merge gates; after the public merge, the original completion owner must start a new private full-integration run against that public main before merging scheduler PR #132. No separate deployment was performed.
Completed: 2026-09-11
