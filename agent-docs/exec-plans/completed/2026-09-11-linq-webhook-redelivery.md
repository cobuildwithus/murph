# Honor retryable Linq route preparation in E2E

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

Keep the real hosted-local Linq delivery scenario faithful to the webhook handler's retryable route-preparation response.

## Success criteria

- Redeliver the identical signed fixture once for HTTP 503 with code `HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED` and `retryable: true`.
- Preserve persistent, unrelated, malformed, and transport failures, and keep the scenario's delivery assertions.
- Pass focused helper tests, Cloudflare typecheck, documentation checks, required PR CI, and independent review.

## Scope

- In scope: the first-contact E2E sender, its existing shared support helper, focused proof, and coverage documentation.
- Out of scope: production routing, provider retry policy, new model spending, and Privy setup.

## Constraints

- One redelivery only, with the same body, timestamp, signature, and event ID.
- Preserve all existing success and duplicate-delivery assertions.
- Keep private execution evidence out of durable artifacts.

## Risks and mitigations

1. Retrying could hide a persistent routing failure. Return the second response unchanged and assert the exact two-request ceiling.
2. Parsing the error could consume evidence. Inspect a clone and preserve the original response body.
3. Broad retries could mask unrelated failures. Require the exact status, code, and boolean retryability together.

## Tasks

1. Trace the typed stale-preparation response from the hosted handler to the E2E assertion. Complete.
2. Extract the signed sender and add bounded redelivery with focused regression coverage. Complete; 23 helper tests and Cloudflare typecheck pass.
3. Update the testing owner and Frog record, validate, and commit the candidate. Complete.
4. Track required CI, independent review, merge, and release evidence in the PR; these external completion gates remain pending.

## Decisions

- The handler deliberately returns a typed retryable 503 after exhausting its transaction preparation attempts. The fixture must honor that contract rather than require its first delivery to succeed.
- No sleep, expanded scenario timeout, generic HTTP retry, or production retry change is needed.
- Changelog: not applicable; this change affects test fixtures only.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/helpers/hosted-local-linq-support.test.ts`: 23 passed. Initial invocation could not find Vitest before the fresh checkout dependency installation; retry after `pnpm install --frozen-lockfile` passed.
- `pnpm --dir apps/cloudflare typecheck`: passed.
- `pnpm complexity:diff --base "$(git merge-base HEAD origin/main)"`: passed, with test-only changes excluded from the source metric. Parent review found no new state owner or retry framework.
- Exact-candidate docs drift runs after this final local implementation commit; result is recorded in the PR.
- Required PR CI and ReviewGPT: pending stable pushed candidate.
Completed: 2026-09-11
