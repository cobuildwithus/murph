# Clinical Records UI redesign

Status: completed
Created: 2026-07-18
Updated: 2026-07-18

## Goal

- Make the Epic Clinical Records beta feel calm, trustworthy, and unmistakably
  Murph while preserving the current one-time import, consent, authorization,
  status, and disconnect behavior.

## Success criteria

- `/records` presents the connection outcome, one-time import boundary, live
  progress, imported counts, and disconnect action in a clear visual hierarchy.
- `/records/connect` communicates the consent, organization selection, and Epic
  authorization sequence before the member leaves Murph.
- Search results remain keyboard-accessible, responsive, and truthful across
  pending, empty, error, and provider-start states.
- Focused UI tests, the truthful Web verification lane, desktop/mobile browser
  proof, required frontend and coverage audits, second-model UI review, parent
  final review, CI, and the selected PR review gate finish with no unresolved
  accepted finding.

## Scope

- `apps/web/app/(dashboard)/records/**`
- `apps/web/test/clinical-records-pages-client.test.tsx`
- This active plan and its coordination-ledger row

## Constraints

- Preserve the one-shot Epic import model, current server-truth refresh path,
  health-data consent, SMART authorization, privacy boundaries, and disconnect
  semantics.
- Do not add dependencies, endpoints, persisted state, provider behavior, or a
  second UI state owner.
- Use Murph's existing Tailwind, shadcn/base UI, typography, color, elevation,
  and interaction vocabulary.
- Keep private health data, browser claims, provider tokens, member identifiers,
  and local personal identifiers out of screenshots and durable artifacts.

## Tasks

1. Audit the merged Records and Connect compositions against Murph's design
   system and focused regression suite.
2. Implement the smallest coherent layout, hierarchy, copy, and state-treatment
   redesign across both pages.
3. Extend focused regression coverage for the redesigned hierarchy and
   interaction affordances.
4. Capture real desktop and mobile browser proof for reachable states and run
   the required verification and completion audits.
5. Close the plan, create the scoped commit, push the task branch, open the PR,
   and complete its required review and CI gates.

## Verification

- Focused Clinical Records component tests during implementation.
- `pnpm test:diff` or the truthful Web verification fallback selected by
  `agent-docs/operations/verification-and-runtime.md`.
- Desktop and mobile browser proof for `/records` and `/records/connect` states
  that are safely reachable in the isolated checkout.
- Required `frontend-review`, `coverage-write`, second-model UI double-check,
  parent final review, and PR review gate selected by the completion workflow.

## Completion evidence

- The focused records client suite passed all 20 tests after the final copy,
  accessibility, and error-boundary changes.
- The truthful Web diff lane passed its build, smoke, typecheck, lint, and 5,849
  active tests. Lint reported only 12 unrelated existing warnings.
- `frontend-review` finished with no findings after fixes for plain-language
  error handling, landmark semantics, and duplicate screen-reader text.
- `coverage-write` added direct proof for plain-language errors, the search
  length boundary, progress states, and retry behavior, then passed the focused
  and full diff lanes.
- The isolated hosted Web app reached a healthy local state, but the in-app
  browser connector had no available browser. Desktop and mobile rendered proof
  remains an explicit verification gap.
- Both allowed Claude UI-review routes were attempted and failed because the
  local OAuth session could not be refreshed. The second-model UI double-check
  therefore remains an explicit authentication gap rather than a claimed pass.
- ReviewGPT is selected as the PR-lane cross-cutting gate because the redesigned
  surface communicates health-data and credential-boundary claims.
Completed: 2026-07-18
