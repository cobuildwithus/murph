# Newsletter setup flow, join offer copy, and week data window

Status: completed
Created: 2026-07-07
Updated: 2026-07-07

## Goal

- Make group newsletter setup conversational instead of instant/defaulted, make newsletter join offers disclose the default health reaction-share scope plus a customize link, clarify opt-in sharing copy, and let each vault-share delivery carry a full seven-day health window.

## Success criteria

- Group newsletter prompt guidance asks a short setup question set before creating email newsletter automations, applies the chosen name/schedule/channel/tone, and routes chat delivery to normal scheduled group-chat updates.
- Join-offer validation requires `{{share_scope}}` exactly once and allows `{{join_url}}` to be absent or present exactly once for non-newsletter offers.
- Newsletter join offers use the disclosed default health scope (`group-email.v0`, `sleep-times.v0`, `activity-days.v0`, `workout-days.v0`, `resting-heart-rate-days.v0`, `hrv-days.v0`) and include `{{join_url}}` exactly once as the customize path.
- Join/share copy drops repetitive "Recent" wording, removes "bounded shared records", and states the seven-day window plainly.
- Projection windows for nights and daily records are seven, and the delivery path is checked for per-kind versus total record caps.
- Focused tests and stale-string searches cover the changed behavior.

## Scope

- In scope: assistant prompt/skill guidance, hosted group join-offer validation and copy, focused tests, assistant-runtime projection windows, and the group newsletter product spec.
- Out of scope: new scheduler/email infrastructure, default-on health sharing toggles, schema migrations, broad UI redesign, or committing the final diff.

## Constraints

- Technical constraints: keep the implementation small, avoid new abstractions unless immediately justified, preserve opt-in health sharing, and keep package-owner boundaries intact.
- Product/process constraints: no em dashes in user-facing copy, follow iMessage link hygiene, avoid personal identifiers in generated files or handoff, and do not commit because the supervisor reviews and commits.

## Risks and mitigations

1. Risk: The seven-day projection window could still be truncated by a total per-delivery cap.
   Mitigation: Inspect the `offerHostedVaultShareProjectionBestEffort` delivery path and report if the cap is total rather than per-kind.
2. Risk: Prompt guidance becomes a rigid script.
   Mitigation: Keep prose outcome-first and terse, matching the existing skill style.
3. Risk: Copy changes drift from real retention behavior.
   Mitigation: Align labels/descriptions with the updated projection windows and existing seven-record receiver retention.

## Tasks

1. Inspect touched code paths, tests, and existing prompt/copy text.
2. Implement prompt/tool guidance, join-offer validation, sharing copy, and projection-window changes.
3. Update focused tests and the group newsletter product spec.
4. Run targeted tests, package checks, typecheck/lint as feasible, and stale-string greps.
5. Re-read the final diff and prepare handoff without committing.

## Decisions

- A reaction to a newsletter offer is an informed opt-in when the message discloses the exact default health scope; the customize link lets members share more or less.
- Use a tiny label phrase helper for share-scope casing instead of per-kind phrase tables.
- Keep plan and ledger active for supervisor review rather than committing in this turn.
- The consent invariant is that the stored offer snapshot and rendered `{{share_scope}}` are derived from the same `projectionKinds` list.

## Verification

Follow-up verification on 2026-07-07:

- Focused hosted web Vitest passed for hosted-group-tool, hosted-group join-offer reaction and accept route, join page, and join invite page/client/state/island/status/success tests.
- Focused hosted-execution Vitest passed for runtime-control, parser, and vault-share tests.
- Focused assistant-runtime Vitest passed for vault-share projection tests.
- Focused assistant-engine Vitest passed for group dynamic-tool parsing and skill asset tests.
- `git diff --check` passed.
- `pnpm typecheck` passed.
- `pnpm --dir apps/web lint` passed with existing warnings only.
- `pnpm docs:drift` passed.
- Literal stale-string search found no old email-only/link-free/required-join-url or old projection-copy strings in the touched surfaces.

Prior verification before this follow-up:

- `pnpm install --frozen-lockfile` to initialize this clean worktree's dependencies.
- `pnpm --dir apps/web prisma:generate` before web Vitest because the clean worktree had no generated Prisma client.
- Focused Vitest passed for hosted group tool/join/vault-share web tests, hosted-execution runtime-control/parser/vault-share tests, assistant-runtime vault-share projection/import tests, and assistant-engine group tool/skill asset tests.
- Full package tests passed for `apps/web`, `packages/assistant-engine`, `packages/assistant-runtime`, and `packages/hosted-execution`. The first assistant-runtime full run hit a timing failure in `hosted-runtime-linq-audio-e2e.test.ts`; the failing file passed in isolation and the full package rerun passed.
- `pnpm build:workspace:incremental` was needed before root typecheck because this clean worktree lacked built workspace subpath declarations.
- `pnpm typecheck` passed after the workspace artifact build.
- `pnpm --dir apps/web lint` passed with existing warnings only.
- `pnpm docs:drift` passed after updating `agent-docs/index.md`.
- `pnpm test:diff <task paths>` passed, including affected package tests plus `apps/cloudflare verify` and `apps/web verify`.
- Final stale-string greps found no remaining old sharing labels, `bounded shared records`, `Your address is visible`, or join URL required-once contract text in the touched surfaces.
Completed: 2026-07-07
