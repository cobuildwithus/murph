# Explain failed captured vault-share offers with bounded diagnostics

Status: completed
Created: 2026-10-18
Updated: 2026-10-18

## Goal

- Distinguish captured vault-share offer failures at the existing warning boundary without changing publication or recovery behavior.

## Success criteria

- Fixed typed reasons separate serialized-size rejection, thrown delivery, and an explicit failed scope. Earlier discovery/capture failures may continue to omit this new offer-only field.
- Synthetic partial-success reproductions expose the missing distinction on base and prove the new diagnostic on the candidate, with identical outcomes, call order, and continuation behavior.
- Focused tests, typecheck, complexity, privacy inspection, final ReviewGPT, and required exact-head CI pass.

## Scope

- In scope: captured-offer result metadata, propagation into the existing warning, focused tests, and the current protocol owner.
- Out of scope: payloads, identifiers, scope names, content sizes, extra logs, new I/O, persisted state, validation changes, retries, timeout changes, and unchanged-projection optimization.

## Constraints

- Web remains the authority for consent, generation fencing, and durable share publication. The immutable checkpoint projection owner remains unchanged.
- Telemetry adds only a finite optional field to an existing warning. No extra awaited work, request, event, state, or provider input.
- Use ReviewGPT for substantive implementation. Keep one completion owner and preserve other worktrees. The separate unchanged-projection PR changes caching and publication bookkeeping; it does not answer this diagnostic question.

## Risks and mitigations

1. Mistaking HTTP success or invocation completion for a share outcome. Preserve the unresolved production outcome; label this as telemetry only.
2. Diagnostic metadata could expose private records or change control flow. Use fixed reasons only and synthetic private-looking inputs; test that publication and stop semantics remain unchanged.
3. Mixed runner versions omit the optional field. Existing log readers tolerate absence; require the full runner image and verify natural traffic after activation.

## Tasks

1. Reproduce successful early scopes followed by an oversized scope, a thrown delivery, and an explicit failed scope.
2. Have ReviewGPT implement the smallest typed diagnostic and tests at the existing offer/warning owners.
3. Inspect the patch, prove negative/positive diagnostics and behavior invariants, and update the owner documentation.
4. Complete scoped commit, draft PR, parent review, final ReviewGPT, and exact-head CI.
5. Under telemetry-only authority, merge and deploy through canonical gates; verify revision and natural fields without replaying work.

## Decisions

- Existing stage, transport, and Web deferral logs do not distinguish the captured-offer branches. A generic new logger would duplicate those observations; one optional finite reason on the current warning answers the missing question.
- No product behavior or state changes are justified by the evidence.

## Verification

- Run focused projection and composed warning tests, affected package typecheck, complexity diff, docs drift, and exact-head required CI.
- Base must fail the new diagnostic assertions while preserving its established behavior; candidate must pass those assertions with the same delivery calls and final outcomes.
- ReviewGPT implementation authoring completed; parent inspected the five-file patch. The result adds only three fixed optional reasons and forwards them to the existing warning.
- Negative proof: eight new reason assertions fail on unchanged production source; eighteen other selected cases pass. Failures are exactly the absent result/warning fields.
- Candidate proof: all 168 tests across the projection and composed foreground-entrypoint owners pass; package typecheck, docs drift, and diff checks pass.
- Complexity guard passes with unchanged debt and maximum complexity in both touched owners. Existing large lifecycle and projection-reader functions are unchanged; extracting them would broaden this diagnostic-only correction.
- Privacy: exact warning-object assertions exclude synthetic private error details. Successful, deferred, continued, preempted, and earlier discovery failure paths omit the field as intended.
- No member-visible behavior changes; changelog and provider-input measurement are not applicable. Existing delivery calls, serialization gate, continuation, stop checks, checkpoint effects, and wake outcomes are preserved.
- Final ReviewGPT round 1 PASS on `62afd4839171014bbc4e05eacc4631a5df702569`: complete seven-file patch, no findings, full/sensitive context, requested and sent GPT-6 Pro, observed wait lower bound 185.830 seconds. Parent accepts the review and has no unresolved findings.
- The temporary attachment was removed after normal capture. Its round lineage was reconstructed through the canonical packager with unchanged PR body/base/head: full scope, full snapshot, sensitive context, seven files, 273 changed lines, matching first/current/anchor heads and empty remediation deltas. This was local evidence recovery, not another review request.
- This final closure changes only the plan and index; production source, tests, and config remain byte-identical to the reviewed candidate. Required CI must pass on the final pushed head before merge.
- Release follow-through remains with the existing production observation owner. Canonical full-image deployment and exact-source convergence must precede a new four-hour observation deadline. Natural reason fields remain unexercised before that release; historical failure cause is unresolved.
Completed: 2026-10-18
