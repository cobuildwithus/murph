# Bound Browser Vault rebuild cost and allow complete background refreshes

Status: active
Created: 2026-09-13
Updated: 2026-09-13

## Goal

- Keep Browser Vault current for larger canonical histories by eliminating repeated full-vault parsing during freshness hashing and allowing a bounded refresh enough time to finish.

## Success criteria

- A synthetic large-history reproduction quantifies the repeated hash work before and after the correction.
- Hash identity, experiment outcome binding, source-change rejection, cancellation joining, earlier invocation deadlines, and foreground preemption remain covered.
- Focused query/runtime tests and typechecks pass; parent review, final ReviewGPT, and exact-head required CI pass on the reviewable functional PR.

## Scope

- In scope: existing Browser Vault source-hash reader, bounded refresh timeout, focused regression proof, and owner documentation.
- Out of scope: device sync, projection semantics, new caches or schedulers, retry policy, production mutations, merge, and deployment.

## Constraints

- Preserve all three source hashes, content-based identity, encrypted write and publication fences, and cooperative cancellation. Any longer default remains capped by the caller deadline.
- Use ReviewGPT for substantive implementation and keep all fixtures and review evidence synthetic. Functional changes remain ready for human merge.
- PR #3391 owns separate Personal Patterns projection semantics; do not adopt or mutate that work.

## Risks and mitigations

1. A narrow experiment reader could miss an outcome dependency or reorder hashes. Compare hash/count/byte identity against the current full reader for mixed synthetic sources, and test outcome/reference mutation.
2. More refresh time could delay foreground work. Preserve wake/abort ownership and prove cancellation and earlier deadline behavior.

## Tasks

1. Measure current full-source hash against existing canonical hash plus experiment-family reading; trace the actual timeout owner and callers.
2. Have ReviewGPT implement the smallest cancellation-aware experiment-source reuse and bounded deadline correction with regression tests.
3. Run focused proof and evaluate product journeys, source consistency, and complexity; prepare changelog and PR.
4. Complete external review and exact-head CI, close this plan, and leave the functional PR ready for human merge.

## Decisions

- Current source hashes read and index every canonical entity three times per refresh solely to discover experiment outcome references. The replica itself performs another strict source read. Canonical byte hashing must remain; unrelated entity parsing during hashing can be removed.
- Product UX effort: Patch. Outcome: existing dashboard data can refresh for larger histories. Reaches: sparse and large vaults, an earlier invocation deadline, a newly arriving foreground turn, source changes, and publication conflicts. Proof: actual refresh owner with synthetic canonical files through published-ref or deferred outcomes. No UI presentation or assistant prompt changes.

## Verification

- ReviewGPT implemented the six-file patch; captured GPT-6 Pro response SHA-256: `4a5e5a42a2431e2a2923bb59826c33afe1e597b26deeea0574d25a039c65fc81`. The parent reused `vault.experiments` in the construction caller instead of filtering the full entity collection again.
- Before the production edit, all five selected runtime budget regressions failed at the old 30-second boundary. Five new query checks failed because the narrow export did not yet exist. The baseline had 32 runtime and 14 query tests passing.
- After the edit: 37 hosted Browser Vault tests and 19 source-manifest tests pass, including identical mixed-source hashes/accounting, malformed and duplicate outcomes, strict experiment errors, aborted child joining, publication after 35 virtual seconds, and a 60-second bound.
- Four composed workspace-entrypoint scenarios pass: earlier assistant deadline, foreground runtime wake, model-free timeout handoff, and one retained delayed retry through projection backoff.
- Query and assistant-runtime package builds and typechecks pass. Workspace-boundary, docs-drift, docs-gardening, and whitespace guards pass.
- Complexity guard passes for all three source files. The pre-existing refresh owner remains 24, with unchanged debt; the small reader adds no hotspot. Further splitting would expand this bounded correction without improving the invariant.
- Changelog copy passes all 10 archive tests. Use `pnpm --dir apps/web changelog:generate`, then the repository-root Vitest command; existing Frog entry `20260912202546-changelog-focused-test` documents the app-directory command failure. No duplicate entry was created.
- A paired synthetic 10,000-event / 3,138,890-byte probe used one warmup pair and five alternating-order pairs through the same production hash owner. Full-vault hydration took 234/189/252/248/264 ms; narrow hydration took 79/77/117/127/102 ms. Hashes/accounting matched in every pair. Median component time fell from 248 to 102 ms (about 59%); this is not hosted end-to-end timing.
- Product UX walkthrough: Ready for the tested patch. Mixed/sparse histories retain output and hash identity; a longer build can publish; foreground wake, abort, and earlier assistant deadlines retain priority; changed sources and conflicts cannot publish. No Murph prompt, interpretation, tool, silence, or reply behavior changed, so a paid model journey is not applicable.
- Parent candidate review: source ownership, strict snapshot construction, all three consistency guards, generation, encrypted write/publication boundary, and unrelated projection semantics are preserved. The normal runtime/query bundle ships together without a new external schema or rollback floor.
- Final ReviewGPT and exact-head required CI remain pending. Production recovery remains unverified until an authorized release and natural refresh.
- Draft PR: https://github.com/cobuildwithus/murph/pull/3410. Final review starts only after the candidate is Ready; this functional PR remains for human merge and release.
