# Remove repeated work from hot reply preparation

Status: completed
Created: 2026-09-09
Updated: 2026-09-09

## Goal

- Reduce hot hosted reply preparation by deleting repeated filesystem and HTTP work. Keep current-conversation attachment access, accepted-input validation, and provider-change handoff intact.

## Success criteria

- Historical attachment discovery no longer rereads every unrelated input on each hot turn.
- Preserve direct/group media follow-ups, frozen attachment authority, retention, live steering, and recovered work.
- Remove demonstrably redundant preparation work without a new service, dependency, or configuration surface.
- Focused tests, affected typechecks, local paired measurements, parent review, and required PR review pass.

## Scope

- In scope: input-store lookup structure; preparation owner reads; provider lifecycle facts carried by existing mailbox transport; bounded regression and performance evidence.
- Out of scope: model inference speed, Temporal scheduling redesign, deployment, unrelated workspace changes.

## Product UX

- Outcome: reduce the delay before an existing hot conversation begins answering.
- Reaches: private/group text replies, retained image/video follow-ups, live steering, and provider-change recovery.
- Proof: paired local service timing, canonical media discovery plus actual model/tool journey, and deterministic scope/retention/handoff tests. No new member controls or copy in the reply flow.

## Constraints

- Extend existing state and transport owners only when a measured bottleneck requires it. Preserve the pre-provider freeze of historical attachment evidence; do not refresh authority from model-writable files during a turn.
- Keep private vault contents and identifiers out of tracked artifacts. Use the supplied archive only through isolated local copies and numeric-only benchmark output.
- Preserve validated current input across lock waits and provider handoff. No production mutation is needed for implementation or local proof.

## Risks and mitigations

1. A faster lookup could omit prior media or trust evidence changed during a turn.
   Mitigation: inspect canonical mutation/restore owners and test historical media, conversation scope, retention, and frozen keys.
2. Removing a configuration request could miss provider changes on recovered work.
   Mitigation: prove each admission receives the fact through its existing mailbox import and retain the existing handoff owner.
3. Local timing could be mistaken for a production guarantee.
   Mitigation: label source revisions, use independent warm native processes with equal fixtures, and report excluded pipeline/network time explicitly.

## Tasks

1. Audit existing input structures, media authority, and awaited HTTP calls.
2. Implement the smallest bounded history lookup and the proven timestamp/directory deletions.
3. Remove the standalone provider configuration read through existing mailbox facts if recovered-path proof holds.
4. Run focused correctness, type, complexity, and assistant journey checks; compare real safe candidates locally.
5. Review the complete diff, document measured effects, and prepare the PR with required review and CI.

## Decisions

- Existing evidence: a 110-event retained fixture costs 110 reads and 550 lstat calls per historical lookup; independent median 154.43 ms. A diagnostic history omission isolated the cost but is not a safe implementation.
- Parallel ownership: input-store design and media integration; timestamp-only read deletion; automation directory preparation; Web/runner HTTP audit; isolated baseline and paired benchmark.
- Keep operator-default reconciliation unchanged until its differing environment inputs and readiness semantics justify a measured consolidation.
- Use a per-conversation media candidate index in the existing input-store state owner. Exact input reads remain authority; no lazy refresh of frozen evidence, process cache, database, or new dependency.
- Carry provider lifecycle facts through the existing mailbox fetch and reuse the existing handoff flag, removing the provider-entry configuration HTTP request.

## Verification

- Focused engine input/media/live-input/store tests and affected workspace typechecks.
- Relevant hosted protocol/Web/runner tests for any mailbox response contract change.
- `pnpm complexity:diff`, privacy/diff review, and repository assistant verification for current-conversation media access.
- Safe baseline/candidate Docker comparison with separate module graphs and native processes; compare accepted-input/provider content in memory without persisting prompts.
- Required PR ReviewGPT and exact-candidate CI; record results before completion.

## Results

- Six combined engine suites passed 102 tests; the final index path-redirection test passed separately. Runtime lifecycle suites passed 68 tests, Web route/provider suites 144, protocol 49, Cloudflare 216, system-mailbox/expiry/notification 171, and changelog rendering 10. All five affected package/app typechecks and canonical runner bundle/parity checks passed.
- The focused real Codex retained-image journey passed with gpt-5.6-terra through local subscription auth: list, one selected image materialization, correct color answer, no resend request. Product UX: Ready for the tested journeys.
- A paired offline Docker test on retained data reduced actual-conversation media lookup from 159.92 ms to 8.44 ms median. All 12 measured pairs were faster and complete authority arrays matched. Warm I/O fell from 111 reads, 555 lstat and one readdir to five reads and 25 lstat. First index construction cost 301.72 ms versus 165.09 ms for the baseline lookup; that one-time cost is separate from warm samples.
- Direct service-to-provider medians were 371.17 ms baseline and 151.65 ms candidate; median within-pair saving 194.33 ms. A synthetic group with three accepted inputs measured 326.97 ms and 88.83 ms; paired saving 259.13 ms. Each scenario used three warmups and 12 measured pairs, separate native processes/module graphs/vaults, and validated warm resume and accepted-input order. These exclude the hosted foreground pipeline and real Web callback, so they are not production guarantees.
- Baseline bundle source was 475c2f4602476fa170325d1e0a3728543b5bf56c. Candidate source is 2f6df514e5afb971080056746658d99178182a96 (base 90085f6103cf667335fd50301735dabcb91d09ed); canonical bundle source fingerprint 2ebc4d1167607ae169f8d401fc6012cbfd787e160ba7902c3ff157efb4437507. Relevant preparation owners had no intervening base changes.
- Complete initial and two resumed provider inputs matched in memory for both routes. Initial serialized model input was 28,179 tokens / 128,019 bytes for direct and 21,263 tokens / 99,160 bytes for group at both versions. Counts use gpt-tokenizer 3.4.0/o200k_harmony, excluding installation/routing/cache metadata only; generated item ids and harness paths are normalized. These are serialization counts, not billed usage. No prompts were persisted.
- PR: https://github.com/cobuildwithus/murph/pull/3107. Round 1 reviewed 72e66d1ff2d1e34002943fca2b32235e024d4ea4 and returned PASS with no qualifying findings; response identity and gpt-6-pro metadata match, with more than nine minutes of review on the Mountain lane.
- Broad CI independently found dropped prototype-backed mailbox methods and stale provider/query fixtures. The wrapper now explicitly binds the existing methods, preserves optional-method absence, and deletes its redundant port alias/fallback. Migrated causal tests exposed a delayed provider handoff; the existing checkpoint deadline now advances immediately on observed handoff. No extra timer, state, or settings request is added.
- A pre-existing audio fixture crossed its 14-day retention cutoff during verification. Before/after clock-controlled reproduction isolated the cause; the test now fixes Date within its fixture lifetime while retaining real timers and all abort/retry assertions.
- Final remediation proof passed 119 runtime tests and 42 additional Web tests, with both affected typechecks and a rebuilt canonical runner bundle with import/CLI parity checks. The complexity guard passes: runtime debt 564 to 558, maximum 252 unchanged. Three provider-mismatch cases retain their under-650 ms handoff checks; the matching case retains its at-least-850 ms idle check. The measured engine/service owners are unchanged by these runtime wrapper corrections.
- Round 2 reviewed 82e7c13f741b39afcc190d76ca1d0da78d361562 as a full sensitive snapshot, with the immutable first head and both ancestry checks verified. It returned PASS with no qualifying findings and confirmed both runtime corrections. Exact turn, response hash, gpt-6-pro response metadata and completion marker match; invocation elapsed 954.63 seconds on the original Mountain thread. Both review rounds have zero accepted unresolved findings; no review finding was rejected.
- Corrected-candidate CI finished with 33 successful contexts and two skipped, including all package coverage, Web shards, release aggregate and required hosts. Only viewport installation failed: public Chrome package metadata was independently inconsistent even without cache. The installed browser writes google-chrome.sources, while runner cleanup only removed legacy list files. The CI installer now removes that unused source and retains signed Ubuntu dependency installation, fonts and all browser checks. Its five focused tests and tooling typecheck pass.
- Parent final review is complete. The final commit closes this plan and includes only isolated CI setup/proof changes after the reviewed production head; these do not require another substantive review. Final-head CI and current-base mergeability are recorded on PR #3107. Deployment remains outside this task; production timing is unmeasured.
Completed: 2026-09-09
