# Hosted Local Docker Prune Guard

Status: completed
Created: 2026-05-24
Updated: 2026-05-24

## Goal

- Prevent local Cloudflare runner Docker workflows from accumulating stale Murph runner images after smoke/E2E runs, while preserving active containers, the expensive stable base image, and unrelated Docker state by default.

## Success criteria

- Direct runner Docker smoke/Python-path commands clean the transient final runner image they build.
- Hosted-local cleanup can prune Murph-owned local runner final images without touching Docker volumes or unrelated project containers/images.
- Focused tests cover image selection and cleanup wiring.
- Local Docker post-check remains at one running MinIO container/image after the manual prune already performed for this task.

## Scope

- In scope: `apps/cloudflare` runner Docker scripts/package scripts, hosted-local Docker cleanup helpers, focused tests/docs tied to those surfaces.
- Out of scope: production Cloudflare image registry cleanup, Docker volumes, unrelated Docker containers/images, base-image rebuild policy unless needed for stale-cache prevention.

## Constraints

- Technical constraints: keep cleanup scoped to Murph local runner artifacts; avoid broad `docker system prune` in repo automation; preserve the current running MinIO container.
- Product/process constraints: preserve unrelated dirty worktree edits and avoid local user/home identifiers in docs, logs, or generated files.

## Risks and mitigations

1. Risk: cleanup removes unrelated Docker images.
   Mitigation: filter by Murph runner repository names and the existing hosted runner local-build label.
2. Risk: Docker BuildKit cache keeps growing if the expensive base image is repeatedly deleted and rebuilt.
   Mitigation: preserve the stable base image by default and keep automatic cleanup scoped to transient final images; avoid broad builder-cache pruning while hosted-local dev may be active.

## Tasks

1. Completed: inspected current Docker storage and pruned stale local artifacts.
2. Completed: patched local runner Docker cleanup/smoke scripts.
3. Completed: added focused tests for cleanup selection and direct-script `finally` cleanup wiring.
4. Completed: ran focused tests plus Cloudflare package typecheck.
5. Now: close the plan and commit if the dirty worktree allows a scoped commit.

## Decisions

- Preserve `murph-cloudflare-runner-base` by default because it is the stable expensive native base image; clean transient final app images instead.

## Verification

- Passed: `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/dev-hosted-local/runtime.cleanup.test.ts`.
- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/local-runner-docker-cleanup.test.ts apps/cloudflare/test/container-image-contract.test.ts`.
- Passed: `pnpm --dir apps/cloudflare typecheck`.
- Attempted: `pnpm typecheck`; blocked waiting on the active hosted-local runner bundle lock from the user's running `pnpm dev`, then the queued check was terminated without stopping dev.
- Passed: `git diff --check` for the touched files.
Completed: 2026-05-24
