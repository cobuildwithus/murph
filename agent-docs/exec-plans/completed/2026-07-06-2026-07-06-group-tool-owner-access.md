# Group tool owner access gates

Status: completed
Created: 2026-07-06
Updated: 2026-07-06

## Goal

- Fix hosted group-tool access so owner-authority/admin actions require the
  group owner's active access, while participant-aware group reply/read paths
  remain available when an active participant keeps the container alive.

## Success criteria

- `create_join_link` denies inactive-owner/active-participant containers and
  still allows active-owner containers.
- `share_contact_card` and any other owner-authored group-tool writes are
  audited and classified owner-only.
- `read_chat_participants` remains participant-aware.
- Focused hosted group-tool tests, `pnpm --dir apps/web typecheck`, and
  `git diff --check` pass.
- The final handoff reports the per-action access classification.

## Scope

- In scope: `apps/web/src/lib/hosted-groups/group-tool.ts` and focused
  hosted group-tool tests.
- Out of scope: changing reply/runtime participant-aware access, group-store
  persistence shape, provider APIs, schema, or user-facing copy.

## Constraints

- Technical constraints: keep suspension fail-closed; use the existing hosted
  member access resolver; do not add a parallel access authority.
- Product/process constraints: preserve the user-critical reply path and keep
  the implementation narrow.

## Risks and mitigations

1. Risk: tightening the wrong gate could block legitimate group replies.
   Mitigation: classify actions explicitly and keep read/reply paths on the
   participant-aware container gate.
2. Risk: contact-card sharing could retain a participant-aware authority path.
   Mitigation: audit `group-tool.ts` for owner-authored writes and add focused
   tests for owner-only actions.

## Tasks

1. Inspect group-tool actions, access helpers, and existing tests.
2. Add the smallest owner-only gate for owner-authority actions.
3. Add focused inactive-owner/active-participant regressions.
4. Run required verification and local final review.
5. Close the plan through the scoped commit path.

## Decisions

- Owner-authority group-tool actions should check the container owner's active
  hosted access directly, not the participant-aware runtime access predicate.

## Verification

- Commands to run:
  - `pnpm --dir apps/web test -- hosted-group-tool`
  - `pnpm --dir apps/web typecheck`
  - `git diff --check`
- Expected outcomes: all commands pass.
Completed: 2026-07-06
