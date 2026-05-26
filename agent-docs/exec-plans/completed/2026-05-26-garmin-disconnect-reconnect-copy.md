# Garmin disconnect reconnect copy

Status: completed
Created: 2026-05-26
Updated: 2026-05-26

## Goal

- Stop treating an intentionally disconnected wearable source as an
  attention-worthy reconnect failure on the hosted connect/settings surfaces.
- Reauthorization-required and active sync-error states should still offer
  reconnect; disconnected sources should stay quiet and be available for a
  normal connect flow when the provider target is configured.

## Success criteria

- A disconnected Garmin/Junction-backed source no longer renders "Please
  reconnect ... to resume syncing" on `/connect`.
- Disconnected configured sources do not carry a reconnect primary action from
  `buildHostedDeviceSyncSettingsSources`.
- Reauthorization-required sources and active sources with a reconnect action
  remain reconnectable.
- Focused hosted-web tests and type/lint checks pass, or unrelated blockers are
  recorded precisely.

## Scope

- In scope:
  - `apps/web/src/lib/device-sync/settings-surface.ts`
  - `apps/web/app/(dashboard)/connect/page.tsx`
  - Focused hosted-web tests for the settings surface and connect page.
- Out of scope:
  - Provider OAuth, token storage, wake scheduling, runtime apply semantics, or
    persisted-state schema changes.
  - Broad visual redesign of the connect grid.

## Constraints

- Technical constraints:
  - Preserve the distinction between `disconnected` and
    `reauthorization_required`.
  - Do not add new persisted state or change provider auth authority.
  - Preserve existing active/reconnect sorting behavior.
- Product/process constraints:
  - Preserve unrelated dirty worktree edits and active coordination rows.
  - Do not expose local identifiers, secrets, provider payloads, user ids, or
    paths in code, docs, logs, tests, commits, or handoff.

## Risks and mitigations

1. Risk:
   Accidentally hiding real access failures.
   Mitigation: keep `reauthorization_required` and active reconnect-action tests
   green while only removing disconnected from reconnect classification.
2. Risk:
   Removing the user's path to reconnect after a deliberate disconnect.
   Mitigation: the connect page should fall back to its normal configured
   `Connect` action for that source.

## Tasks

1. Confirm the source of the reconnect prompt and current tests.
2. Change settings-source disconnected action semantics.
3. Change connect-page source matching so disconnected rows do not imply
   reconnect.
4. Update focused tests for direct and Junction-backed disconnected sources.
5. Run focused tests plus required hosted-web verification.
6. Run completion audits and close the plan through the scoped commit path.

## Decisions

- Treat `disconnected` as a quiet, user-intent state on browser surfaces.
- Treat `reauthorization_required` and active sync failures as the reconnect
  states that deserve attention and a reconnect CTA.

## Verification

- Commands to run:
  - `pnpm exec vitest run apps/web/test/connect-page.test.ts apps/web/test/device-sync-settings-surface.test.ts --config apps/web/vitest.config.ts --no-coverage`
  - `bash scripts/workspace-verify.sh test:diff apps/web/app/(dashboard)/connect/page.tsx apps/web/src/lib/device-sync/settings-surface.ts apps/web/test/connect-page.test.ts apps/web/test/device-sync-settings-surface.test.ts`
  - `pnpm --dir apps/web lint`
  - `pnpm typecheck`
- Expected outcomes:
  - Focused tests and scoped checks pass, or any unrelated failure is recorded
    with the failing target and why this diff did not cause it.
- Results:
  - Focused Vitest passed: 2 files, 54 tests.
  - Scoped `test:diff` passed twice; final run passed hosted-web verify
    including app tests, lint, dev smoke, and Next build.
  - `pnpm --dir apps/web lint` passed.
  - `pnpm typecheck` passed.
  - Security/privacy review, frontend review, coverage-write, and final
    completion review completed with no findings.
Completed: 2026-05-26
