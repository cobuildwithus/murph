# Simplify Linq planner ignored outcomes

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

- Remove repeated ignored-plan construction and redundant line-state branches while preserving every Linq onboarding outcome, diagnostic, and effect order.

## Success criteria

- Focused composed planner tests, Web typecheck, complexity guard, parent candidate review, exact-head ReviewGPT and required CI pass.

## Scope

- In scope: local ignored-plan composition and group recipient-line terminal outcomes in webhook-provider-linq.ts; focused synthetic proof.
- Out of scope: identity lookup, member creation, authentication, onboarding policy, prompts, delivery scheduling, schemas, and PR #2820 identity changes.

## Constraints

- Preserve response reasons separately from diagnostic reasons and preserve guard and effect order.
- Keep the existing line-state owner, logger, response builders, and transaction boundaries. No dependencies or new persisted state.

## Risks and mitigations

1. Diagnostic/response conflation: retain explicit group response reasons and exercise composed logs and plans.
2. Unavailable-line fallthrough: prove the closed line-state union from its production producer and cover all four unavailable kinds plus existing admitted-line journeys.

## Tasks

1. Consolidate repeated ignored response/log construction and unavailable line mapping.
2. Run composed proof and typecheck; inspect full diff and metric.
3. Commit, open draft, obtain parent review, run exact-head ReviewGPT concurrently with CI, leave PR open.

## Decisions

- Product UX effort: internal behavior-preserving refactor. Replay direct first-contact suppression, active/suspended/withdrawn member guards, existing group guards, unavailable group lines, and admitted group setup/recovery via existing composed tests. No UI or model-visible input changes; deterministic equivalence is the relevant boundary.
- The production line-state owner returns three kinds with phoneNumberLookupKey and four kinds without it. The old fifth missing-key fallback after handling all four unavailable kinds is unreachable through this owner.
- PR #2820 diff inspected; its identity and lock changes are outside this patch.

## Verification

- Focused Web Vitest planner, dispatch, mailbox-prewarm, routing recovery, and line-state suites; Web typecheck; pnpm complexity:diff.
- Expected: identical plans/logs/effect suppression and order; fewer branches and repeated constructions.

## Candidate evidence

- Eight focused Web Vitest suites passed: 479 tests covering webhook planning, thread routes, dispatch, mailbox-root prewarm, group-line recovery, line-state reads, instant start, and first-contact admission.
- Web typecheck passed through the standard generation and prepared TypeScript lane.
- All four unavailable recipient-line cases compose the production line-state reader and preserve distinct diagnostic reasons, the shared response reason, empty desired effects, and suppression of group, mailbox, and line mutation.
- Complexity guard passed: file debt 287 to 283; group planner complexity 93 to 89; maximum remains 94. Existing policy-heavy hotspots remain with their current owners; a larger extraction would exceed this behavior-preserving scope.
- No prompt, tool, provider-input, schema, protocol, transaction, or awaited-operation change. Model-generated replies and frontend presentation are outside this patch.
- Changelog: not applicable; internal refactor preserves member-visible behavior.
- Final exact-head review and required CI remain PR delivery gates.
Completed: 2026-09-04
