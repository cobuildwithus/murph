# Move protocol session shapes into Health Commons content

Status: completed
Created: 2026-05-02
Updated: 2026-05-02

## Goal

- Move experiment protocol session-shape timelines out of the hosted-web React component and into Health Commons protocol markdown, starting with the four shapes currently hardcoded in `ProtocolTab`.
- Keep the hosted experiment detail UI rendering the same timeline rail from generated protocol data.
- Use subagents to add best-effort session-shape metadata for the remaining protocol markdown files with clear file ownership.

## Success criteria

- The four existing hardcoded session shapes render from `protocol.sessionShape` data, not a component-local route-id map.
- Health Commons schema/runtime/generated web protocol artifacts accept and project the optional session-shape field.
- Focused tests prove the shape is present on generated/projection data and rendered in the protocol tab.
- Remaining protocol markdown files have reviewed best-effort `sessionShape` entries where the existing protocol data supports one, or an explicit note from subagents where it does not.
- Requested concrete session/window additions are present where supported: Zone 2, cold plunge, morning outdoor light, post-meal walking, HBOT, whole-body red/NIR PBM, prolonged fasting, and conservative schedule/window candidates.

## Scope

- In scope:
- `packages/contracts` Health Commons protocol schema/type additions for optional `protocol.sessionShape`.
- `packages/health-commons` web artifact generation/runtime validation for experiment protocol tabs.
- Four existing protocol markdown files: Norwegian 4x4, Finnish Sauna, Bryan Johnson Sauna, Red Light Glasses Before Bed.
- Hosted-web experiment protocol tab rendering and focused tests.
- Subagent-assisted content pass over other protocol markdown files.
- Additional concrete session/window markdown additions requested on 2026-05-02.
- Out of scope:
- New visual design language or major protocol-tab layout changes.
- Changing protocol steps, expected-signal hierarchy, evidence claims, or generated artifact commit policy beyond the session-shape field.
- Inventing session shapes for protocols where current markdown does not contain enough concrete session timing/order semantics.

## Constraints

- Technical constraints:
- Preserve pre-existing dirty edits in overlapping hosted-web and Health Commons files.
- Do not encode UI colors/classes in markdown; store protocol semantics only.
- Keep package dependencies unchanged.
- Product/process constraints:
- Follow Health Commons markdown as the durable source for protocol content.
- Keep shape copy neutral and evidence-aligned; this is protocol structure, not outcome claim copy.

## Risks and mitigations

1. Risk: Content metadata becomes UI-specific and brittle.
   Mitigation: Store only labels, segment kinds, durations, repeats, and display tick labels; let React own styling.
2. Risk: Existing generated artifacts are stale or heavily dirty from other active rows.
   Mitigation: Regenerate for verification, but stage only scoped authored/generated files if safe; otherwise report overlap.
3. Risk: Subagents add speculative shapes to weakly structured protocols.
   Mitigation: Give subagents a conservative rule: add a shape only when timing/order is explicit in existing protocol fields.

## Tasks

1. Add optional session-shape schema/types and generated web projection plumbing.
2. Move the four existing hardcoded shapes into their markdown protocol specs.
3. Update `ProtocolTab` to render from `experiment.sessionShape`.
4. Update focused tests.
5. Run subagents over remaining protocol markdown files with disjoint write sets.
6. Run a second subagent pass over the user-requested concrete session/window list, keeping schedule-like candidates conservative.
7. Regenerate artifacts and run focused verification/audits.

## Decisions

- Session-shape metadata belongs under `protocol.sessionShape` in markdown because it is protocol truth, while React remains responsible for visual styling.
- Schedule windows can use `sessionShape` only when the protocol has a concrete timing window worth rendering; daily totals, supplements, diet targets, and lab-feedback protocols stay skipped.

## Verification

- Passed:
  - `pnpm --dir packages/contracts typecheck`
  - `pnpm --dir packages/contracts test`
  - `pnpm --dir packages/health-commons generate:check`
  - `pnpm --dir packages/health-commons generate`
  - `pnpm --dir packages/health-commons typecheck`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/health-commons-bryan-johnson-protocol.test.ts -t "projects requested concrete protocol windows" --no-coverage`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/protocol-tab-session-shape.test.ts --no-coverage`
  - `git diff --check` over the session-shape task files.
- Required review passes:
  - Coverage-write: no extra proof gap found.
  - Security/privacy: no findings.
  - Frontend-review: found evenly spaced ticks for unequal durations; fixed with structured tick offsets.
  - Task-finish-review: no findings after the structured tick fix.
- Blocked or unrelated:
  - Full `pnpm --dir packages/health-commons test` still fails in `test/catalog.test.ts` on expected-signal fixture churn from the separate content-owned overrides row.
  - Full `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/health-commons-bryan-johnson-protocol.test.ts --no-coverage` still fails one unrelated Finnish Sauna route-id expectation owned by the content-owned overrides row.
  - `pnpm --dir apps/web typecheck` still fails in `apps/web/test/health-commons-biomarker-detail-page.test.ts` where `protocolRanking` test fixtures are being replaced by the separate content-owned overrides row.
Completed: 2026-05-02
