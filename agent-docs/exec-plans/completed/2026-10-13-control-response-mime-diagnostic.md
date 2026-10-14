# Classify invalid control response content types

Status: completed
Created: 2026-10-13
Updated: 2026-10-13

## Goal

Distinguish JSON-labeled malformed control responses from unexpected HTML, text, missing, or other content types without exposing response content or changing control behavior.

## Success criteria

- Existing invalid-JSON warnings include one closed content-type category.
- Snapshot diagnostics retain their existing fields and categories.
- Synthetic composed-port tests prove classification, privacy, unchanged rejection, one request, and successful decoding.
- Focused checks, candidate review, final ReviewGPT, and required exact-head CI pass.

## Scope

- In scope: reuse the transport content-type classifier on the existing invalid-JSON warning; focused tests and owner documentation.
- Out of scope: response body logging, new events, control contracts, state, retry or timeout changes, and functional recovery.

## Constraints

- Keep the field bounded to missing/json/html/text/other; never log raw headers or payloads.
- ReviewGPT authors the implementation. Only a telemetry-only candidate may merge and deploy under this task's authorization.
- Use the protected deployment workflow; verify the deployed revision and preserve an exact observation query if natural traffic has not exercised the warning.

## Risks and mitigations

1. Raw MIME parameters can contain private values. Reduce to existing fixed categories and test synthetic sentinels.
2. Duplicated diagnostics can change volume or body consumption. Add the category to the existing failure only and preserve the single read and thrown error.

## Tasks

1. Obtain and critically inspect ReviewGPT's patch.
2. Prove the new diagnostic test fails on the baseline, then passes with the patch; run adjacent tests and focused checks.
3. Complete parent review, scoped commit, draft PR, final ReviewGPT and required CI.
4. If all gates pass, merge and deploy the telemetry through the canonical workflow; verify revision and natural evidence read-only.

## Decisions

- Reuse the existing snapshot content-type classifier rather than add another observation pipeline.
- No public changelog: only internal failure diagnostics change.
- Do not infer root cause or recovery from MIME classification alone.

## Verification

- Focused composed-port tests, existing snapshot diagnostics tests, Cloudflare typecheck, complexity diff, privacy log guard, and docs drift.
- CI owns broad repository verification on the exact pushed head.

## Progress

- ReviewGPT authored the production change, tests, and owner documentation. The parent removed one redundant test assertion that the test framework does not support for inherited constructors; error instance, name, message, and cause assertions remain.
- Applying only the tests to the original transport produced 17 missing-category failures and 82 passing controls. Applying the transport change produced 99 passing tests across the new generic and existing snapshot diagnostic suites.
- Cloudflare typecheck, logging privacy guard, docs drift, whitespace checks, and complexity diff passed. The request-attempt function's existing complexity of 40 is unchanged; the extracted classifier avoids duplication and no unrelated control-flow refactor is justified.
- Parent review confirmed fixed categories only, preserved snapshot classification, unchanged throw/replay behavior, no additional request or log event, and no success-path metadata.
- Final ReviewGPT round 1 passed with zero findings on `f3ff1295fb4ad39f54d065af3889561d23b3fea2`: guarded full snapshot, exact accepted turn, selected and sent GPT-6 Pro, response hash, and minimum response time verified. Parent final review accepted the result.
- A read-only query reproduction established that runner-container application streams must be included alongside Worker records. The owner documentation now names that existing surface; this explanatory addition changes no executable behavior.

## Completion and handoff

- Implementation and review are complete in PR #4141. Final changes only close this plan and clarify operational documentation; the reviewed runtime and test trees remain unchanged.
- Required exact-head CI remains a merge gate. Any telemetry-only merge and canonical deployment must recheck the current public/private release boundary and protected approvals. Record rollout and natural-event verification in the sweep handoff; the original invalid-response cause and exact publish outcome remain unresolved.
- No migration, new credential, policy, configuration, state owner, retry, timeout, or functional recovery is included. Preserve the fixed-window observation query when natural traffic has not exercised the deployed field.
Completed: 2026-10-13
