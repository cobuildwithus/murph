# Minimal Conversational Billing Handoff

## Goal

Replace PR #553 with the smallest useful conversational billing surface:
Murph can read the current private member's existing plan projection and route
explicit billing or unsupported Family-management requests to the canonical
Settings subscription surface.

## Success Criteria

- `murph.plan_usage` continues to return the existing web-owned plan and usage
  projection.
- Eligible private members can receive the canonical `/settings#subscription`
  handoff even when no usage-triggered upgrade action is recommended.
- Group-thread and inactive-account results do not trigger a private account
  management handoff.
- The assistant describes the URL as a browser handoff and never claims that
  reading the tool changed billing.
- The change adds no direct Stripe mutation, Family roster or seat mutation,
  approval lifecycle, persisted state, route, or runtime port.

## Constraints

- Keep `apps/web` as the sole billing and Family owner.
- Preserve the existing threshold-based `recommendedAction` behavior; the
  neutral management handoff appears only when the member explicitly asks.
- Keep the existing signed plan-usage request and response contract unchanged.
- Preserve current Family status, checkout, and invite behavior unchanged.

## Working Set

- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- focused assistant guidance tests
- `agent-docs/product-specs/hosted-plan-usage.md`
- `agent-docs/index.md`

## Verification Plan

- Focused assistant guidance tests and diff-aware verification.
- Required prompt-review audit, parent final review, and exact-head CI.

## State

- Prompt-primary implementation complete.
- Final focused prompt/Family tests, assistant-engine typecheck, docs drift,
  whitespace, and privacy readback are green.
- Assistant-engine coverage passed 154 files and 2,208 tests before the
  review-driven wording fixes. A final identical coverage rerun hit a Vitest
  worker heap limit under concurrent workspace test load; the post-fix focused
  70-test prompt/model suite passed.
- The first prompt review returned two accepted routing/recommendation-boundary
  findings; both were fixed. The fresh pass returned one low-severity checkout
  explanation wording conflict, which was fixed without changing the route.
- Parent final diff review found no remaining correctness, scope, privacy, or
  deployment gap. Ready for the plan-aware scoped commit and PR lane.

Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
