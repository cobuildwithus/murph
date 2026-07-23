# Low-usage continuity selling and group funding link self-heal

Status: completed
Created: 2026-07-23

## Goal

- When trusted context says a conversation's Murph usage is running low, the
  assistant treats continuity (top-up or upgrade) as its standing objective
  instead of a passive heads-up, and a group chat that never minted a join
  code still gets a working first-party funding URL from `read_usage` and the
  exhausted notice.

## Why

- Production shows most group-chat thread containers have no `HostedGroup`
  row or join code, so the shipped exhausted-notice funding link and
  `read_usage` funding URL silently degrade to nothing for most groups: the
  chat pauses with no recovery path.
- The current `hosted-low-usage` skill gates the group funding link on the
  group asking first, which loses the room and wastes the low-usage window.

## Scope

- `apps/web/src/lib/hosted-groups/group-usage-funding.ts`: add
  `readHostedGroupUsageStatusEnsuringFundingUrl`, which reuses the existing
  owner-scoped `createHostedGroupJoinLinkForOwnedThreadContainerTx` to
  materialize the group shell and join link when the funding URL is missing.
  No new column, code lifecycle, or second locator.
- Consume it from the group `read_usage` tool action and the exhausted-notice
  delivery projection.
- `packages/assistant-engine/skills/hosted-low-usage/SKILL.md`: standing
  continuity objective; proactive group `read_usage` before the first
  heads-up; funding URL allowed in the first group heads-up; escalation as
  exhaustion nears. Guardrails preserved: urgent-turn deferral, one segment,
  no payer naming, no guilt or invented urgency, first-party links only.
- Product-spec updates in `hosted-usage-topups.md` and `hosted-plan-usage.md`.

## Decisions

- Reuse the join code as the only funding locator (per the 2026-07-20 group
  usage funding decision); self-heal it with the container owner as the
  recorded actor rather than adding a funding-code lifecycle. The shipped
  design already places the join-code funding URL into the group chat, so
  auto-minting extends an accepted exposure rather than creating a new class.
- Provisioning failures keep the current linkless behavior and log a
  structured warning; the read and the notice never fail because of the mint.

## Verification

- `pnpm test:diff` over touched paths; focused suites:
  `hosted-group-usage-funding`, `hosted-usage-limit-notice-message`,
  `hosted-group-tool`, `assistant-hosted-low-usage-skill`.
- `pnpm --dir apps/web verify` (or `verify:acceptance`) before handoff.

## Coordination

- `murph-group-usage-visibility` lane adds `remainingPercent` to
  `HostedGroupUsageStatus` and edits the same spec paragraphs; merge order is
  irrelevant but conflicts are expected in `group-usage-funding.ts` imports,
  `hosted-plan-usage.md`, and `hosted-group-tool.test.ts` mocks. This lane's
  skill text references the remaining percentage only as "when it returns
  one", so it is correct with or without that lane.
- `murph-topup-text-murph` lane touches Settings/fund-page UI only; no file
  overlap.
Updated: 2026-07-23
Completed: 2026-07-23
