# PR 528 final audit remediation

Status: completed
Created: 2026-07-12
Updated: 2026-07-13

## Goal

- Validate every corrected-head ReviewGPT finding and make reminder route recovery reachable, lossless, and deployment-safe without introducing a new queue, scheduler, or lifecycle owner.

## Success criteria

- Each of the five audit findings is accepted or rejected with concrete code-path evidence.
- Proven defects receive the smallest owner-aligned correction with focused regression coverage.
- Relevant package tests, typechecks, completion audits, exact-head CI, and review threads are clean.
- One substantive ReviewGPT audit covers the final PR-specific head; base-only movement may reuse it.

## Scope

- In scope: hosted Linq route-transition proof persistence, selected-input refresh accounting, exact-target repair, deployment compatibility, focused tests, durable operational docs, PR evidence.
- Out of scope: new schedulers/queues/managers, inferred route authority, unrelated CLI package-shape behavior unless proven to originate in this PR.

## Constraints

- Technical constraints: exact web-attested route proof only; atomic core repair; no broad history scan; retry via existing mailbox/workspace checkpoint semantics.
- Product/process constraints: preserve product-critical replies and quota enforcement; serial heavy verification; no duplicate browser audits; deploy consumer before producer.

## Risks and mitigations

1. Risk: A fix consumes or loses the only proof before repair commits.
   Mitigation: retain proof in canonical pending input and abort checkpoint on repair failure.
2. Risk: a compatibility fix expands into speculative infrastructure.
   Mitigation: prefer deletion, ordering, additive parsing, and existing owner boundaries.
3. Risk: a PR-specific edit invalidates the completed audit.
   Mitigation: stabilize and push one corrected head, then run exactly one fresh audit for that head.

## Tasks

1. Validate the five corrected-head findings against production paths and invariants.
2. Implement and test only proven minimal corrections.
3. Run required local verification and completion audits; commit and push the scoped correction.
4. Obtain one exact-final-head ReviewGPT audit and resolve any proven follow-up.
5. Clear exact-head CI, review threads, base compatibility, and PR evidence.

## Decisions

- UNKNOWN model attestation on the completed substantive audit is accepted after more than ten minutes and will not be retried for attestation.
- Accepted: transitions that completed before proof-bearing mailbox metadata existed cannot be recovered from a later current-home input alone. The bounded correction is an explicit operator command over audited retained former-route input IDs; it reuses the atomic canonical repair and never scans generic history.
- Accepted: the web transaction previously rebound the durable home route before daily-quota admission, so a rejected input could consume the only reproducible transition. Quota admission now precedes binding and proof emission.
- Accepted: background refresh could append input IDs after initial selection while maintenance returned only the original IDs. The hosted input source now exposes its evolving selected-ID snapshot at return time.
- Accepted: requiring one global current target discarded valid sequential transitions. Repair now unions every exact former/current target attested by the selected inputs and still mutates only matching legacy personal routes.
- Accepted: emitting transition metadata before the deployed consumer understands it is unsafe, and current-route snapshots establish a runner rollback floor. The web producer is default-off until an immediate consumer rollout and exact-input migration complete; deployment docs define the hard rollback floor after enablement.

## Verification

- Focused Vitest: assistant-engine 24/24, assistant-runtime 76/76, and hosted web 147/147 passed.
- Owner typechecks: assistant-engine, assistant-runtime, and hosted web passed.
- Direct scenario: the package-owned repair command renders its identifier-free help and refuses mutation without explicit `--apply` plus at least one exact input ID.
- Parent security/privacy review: no evidence-backed medium-or-higher finding; webhook authentication, member/vault scoping, exact-input authority, atomic writes, and count-only operator output remain intact.
- Parent coverage/proof review: no missing high-value proof after the focused producer-flag/quota, late-refresh, sequential-transition, atomic-repair, and CLI parser cases.
- `pnpm test:diff` passed global guards, all affected typechecks, assistant-cli (131 tests), assistant-engine (2,055 tests), assistant-runtime (1,528 tests), and assistantd (40 tests). Its unrelated CLI dependent failed because an ignored runtime-artifact repair lock remained present, causing 119 subprocess timeouts; one additional CLI static test found the expected missing `packages/core/dist/index.js` build artifact. The PR does not modify the CLI, core build, or repair-lock owner.
- Remaining: final scoped commit/push, exact-head ReviewGPT audit, exact-head CI, thread/head/base alignment.
Completed: 2026-07-13
