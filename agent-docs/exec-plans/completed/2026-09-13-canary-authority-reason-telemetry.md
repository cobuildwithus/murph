# Classify canary authority failures without private data

Status: completed
Created: 2026-09-13

## Outcome and invariant

The existing read-only Linq production canary observer must distinguish known access, suspension, and consent rejections from other failures at its two authority gates. Preserve the exact authority checks, their order and query count, the generic unavailable response, silent successful/not-ready results, and no private error inspection outside those authority gates.

## Evidence and owner

The observer sets initial_authority and final_authority before assertBrowserVaultMemberAuthority. That helper runs active-access and required-consent checks; local HostedOnboardingError codes already identify the policy rejections, while database failures can reach the same catch. The current fixed-stage warning discards that distinction. Synthetic executions of those failures can prove both the gap and its correction without identifying a production canary or reading protected configuration.

## Scope and approach

Extend only the existing failed-outcome warning with a closed, typed reason at authority stages. Prefer the existing local error class and strict known-code mapping; never log arbitrary codes, messages, details, causes, stack, member data, or keys. Unknown and hostile exceptions retain generic behavior. No new diagnostic endpoint, query, auth callback, persistence, scheduler, retry, provider call, or logging volume. ReviewGPT supplies the substantive patch. The existing Reliability owner describes the observation.

## Ownership and compatibility

Use this task's isolated checkout. The earlier stage-only telemetry is merged. The separate route-authority response PR changes the Cloudflare effects port, not this Web observer or its error classification. Existing scheduled-wake work changes device admission, not this observer. Web-only additive logging has no new wire/schema consumer; old and new deployments preserve identical API behavior. No member-facing changelog applies.

## Verification and completion

- Add synthetic failure cases for every known policy reason, ordinary query failures, untrusted lookalike/hostile exceptions, initial/final stages, unchanged read order, and failure of the logger.
- Run fail-before/pass-after proof plus existing outcome/route/authority tests and affected Web typecheck.
- Parent review covers privacy, complexity, cost, and unchanged authority/results; run relevant docs/log/diff checks.
- Commit and push a draft PR, mark stable candidate Ready, run final ReviewGPT with required exact-head CI, and disposition findings under the completion workflow.
- Close the plan with finish-task. If all telemetry-only gates pass, use the normal protected merge and canonical Web deployment, verify the serving revision, and query natural traffic. Never trigger a canary, reset, recovery, or provider send for evidence.

## Progress

- Isolated checkout created from the current main and serving telemetry baseline.
- Investigation remains read-only; detailed bounded aggregates and unresolved findings stay in automation memory outside the repository.

- ReviewGPT supplied the exact three-file implementation patch; parent review accepted it unchanged. The read body and generic throw are byte-identical to the baseline.
- Test-only application produced 25 expected failures and 35 passes; the full patch passes all 71 reader, route and authority cases. Web typecheck passes.
- Complexity guard passes with unchanged maximum 19 and no hotspot above 20; logging guard, docs gardening and whitespace checks pass. Parent privacy/cost/ownership review passes.
- Final ReviewGPT round 1 passed on 62bdcb1bb8a132b60401de7fe1a8876045e6739b with no qualifying findings or accepted findings remaining. Parent final review passes.
- The final closeout changes only this explanatory plan and its index; source, tests and Reliability remain identical to the reviewed candidate. Required final-head CI and any telemetry-only Web deployment remain external completion gates.
Updated: 2026-09-13
Completed: 2026-09-13
