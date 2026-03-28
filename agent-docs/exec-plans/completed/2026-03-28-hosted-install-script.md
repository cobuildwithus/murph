# Hosted install script

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

- Publish a raw hosted installer at `apps/web/public/install.sh` and update the public homepage so the quick-start command uses that entrypoint instead of repo-clone commands.

## Success criteria

- `apps/web/public/install.sh` exists and serves as a thin macOS/Linux bootstrapper for Murph.
- The script preserves the intended install behavior: checkout detection, Node bootstrap, npm-vs-git install selection, and `/dev/tty` reattachment for interactive onboarding.
- The homepage quick-start section points at `curl ... /install.sh | bash` and still explains what the installer does.
- Focused hosted-page verification covers the new install command and script syntax stays clean.

## Scope

- In scope:
  - hosted raw installer asset under `apps/web/public`
  - public homepage quick-start copy in `apps/web/app/page.tsx`
  - focused homepage test updates
- Out of scope:
  - changing Murph's underlying setup runtime in `scripts/setup-host.sh`
  - broader landing-page redesign
  - new route handlers or download APIs for the hosted app

## Constraints

- Keep the installer thin and delegate real provisioning to `murph onboard` or `scripts/setup-host.sh`.
- Preserve compatibility with `curl | bash` interactive onboarding by reattaching stdin from `/dev/tty` when available.
- Avoid touching unrelated dirty hosted-execution, onboarding, or landing-page work.

## Tasks

1. Copy the provided installer into `apps/web/public/install.sh` and normalize any repo-specific assumptions.
2. Update the homepage quick-start block to advertise the raw hosted installer with operator-friendly examples.
3. Extend focused hosted-page verification, run shell syntax validation for the installer, then run required repo checks and audit passes.

## Verification

- `bash -n apps/web/public/install.sh` passed.
- `pnpm --dir ../.. exec vitest run --config apps/web/vitest.config.ts apps/web/test/page.test.ts apps/web/test/hosted-onboarding-landing.test.ts --no-coverage --maxWorkers 1` passed.
- Direct scenario proof: `pnpm --dir apps/web dev:smoke` passed, including repeated `GET /` and `HEAD /` checks for the hosted homepage.
- `pnpm --dir apps/web test` remains blocked by a pre-existing hosted type error in `apps/web/test/hosted-execution-outbox.test.ts` (`activated` no longer matches `HostedExecutionUserStatus`).
- `pnpm typecheck` remains blocked by pre-existing `@murph/runtime-state` export mismatches consumed by `packages/core` and `packages/cli`.
- `pnpm test` remains blocked by a pre-existing `packages/assistant-runtime` build failure referencing `packages/device-syncd/dist/index.d.ts`.
- `pnpm test:coverage` remains blocked when the repo reaches `apps/web test`, due to the same pre-existing `apps/web/test/hosted-execution-outbox.test.ts` mismatch.

## Audit Note

- Repo policy requests spawned simplify, coverage, and finish-review audit passes, but this session's higher-priority tool policy does not allow delegation unless the user explicitly asks for subagents.
Completed: 2026-03-28
