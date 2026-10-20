# Correlate cleanup failures with canonical purge outcomes

Status: active
Created: 2026-10-19
Updated: 2026-10-19

## Goal and invariant

Allow an authorized read-only investigation to join an existing orphan cleanup warning to the exact canonical resource revision and its eventual purge acknowledgement. Preserve cleanup authority, retirement, acknowledgement, retry pacing, deadlines and privacy. This telemetry does not fix an unexplained transport failure.

## Owner and proven gap

The existing Web runtime-resource-cleanup owner emits resource kind, stage and error category. Its warning has no exact-resource correlation. A subsequently empty backlog cannot establish which warning recovered. Canonical orphan rows already own identity, revision and purge outcome; derive a purpose-specific fingerprint from those fields without adding state or an observation owner.

## Scope and exclusions

Extend existing orphan failure warnings and focused owner tests. Document the exact synthetic hash recipe at the owner. Keep media warnings unchanged if correlating them requires unrelated restructuring. No schema, dependency, successful-request log, new infrastructure, provider mutation, arbitrary retry or timeout change.

## Risks and proof

- Privacy: hash only validated inert identity fields with unambiguous domain separation; never emit raw identifiers or payloads.
- Diagnostic failure: hostile getters, proxies and logger failures must not change cleanup effects or escape.
- Cost: compute only for existing bounded failure warnings, with no database or external work.
- Correctness: demonstrate stable recomputation and separation by each identity component and revision; prove warning failures preserve acknowledgement/requeue behavior.

## Tasks

1. [x] Establish the telemetry gap, inspect owner and open PR paths, create isolated checkout.
2. [x] Obtain ReviewGPT-authored minimal patch and critically inspect it.
3. [x] Prove regression before/after, run focused owner tests and Web typecheck.
4. [ ] Parent review, scoped commit, draft PR, final ReviewGPT and exact-head CI.
5. [ ] Merge/deploy via canonical workflow and verify serving revision.
6. [ ] Immediate read-only check, then native half-hour observation for four hours, if native heartbeat access is available.

## Verification and handoff

The existing diagnostic tests and cleanup lifecycle tests cover effect preservation. No user-visible behavior changes; internal telemetry requires no public changelog or assistant journey. Preserve underlying timeout and unexercised-path findings. Native automation-management tools are unavailable in this session; do not build replacement monitoring infrastructure. Resolve that concrete observation boundary before claiming four-hour completion.

ReviewGPT authored the implementation and proof. The original suite passed 37 tests; applying the expanded assertions to the original implementation produced 33 failures and 29 passes because the fingerprint was absent. The final native Vitest suite passes all 62 tests. Web typecheck and the complexity diff guard pass; changed-source complexity debt remains zero and maximum complexity remains 19. Parent inspection confirmed hashing runs only inside existing bounded warning paths and adds no awaited work or cleanup effects.

## Decisions

ReviewGPT authors substantive telemetry under the standing sweep instruction. Production investigation remains read-only. Unrelated worktrees and open PRs stay untouched.
