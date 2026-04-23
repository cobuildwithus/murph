# Add first-class research lane command

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Add a first-class Health Commons research command that sends and harvests generated seams through explicit named review-gpt browser lanes.

## Success criteria

- Root package exposes `pnpm research:run`.
- First send requires a named lane and records it under the research workspace state.
- Harvest reuses the recorded lane unless an explicit override is provided.
- Generated research runbooks show the named-lane command instead of direct low-level shell wrappers.
- Explicit named-lane browser endpoints beat stale per-seam result-log endpoints during harvest.

## Scope

- In scope: repo tooling, generated research runbook text, focused tests for the command surface and endpoint precedence.
- Out of scope: changing already-launched research threads, browser profile asset generation, review-gpt preset semantics, Health Commons content landing.

## Constraints

- Technical constraints: keep direct generated `commands/*.send.sh` and `commands/*.harvest.sh` wrappers available as low-level escape hatches; avoid absolute local paths or personal identifiers in generated state.
- Product/process constraints: preserve unrelated active review-gpt/profile-normalization work and the existing charter-first orchestrator structure.

## Risks and mitigations

1. Risk: direct users still invoke low-level generated wrappers and miss lane state.
   Mitigation: generated runbooks and root script make the named-lane route the documented path while preserving the wrappers for recovery.
2. Risk: stale send logs keep steering harvest to an old browser endpoint.
   Mitigation: generated helper prefers explicit profile-wrapper endpoint env before result-log fallback.

## Tasks

1. Add `scripts/research-run.mjs` and package script wiring. Done.
2. Export research lane and endpoint env from the named profile helper. Done.
3. Update generated runbook text for init/materialize. Done.
4. Add focused tests for root script behavior and endpoint precedence. Done.
5. Run syntax, focused tests, typecheck, privacy diff review, and scoped finish. In progress.

## Decisions

- Require `--lane` for first send; harvest may omit it after a successful lane-recorded send.
- Use `eragon` in generated examples because the research work-profile config already defaults to that named Brave lane.
- Send state clears stale harvest metadata on resend because the generated send wrapper also removes old wake/thread outputs.

## Verification

- `node --check scripts/research-run.mjs`: passed.
- `bash -n scripts/review-gpt-browser-profile.sh`: passed.
- `pnpm exec vitest run scripts/research-init.test.ts --config scripts/vitest.config.ts --no-coverage`: passed.
- `pnpm exec vitest run packages/cli/test/release-script-coverage-audit.test.ts --config packages/cli/vitest.workspace.ts --no-coverage`: passed.
- `pnpm typecheck`: passed.
- Required `task-finish-review` audit: completed; medium resend-state issue and low integration-proof gap both addressed.
Completed: 2026-04-24
