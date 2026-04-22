# Land setup-cli onboarding public URL UX fixes

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

- Land the setup CLI onboarding UX fixes for local wearable/device-sync setup so operators clearly understand which URLs stay local, which URLs must be pasted into provider dashboards, how to expose a public callback path during local testing, and how to reprint that guidance later in the flow without getting stuck on prompt recovery.

## Success criteria

- The onboarding/public-link guidance clearly separates local receiver URLs from the public URLs to paste into WHOOP, Garmin, Oura, and Strava.
- The public-link screen shows an explicit local-test tunnel path with concrete `ngrok` and `cloudflared` examples.
- Callback and webhook labels correctly communicate required versus optional provider setup expectations.
- Later wearable credential prompts accept `?` / `help` to reprint the guidance and treat `q` as cancel instead of input.
- The guidance still appears when `DEVICE_SYNC_PUBLIC_BASE_URL` is configured to a localhost value.
- Focused verification and required audit passes complete, and the landing is committed with `scripts/finish-task`.

## Scope

- In scope:
  - `packages/setup-cli` onboarding/public-link guidance, related prompt/help flow, and directly coupled tests.
  - The directly coupled `packages/operator-config` missing-env prompt seam needed for later `?` / `help` / `q` behavior.
- Out of scope:
  - `packages/device-syncd` runtime behavior changes.
  - Hosted `apps/web` device-sync onboarding or provider implementation changes.
  - Persisting a public-base-url choice from the public-link informational step.

## Constraints

- Technical constraints:
  - Keep the landing within `packages/setup-cli`, the directly coupled `packages/operator-config` prompt seam, and directly coupled tests unless current code structure forces a tiny adjacent change.
  - Treat the missing downloaded patch file as unavailable and implement from the described behavior instead of fabricating patch provenance.
- Product/process constraints:
  - Follow the repo standard-change workflow with a plan, ledger row, verification, required audit passes, and a scoped commit.
  - Preserve unrelated working-tree edits if any appear during the task.

## Risks and mitigations

1. Risk: The current onboarding flow may reuse the same copy in multiple prompt paths, so a narrow wording fix could miss the recovery/help route.
   Mitigation: Trace the prompt/help entrypoints first and add focused tests around the later credential prompt recovery behavior.
2. Risk: Provider callback/webhook wording could drift from current local-versus-hosted product behavior.
   Mitigation: Keep changes informational only, preserve the existing no-persist behavior, and align labels with the current local device-sync routing contract already present in repo docs and code.

## Tasks

1. Inspect the current `packages/setup-cli` public-link flow, help printing, and later wearable credential prompts.
2. Update the guidance copy and branch conditions for local receiver URLs, public provider URLs, tunnel examples, and required/optional labels.
3. Add recovery/help behavior so `?` / `help` reprints the guidance and `q` cancels during the later prompt path.
4. Update focused tests to cover the changed UX and localhost public-base-url behavior.
5. Run scoped verification plus required `coverage-write` and `task-finish-review` passes, then land with `scripts/finish-task`.

## Decisions

- Treat this as a standard repo change with a plan because the downloaded patch artifact is unavailable and the behavior needs direct in-tree implementation plus verification.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:diff packages/setup-cli/src/setup-wizard-public-url.ts packages/setup-cli/src/setup-wizard-ui.ts packages/setup-cli/src/setup-wizard-app.ts packages/setup-cli/src/setup-wizard.ts packages/setup-cli/src/setup-cli.ts packages/operator-config/src/setup-runtime-env.ts packages/setup-cli/test/setup-wizard-ui.test.ts packages/setup-cli/test/setup-wizard.test.ts packages/setup-cli/test/setup-surface.test.ts packages/operator-config/test/setup-runtime-env-prompt.test.ts packages/cli/test/setup-cli.test.ts`
- Expected outcomes:
  - The touched setup/onboarding slice stays green under typecheck and diff-aware tests.
  - Final audit passes do not find unresolved high-severity issues.
- Actual outcomes:
  - `pnpm typecheck` and the routed `pnpm test:diff ...` lane were both blocked by a credibly unrelated pre-existing `packages/assistant-engine/test/assistant-usage-attribution-and-scheduled-log.test.ts` typecheck failure (`scheduledLog` vs `scheduled_log`, plus missing required `status` in `UpsertScheduledLogInput`).
  - Direct touched-package verification passed after rebuilding touched package declarations:
    - `pnpm --dir packages/operator-config build`
    - `pnpm --dir packages/setup-cli build`
    - `pnpm --dir packages/operator-config typecheck`
    - `pnpm --dir packages/setup-cli typecheck`
    - `pnpm --dir packages/cli typecheck`
    - `pnpm --dir packages/operator-config test -- test/setup-runtime-env-prompt.test.ts`
    - `pnpm --dir packages/setup-cli test -- test/setup-wizard-ui.test.ts test/setup-wizard.test.ts test/setup-surface.test.ts`
    - `pnpm --dir packages/cli test:source -- packages/cli/test/setup-cli.test.ts`
  - Required `coverage-write` audit found no missing proof additions were needed.
  - Required `task-finish-review` found one medium issue in the tunnel command copy for non-default device-sync ports; the fix was landed and the affected package checks above were rerun green.
Completed: 2026-04-22
