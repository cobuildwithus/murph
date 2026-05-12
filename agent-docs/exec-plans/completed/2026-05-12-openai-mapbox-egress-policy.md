# Tighten OpenAI and Mapbox hosted egress policy

Status: completed
Created: 2026-05-12
Updated: 2026-05-12

## Goal

- Replace loose hosted runner OpenAI and Mapbox credential-injection matching
  with a small explicit method/path policy.

## Success criteria

- OpenAI Worker-owned credential injection is limited to:
  - `POST /v1/responses`
  - `GET /v1/models`
- OpenAI `POST /v1/chat/completions` stays blocked unless future evidence
  proves the hosted Codex path still needs it.
- Mapbox Worker-owned credential injection is limited to `GET` requests on the
  existing approved Mapbox path families.
- Disallowed OpenAI and Mapbox method/path combinations do not reach upstream
  fetch with injected credentials.

## Scope

- In scope: `apps/cloudflare/src/runner-egress-intercept.ts` and focused
  `apps/cloudflare/test/runner-egress-intercept.test.ts` coverage.
- Out of scope: provider read-fence work, outbound intercept architecture
  cutovers, hosted-local E2E behavior, and broad runner refactors.

## Constraints

- Preserve unrelated active hosted-runner edits and dirty local plan/ledger
  rows.
- Do not expose provider secrets, local identifiers, request bodies, or raw
  credentials in tests, docs, logs, or handoff.
- Keep the policy table intentionally small and explicit.

## Tasks

1. Register this plan and matching coordination-ledger row.
2. Patch the OpenAI and Mapbox intercept policy table.
3. Add focused regressions for allowed and rejected method/path combinations.
4. Run focused Cloudflare intercept tests and required verification.
5. Close the plan through the repo completion path if scoped commit safety
   permits.

## Decisions

- Current hosted Codex config uses the OpenAI Responses wire API.
- `GET /v1/models` is kept because hosted-local provider stubs already model
  that request shape.
- `POST /v1/chat/completions` is not allowlisted because current hosted Codex
  configuration does not require it.

## Verification

- PASS: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-egress-intercept.test.ts`
  - 23 tests passed.
- PASS: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/test/runner-egress-intercept.test.ts`
  - Cloudflare app verify passed, including app-local typecheck and Node/Workers
    lanes.
- PASS: `git diff --check -- apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/test/runner-egress-intercept.test.ts agent-docs/exec-plans/completed/2026-05-12-openai-mapbox-egress-policy.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- BLOCKED after handoff: later `pnpm typecheck` failed in overlapping hosted
  provider-effect contract edits outside this policy patch.
Completed: 2026-05-12
