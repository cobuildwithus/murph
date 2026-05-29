# Codex 0.135 runner upgrade

Status: completed
Created: 2026-05-29
Updated: 2026-05-29

## Goal

- Upgrade the hosted runner base image to Codex CLI `0.135.0` with a reversible base-image tag change and focused container/runtime validation.

## Success criteria

- The hosted runner base image installs `@openai/codex@0.135.0`.
- The base image build smoke keeps `codex --version` and `codex app-server --help`, and adds `codex doctor --help`.
- The final runner default base image tag includes `codex0.135.0` for an obvious rollback lever.
- Runner-base preparation and container/deploy contract tests cover the new version, smoke command, and base tag.

## Scope

- In scope:
  - `Dockerfile.cloudflare-hosted-runner-base`
  - `Dockerfile.cloudflare-hosted-runner`
  - `.github/workflows/deploy-cloudflare-hosted.yml`
  - `apps/cloudflare/scripts/runner-base-image-contract.ts`
  - `apps/cloudflare/test/container-image-contract.test.ts`
  - `apps/cloudflare/test/dev-worker.test.ts`
  - `apps/cloudflare/test/deploy-automation.test.ts`
  - `apps/cloudflare/DEPLOY.md`
- Out of scope:
  - Hosted assistant lane orchestration.
  - Mailbox, checkpointing, browser-vault, dynamic tool, or skill prompt policy changes.
  - Runtime `codex doctor` snapshots or a diagnostics subsystem.

## Constraints

- Keep Codex installed globally in the base image, not in the app bundle or workspace package graph.
- Do not assume unsupported Codex CLI flags beyond existing `--version`, `app-server --help`, and new `doctor --help`.
- Preserve unrelated active hosted progress, Junction, and Murph Age work.

## Tasks

1. Bump the base image Codex version.
2. Retag the final runner base-image default with the Codex version.
3. Extend the base image smoke with `codex doctor --help`.
4. Update the runner-base/container/deploy contract tests and deploy docs.
5. Run focused and required verification.

## Decisions

- Ship the version bump as the first slice; leave failure-time doctor snapshots for a later optional diagnostics change.
- Use the base image tag as the rollback boundary.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm --dir . exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/container-image-contract.test.ts apps/cloudflare/test/dev-worker.test.ts apps/cloudflare/test/deploy-automation.test.ts apps/cloudflare/test/runner-base-image.test.ts`
  - `pnpm test:diff .github/workflows/deploy-cloudflare-hosted.yml Dockerfile.cloudflare-hosted-runner-base Dockerfile.cloudflare-hosted-runner apps/cloudflare/scripts/runner-base-image-contract.ts apps/cloudflare/test/container-image-contract.test.ts apps/cloudflare/test/dev-worker.test.ts apps/cloudflare/test/deploy-automation.test.ts apps/cloudflare/DEPLOY.md`
Completed: 2026-05-29
