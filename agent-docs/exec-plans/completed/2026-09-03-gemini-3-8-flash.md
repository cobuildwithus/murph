# Upgrade hosted video analysis to Gemini 3.8 Flash

Status: completed
Created: 2026-09-03
Updated: 2026-09-03

## Goal

- Move Murph's on-demand hosted video analysis from Gemini 3.7 Flash to the
  stable `gemini-3.8-flash` model without interrupting requests or usage
  accounting during the Web/Worker/warm-runner rollout window.

## Success criteria

- New assistant video-analysis requests target `gemini-3.8-flash` with the
  existing 1/5 FPS, medium-thinking request profiles.
- The Worker accepts and records both the new 3.8 path and the prior 3.7 path
  during rollout, while binding the deprecated capped request profile only to
  the prior model.
- Web prices exact 3.8 usage and rollout-era 3.7 usage under model-specific
  pricing versions using Google's published rates.
- Focused provider-boundary, assistant-engine, hosted-execution, Web, and
  Cloudflare tests plus relevant typechecks pass.
- Live owner docs describe the consumer-first rollout and rollback floor.

## Scope

- In scope: hosted video-analysis model pin, Worker egress-path compatibility,
  model-aware usage accounting, regression tests, and current architecture,
  security, and deployment documentation.
- Out of scope: changing sampling modes, prompts, video limits, retry behavior,
  credentials, or other Gemini-backed features.

## Constraints

- Technical constraints: preserve the fixed legacy `generateContent` request,
  request-scoped fetch boundary, one-call ceiling, exact-body validation, and
  current usage-record schema.
- Product/process constraints: deploy the compatible Web consumer before the
  Worker/new runner writer; keep production secrets unavailable locally; use
  only privacy-safe synthetic verification evidence.

## Risks and mitigations

1. Risk: New Web or Worker code rejects a request or usage row from a warm 3.7
   runner.
   Mitigation: Retain one explicit 3.7 rollout reader in both boundaries and
   prove both model paths.
2. Risk: The old capped/low-thinking profile is accidentally admitted for 3.8.
   Mitigation: Bind that temporary body-shape compatibility to the 3.7 model
   path and reject the cross-product.
3. Risk: Usage is priced or labeled as the wrong model.
   Mitigation: Derive the trusted model from the exact admitted path and carry
   it through the usage record and model-specific pricing snapshot.

## Tasks

1. Update the shared current model and add the narrow previous-model rollout
   contract.
2. Make Worker path/body validation and usage recording model-aware.
3. Make Web allowance pricing accept and label both exact rollout models.
4. Update focused tests and live owner docs.
5. Run focused verification, inspect the final diff, complete review/CI, and
   close the plan with the scoped task commit.

## Decisions

- Keep raw REST rather than adding the SDK: Murph's documented request-scoped
  fetch injection and explicit video-FPS boundary still require the existing
  owner.
- Keep request semantics unchanged because the current body already satisfies
  Google's 3.8 migration requirements: medium `thinkingLevel`, no deprecated
  sampling parameters, no prefilled model turn, and a non-empty final user
  turn.
- Treat 3.7 only as a temporary deployed-reader compatibility model, not a
  configurable fallback or second writer.

## Verification

- Passed focused Vitest coverage for Gemini request construction, hosted usage
  records, Worker egress/interception, runner platform boundaries, Web
  allowance pricing, provider-request ownership, and the public changelog:
  689 assertions across the selected files.
- Passed typechecks for `packages/assistant-engine`,
  `packages/hosted-execution`, `apps/cloudflare`, and `apps/web`; the assembled
  hosted-local build also completed before its deploy smoke prerequisite.
- Passed `pnpm complexity:diff`, `git diff --check`, and identifier/privacy
  scans of the authored diff.
- The local hosted roundtrip could not execute because the Docker daemon was
  unavailable. The harness completed its build and setup work, then skipped the
  scenario after the runner-container deploy smoke exhausted its retries.
- No ambient non-production `GEMINI_API_KEY` was available, so no live vendor
  call was attempted. Exact-head CI, ReviewGPT, and the documented consented
  post-deploy smoke remain the external verification boundaries.
- ReviewGPT round 1 audited the full exact-head snapshot for about 16 minutes,
  returned `ROUND_OUTCOME: PASS` with no qualifying findings, and bound the
  captured response to the requested Sol lane and compatible
  `gpt-5-6-pro` backend slug. Its rendered-evidence note is non-actionable under
  the repository's content-only changelog proof exception; the production
  archive server-render test passed.
Completed: 2026-09-03
