# Pair board 180-day history and pre-game baseline

Status: active
Created: 2026-11-06
Updated: 2026-11-06

## Goal

- The 1v1 board compares each number with the 60 days before the viewer's first game in that chat, using up to 180 days of shared history, so a chip can appear around Day 5 instead of Day 14.
- A 0-step row stops reading as a real baseline, and a worn device keeps the steps row over a merged total.

## Success criteria

- Baseline, fallback, clipped current week, 90-day-only snapshot, non-board shares and `daily` at 90 days are each covered by a test.
- No other vault-share reader receives more than it does today.
- Old Web, old runner and a Web rollback all keep working.

## Scope

- In scope: `boardNumber`, the board reader, Web delivery retention, the runner's daily metric window for the four board kinds.
- Out of scope: `boardCrowns`, consent and disclosure copy, murph-ios, any other projection kind, the rule that a device under half of the merged total came off.

## Constraints

- Technical constraints: no new table or projection kind. Record ceilings stay as they are.
- Product/process constraints: join and sharing copy is not edited here. The chat reader stays a 7-day, three-scope contract with its 90-date history read.

## Risks and mitigations

1. Risk: the runner's 180-day read fails or returns no rows because of older data, and costs a member the 90 days they share today.
   Mitigation: the wider read falls back to the unchanged 90-day read on a thrown bound or an unresolvable source.
2. Risk: a raised record ceiling would make old Web reject deliveries and make a Web rollback fail to parse stored snapshots.
   Mitigation: the 720-record ceiling does not move. A member over it publishes the complete 90 dates.
3. Risk: a snapshot now holds more than the shared reader may return.
   Mitigation: every reader names its window, the default stays 90, and only the board asks for 180.

## Tasks

1. Add per-kind retention in `@murphai/hosted-execution/vault-share`.
2. Retain it at Web delivery and in the runner's daily metric read.
3. Read 180 days on the board only, and move the baseline.
4. Apply the steps rules: zeros, first-real-reading fallback, worn over merged.
5. Update `ios-game.md`, the retention spec and the index.

## Decisions

- VO2 uses the same 60-day pre-game window with its median and two-reading minimum, and a 14-day current window clipped at Day 1. Its first-week fallback keeps the up-to-90-day baseline.
- `sinceFirstGame` is true for a pre-game baseline or one starting on `firstGameOn`, otherwise false, so the app names `baseline.from`.
- The first-week fallback has no `window.from` floor. A first game beyond retention uses the oldest retained week.
- Shared records carry the public source, not `sourceType`, so steps class sources by name. `google-health` counts as merged: Junction documents it as Fitbit, Pixel Watch and other synchronized sources. A Fitbit wearer with Apple Health therefore keeps the existing sort.
- A worn device counts only with at least four real days in the seven ending on the steps cutoff, so a stopped or spare device does not hold the row. A real-vault replay showed a spare device with more old days outranking the one in use under the looser one-reading rule.

## Verification

- Commands to run: `game-board-numbers`, `game-board-postgres` on an isolated `murph_test_*` database, `hosted-group-store`, `hosted-group-shared-read`, `vault-share-deliver-route`, `projection-store`, the runner vault-share suites, the `hosted-execution` suite, three typechecks, oxlint on changed files, `pnpm complexity:diff`, `pnpm docs:drift`.
- Expected outcomes: all exit 0.

## Rollout

- Web first (auto-deploys on merge), then the runner, deployed manually from main after the disclosure copy decision. Either order is safe, because old Web clips to 90 and old runners publish 90. A Web rollback stays safe, because no ceiling moved.
