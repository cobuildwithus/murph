# Debug hosted Linq stalled reply and close smoke coverage gap

Status: completed
Created: 2026-04-15
Updated: 2026-04-15

## Goal

- Explain why a hosted Linq conversation showed a typing indicator without a follow-up reply, land the smallest safe fix if the runtime is wrong, and add a regression plus smoke coverage notes so the same class of failure is caught earlier.

## Success criteria

- The message-ingress and hosted-dispatch path for the stalled Linq reply is traced to a concrete code path or confirmed observability gap with direct evidence from logs and source.
- If production behavior is wrong, the bug is fixed with a focused regression test that reproduces the failure mode.
- The local Cloudflare smoke gap is explained precisely, and the smoke/test surface is extended or documented so this scenario is no longer silently missed.
- Scoped verification passes for every touched owner.

## Scope

- In scope:
- `apps/web/src/app/api/hosted-onboarding/linq/webhook/**`
- `apps/web/src/lib/hosted-execution/**`
- `apps/web/test/hosted-onboarding-linq-route.test.ts`
- `apps/cloudflare/src/**`
- `apps/cloudflare/test/**`
- `packages/assistant-runtime/src/hosted-runtime/**`
- `agent-docs/exec-plans/active/**`
- Out of scope:
- Broad hosted-onboarding UX/copy changes already in flight.
- Unrelated device-sync or onboarding refactors unless they are directly required for the Linq reply fix.

## Constraints

- Technical constraints:
- Preserve unrelated dirty worktree edits, especially the active hosted-onboarding cleanup and copy rows.
- Treat hosted messaging, typing indicators, and execution callbacks as high-sensitivity runtime surfaces; prefer fail-closed fixes and explicit tests.
- Product/process constraints:
- Keep the fix narrow and behavior-preserving outside the stalled-reply path.

## Risks and mitigations

1. Risk: The visible stall may come from missing observability rather than broken reply generation, which can lead to fixing the wrong layer.
   Mitigation: Correlate exported logs with exact source log strings before changing behavior.
2. Risk: Hosted-onboarding files already have active parallel work.
   Mitigation: Stay on the webhook/runtime/test slice only and avoid unrelated shared seams.
3. Risk: Local smoke may still be too coarse to prove chat-message behavior.
   Mitigation: Add a deterministic regression at the lowest truthful layer and only widen the smoke surface if it can assert the same behavior without live network dependencies.

## Tasks

1. Trace the exported Vercel and Cloudflare logs through the hosted Linq webhook, dispatch storage, runtime execution, typing indicator, and assistant delivery code.
2. Identify whether the reply was never generated, generated but not delivered, or delivered without sufficient log evidence.
3. Inspect the existing local Cloudflare smoke harness to explain why it did not cover this scenario.
4. Land the smallest safe code/test change needed to reproduce and prevent the bug.
5. Run scoped verification and capture any remaining production-log gaps needed from the user.

## Decisions

- Use the plan-bearing path because this crosses `apps/web`, `apps/cloudflare`, and hosted runtime behavior.
- Treat the local Cloudflare smoke gap as a test-surface problem, not a signal that the production logs were wrong. Add deterministic regressions at the hosted runtime and node-runner boundaries instead of widening the parser/container smoke in this change.
- Preserve hosted Linq auto-reply bootstrap across repeated `member.activated` replays once Linq has already been enabled for the member.

## Verification

- Commands to run:
- `pnpm test:diff apps/web/src/app/api/hosted-onboarding/linq/webhook/route.ts apps/web/test/hosted-onboarding-linq-route.test.ts packages/assistant-runtime/src/hosted-runtime/typing.ts apps/cloudflare/src apps/cloudflare/test`
- Any narrower focused Vitest commands needed while iterating
- Expected outcomes:
- Reproduction coverage for the stalled-reply path and green scoped verification for touched files.

## Outcome

- Root cause: hosted dispatch, typing, and commit all completed, but hosted runtime never managed `linq` as a bootstrapped auto-reply channel for Linq-first-contact member activation. That allowed later Linq ingress to start typing without assistant auto-reply being enabled.
- Local smoke gap: `apps/cloudflare/src/hosted-runner-smoke.ts` and `hosted-runner-smoke-child.ts` only prove restored container/runtime/parser behavior (`murph`, `vault-cli`, `vault show`, PDF parse, audio transcription). They do not execute hosted assistant automation bootstrap or Linq reply delivery semantics.
- Regression coverage added at the truthful boundaries:
- `packages/assistant-runtime/test/hosted-runtime-context.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-context-coverage.test.ts`
- `apps/cloudflare/test/node-runner.test.ts`
- Focused verification passed:
- `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-context.test.ts test/hosted-runtime-context-coverage.test.ts --config vitest.config.ts --coverage.enabled=false`
- `pnpm --dir apps/cloudflare exec vitest run test/node-runner.test.ts --config vitest.node.workspace.ts --coverage.enabled=false --maxWorkers 1`
- Truthful diff verification reached the touched owners successfully, then failed in an unrelated existing Cloudflare suite:
- `apps/cloudflare/test/hosted-local-duplicate-commit-e2e.test.ts` timed out in `beforeAll`.
Completed: 2026-04-15
