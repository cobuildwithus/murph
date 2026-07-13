# Context-First Murph Onboarding

## Goal

Align Murph's durable strategy and first-run experience around a broad private
personal health assistant whose usefulness compounds with longitudinal context.
Use one relevant health goal, question, task, or baseline review as the first
useful thread without making goals, groups, or experiments the product boundary.

## Success Criteria

- Durable product and marketing docs describe context as Murph's compounding
  advantage and experiments, groups, habits, research, actions, and monitoring
  as composable primitives.
- Direct signup starts a private relationship, explains memory plainly, and
  reaches a useful starting thread without a fixed health-history questionnaire.
- Users with a goal can explore the outcome, reason, and actual obstacle; users
  without a goal can opt into a one-time baseline review without being told that
  something is wrong.
- Onboarding completion no longer requires a wearable, supplement/medical/lab
  inventory, or first experiment. Existing canonical goal, memory, regimen,
  automation, group, and experiment owners remain unchanged.
- Daily onboarding follow-up advances the user's chosen thread or highest-value
  missing context instead of walking a generic checklist.
- Welcome, prompt, runtime guidance, website positioning, and regression tests
  all express the same product hierarchy.
- The live investor deck makes the same hierarchy legible through a concrete,
  YC-grounded problem, wedge, product, proof, growth, moat, and ask narrative
  without inventing traction or making one primitive the company.
- Required verification, specialist audits, a draft PR, PR CI, and the ReviewGPT
  loop reach their documented completion conditions.

## Constraints

- Delete experiment-first requirements instead of adding a parallel onboarding
  state machine or new persisted profile schema.
- Keep the current open/completed onboarding state and existing canonical data
  surfaces unless direct proof shows they cannot represent the new behavior.
- Context collection must be progressive, useful in the current conversation,
  private by default, visible to the user, easy to decline, and never a disguised
  multi-day questionnaire.
- Preserve immediate user requests, health-data ingestion, safety handling,
  reply-oriented iMessage behavior, and opt-in social sharing.
- Keep website changes copy-only unless the existing component structure cannot
  express the agreed strategy.
- Preserve unrelated working-tree and coordination-ledger changes.

## Plan

1. Map every experiment-first onboarding and positioning assertion plus the
   tests that enforce it.
2. Update durable strategy, marketing, and product-spec guidance first.
3. Rewrite the onboarding skill and the smallest supporting prompt/runtime/copy
   surfaces around broad assistance, one useful starting thread, and progressive
   context.
4. Update focused regression tests and copy assertions.
5. Run truthful diff-aware verification and the required prompt/frontend/
   coverage audits, resolve accepted findings, and perform the parent final
   review.
6. Close this plan with a scoped commit, push, open a draft PR, and run the
   ReviewGPT PR loop to zero accepted findings with final PR CI green.

## State

In progress.

## Working Set

- `PRODUCT.md`
- `DESIGN.md`
- `agent-docs/PRODUCT_SENSE.md`
- `agent-docs/PRODUCT_CONSTITUTION.md`
- `agent-docs/product-marketing-context.md`
- `agent-docs/product-specs/`
- `packages/assistant-engine/skills/murph-onboarding/SKILL.md`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/src/assistant/onboarding-followup-automation.ts`
- `packages/contracts/src/assistant.ts`
- `apps/web/src/lib/hosted-messages/user-facing-messages.ts`
- Experiment-first homepage copy and focused tests under `apps/web`
- The live `/pitch` route and its focused tests under `apps/web`
- Focused assistant-engine, contracts, and web tests

## Coordination Note

The coordination ledger still lists the thread-context developer-instruction
lane as active, but its matching plan is archived as completed and its layer
placement is already present on this branch's base. This task does not change
prompt assembly or layer placement. It changes product-routing prose only in
the existing understand-before-recommending, Health Commons, skill-route, and
onboarding builders plus their direct tests.

The required frontend routing sweep found four local Claude Code profiles.
Three were signed out and one had an expired OAuth session that could not be
refreshed, so no authenticated Fable lane was available. The parent is using
the documented direct-implementation fallback for the copy-only `apps/web`
scope and retains frontend review and verification.
Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
