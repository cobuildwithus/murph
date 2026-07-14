# Reduce ReviewGPT managed-browser CPU

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Reduce CPU contention from shared ReviewGPT browser lanes without interrupting active reviews, Codex sessions, or their child agents.

## Success criteria

- ReviewGPT keeps waited background response capture reliable while allowing occluded windows and unrelated renderers to use Chromium's normal background scheduling.
- Murph opts into the balanced browser policy through its repo configuration and consumes a released ReviewGPT patch.
- Existing browser lanes are not stopped or restarted by this task; the new launch policy takes effect on their next normal restart.
- ReviewGPT typecheck/tests/release checks and Murph's focused configuration checks pass.

## Scope

- In scope: ReviewGPT managed-browser launch flags and configuration, matching tests/docs, package patch release, Murph ReviewGPT configuration/docs, dependency lockfile update.
- Out of scope: terminating or reprioritizing live processes, closing browser targets, changing Codex sessions, deleting caches, or changing system startup/network settings.

## Constraints

- Preserve exact owned-target cleanup: waited runs close only the target they created, while draft-only and send-without-wait runs retain their user-facing target.
- Preserve a documented fully unthrottled fallback for browser versions that cannot capture reliably under the balanced policy.
- Never expose credentials, account identifiers, personal identifiers, or local home-directory paths.
- Keep the change small: one configuration value, one launch-argument decision, focused coverage, and the Murph opt-in.

## Risks and mitigations

1. Risk: background response DOM capture stalls on a browser that needs all legacy flags.
   Mitigation: keep background timer throttling disabled in balanced mode, retain active lifecycle/focus emulation for the owned page, and provide an explicit `unthrottled` fallback.
2. Risk: current pending reviews are interrupted while changing lane behavior.
   Mitigation: do not touch live lanes; launch arguments change only after a normal future restart.
3. Risk: Murph references an unreleased or mismatched package contract.
   Mitigation: release the verified ReviewGPT patch first, then update the dependency and lockfile to the published version.

## Tasks

1. Add and validate ReviewGPT's balanced/unthrottled managed-browser background policy.
2. Update ReviewGPT tests and browser behavior documentation.
3. Run required ReviewGPT verification, commit, and publish a patch release.
4. Configure Murph for balanced mode and update the dependency/lockfile and lifecycle documentation.
5. Run focused Murph verification, privacy checks, completion audit, and create the scoped commit.
6. Remeasure after the lanes next restart normally; do not force that restart while reviews are pending.

## Decisions

- Balanced mode retains `--disable-background-timer-throttling` for response polling but removes process-wide opt-outs from renderer background scheduling and occluded-window throttling.
- The old three-flag behavior remains available as `unthrottled` for targeted rollback.

## Progress

- Confirmed the sustained CPU load comes from three shared ReviewGPT lane processes launched with all Chromium background-throttling opt-outs, not from orphaned review targets.
- Confirmed pending reviews survived the browser-lane restart and the active lanes must remain untouched.
- Confirmed waited runs already pin their owned page lifecycle active and use exact target ownership cleanup.
- Added a balanced managed-browser background mode to ReviewGPT, retained the legacy fully unthrottled fallback, and released the verified change as `@cobuild/review-gpt@0.5.107`.
- Updated Murph's lane configuration, dependency lock, lifecycle documentation, and focused release/config assertions for the published package.
- Preserved every live Codex and ReviewGPT process; the new launch flags remain intentionally deferred until each lane's next normal restart.
- Completed the required coverage-write audit with no edits and no actionable coverage finding; existing focused assertions and direct dry-run proof were sufficient.

## Now

- Close the plan and create the scoped Murph commit.

## Next

- Open the low-risk tooling PR without running ReviewGPT against its own lane configuration change.

## Verification

- ReviewGPT: `pnpm typecheck`, 168 tests, and `pnpm release:check` passed; the v0.5.107 release workflow and npm publication succeeded.
- Murph: frozen lockfile install, shell and Node syntax, dependency policy, workspace boundaries, hosted runtime/Temporal/crypto/log guards, all three CLI typechecks, prepared runtime artifacts, Health Commons generation, and CLI package-shape verification passed.
- Murph direct proof: the installed ReviewGPT CLI dry run loaded `scripts/review-gpt.config.sh`, reported `Managed browser background mode: balanced`, and skipped browser launch.
- Murph scoped CLI suite: 18 of 19 files and 366 of 367 tests passed. The only failure was the unrelated release-tarball assistant manifest probe timing out while another lane ran the same expensive test under severe host contention. A single-worker retry hit the test's 120-second timeout after 615 seconds of wall time; no ReviewGPT assertion failed.
Completed: 2026-07-14
