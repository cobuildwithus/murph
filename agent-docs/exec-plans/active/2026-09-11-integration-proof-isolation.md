# Restore Linq delivery and integration proof

Status: active
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
- Fairness proof is rerunning with a budget for real log visibility and scheduler backoff; no admission or delivery assertion was relaxed.

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
- Draft PR #3281 preserves the candidate while focused integration proof remains incomplete. Draft checks intentionally do not run broad verification until readiness.
