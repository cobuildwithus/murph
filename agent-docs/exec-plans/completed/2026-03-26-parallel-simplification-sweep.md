# Parallel Simplification Sweep

## Goal

Apply seven behavior-preserving simplification slices in parallel across `packages/core`, `packages/cli`, `packages/device-syncd`, and `apps/web`, keeping each lane narrow and preserving existing exported behavior.

## Scope

- Remove dead private code from `packages/core/src/canonical-mutations.ts` if it remains obviously unused.
- Extract the shared `{ attributes, body }` bank document-adapter layer without collapsing domain validation rules.
- Consolidate duplicated hosted-web JSON parsing/error mapping into a small shared helper while preserving domain-specific status/messages/headers.
- Extract tiny hosted-onboarding route helpers for invite-code parsing and session-cookie verify responses.
- Share CLI abort/timeout/retry-delay helpers between the AgentMail and Linq runtimes without changing semantics.
- Extract shared OAuth grant plumbing between the Oura and WHOOP providers without merging provider-specific business rules.
- Replace trivial `withCanonicalWriteLock` wrappers in `packages/core/src/public-mutations.ts` with a tiny local helper while preserving exported API names/signatures.

## Constraints

- Behavior-preserving simplification only; if a candidate removal or rename stops being obviously safe, report instead of forcing it.
- Use the current shared worktree with narrow lane ownership; preserve unrelated in-flight edits already present in the repo.
- Honor the coordination ledger for every worker lane before code changes.
- Keep route/service/domain-specific behavior explicit where the task says not to genericize it.

## Planned Files

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/worker-prompts/**`
- `packages/core/src/{canonical-mutations.ts,public-mutations.ts,bank/shared.ts,bank/allergies.ts,bank/conditions.ts,bank/foods.ts,bank/goals.ts,bank/recipes.ts}`
- `packages/core/test/{canonical-mutations-boundary.test.ts,core.test.ts,health-bank.test.ts}`
- `apps/web/src/lib/{http.ts,device-sync/http.ts,linq/http.ts,hosted-onboarding/http.ts}`
- `apps/web/app/api/hosted-onboarding/passkeys/register/options/route.ts`
- `apps/web/app/api/hosted-onboarding/passkeys/authenticate/options/route.ts`
- `apps/web/app/api/hosted-onboarding/passkeys/register/verify/route.ts`
- `apps/web/app/api/hosted-onboarding/passkeys/authenticate/verify/route.ts`
- `apps/web/app/api/hosted-onboarding/billing/checkout/route.ts`
- `apps/web/test/{device-sync-http.test.ts,linq-webhook-route.test.ts,hosted-onboarding-routes.test.ts}`
- `packages/cli/src/{agentmail-runtime.ts,linq-runtime.ts,http-retry.ts}`
- `packages/cli/test/assistant-channel.test.ts`
- `packages/device-syncd/src/providers/{shared-oauth.ts,oura.ts,whoop.ts}`
- `packages/device-syncd/test/{oura-provider.test.ts,whoop-provider.test.ts,service.test.ts}`

## Execution Model

1. Register the batch and worker lanes in the coordination ledger.
2. Launch seven Codex workers in the current worktree with disjoint prompts.
3. Review each worker result, integrate or adjust overlapping edits carefully, and run the required audit passes on the combined diff.
4. Run required repo verification and commit only the touched files for this turn.

## Verification Plan

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- completion workflow passes: `simplify` -> `test-coverage-audit` -> `task-finish-review`
Status: completed
Updated: 2026-03-26
Completed: 2026-03-26
