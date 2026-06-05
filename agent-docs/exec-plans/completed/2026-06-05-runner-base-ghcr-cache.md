# Runner Base GHCR Cache

## Goal

Make hosted-local CI E2E runner base-image preparation reliable under cold
GitHub-hosted runners by reusing GHCR-published native runner assets and keeping
local rebuilds off Hugging Face.

## Scope

- Cloudflare hosted runner base/model Dockerfiles
- Runner base-image preparation script and focused tests
- GitHub Actions hosted E2E/package publish workflow wiring
- Minimal deploy/verification docs for the new image contract

## Constraints

- Preserve SHA verification for the Whisper model.
- Keep GHCR as a cache/artifact source, not a new runtime authority.
- Do not add npm dependencies or new secret requirements.
- Preserve the local rebuild escape hatch for intentional base-image changes.
- Preserve unrelated active hosted-runtime and assistant-engine worktree edits.

## Verification

- Run focused Cloudflare runner-image contract tests.
- Run `pnpm typecheck` unless blocked by unrelated active worktree changes.
- Run `git diff --check` for touched files.

## Completion

- Run required completion audits for hosted runner/deploy CI changes.
- Use `scripts/finish-task` for the final scoped commit when safe.

## State

- The base Dockerfile copies the Whisper model from a pinned GHCR model image and still verifies the model SHA.
- The runner base image script can publish stable/fingerprinted GHCR tags, pull matching GHCR base images, or fall back to a local build.
- Hosted-local and deploy workflows log in to GHCR with `GITHUB_TOKEN` before preparing the runner base image.
- Security review found that GHCR publish needed a protected-main guard and production deploy artifact prep should not adopt GHCR base-image labels as authority; both are fixed.
- Simplify review found model-tag drift and remote-retag ordering risks; the publish workflow now derives the model image from the base Dockerfile and remote images are inspected before local retag.
- Security rerun found direct `deploy:worker` still needed forced base prep; fixed in `apps/cloudflare/package.json` and docs. Final security rerun had no medium-or-higher findings.
- Coverage-write added test-only proof for the model tag/SHA contract, protected-main publish workflow, GHCR best-effort login, and forced production deploy prep.
- Final and deep reviews found forced production source builds still need explicit access to the pinned GHCR model image; the runner script now preflights that pull, and production build-prep jobs log in to GHCR before forced base builds.
- Security/deep reruns found that PR hosted-local E2E must not leave GHCR credentials available to PR-controlled code; PR E2E now uses anonymous GHCR pulls only, and docs require public GHCR model/base packages.
- Task-finish/deep reruns found that publish should skip already mirrored model tags, model-bump PRs need a documented prepublish process, and Docker pulls should specify the runner `linux/amd64` platform; all three are fixed with tests/docs.
- Final security/privacy, task-finish, and deep-review reruns found no remaining actionable issues. Residual human setup: make the GHCR model and runner base packages public after first publish so PR CI can pull anonymously.
- Focused Cloudflare image/workflow Vitest, focused CLI workflow guard, `pnpm typecheck`, `pnpm --dir apps/cloudflare verify`, `pnpm --dir packages/hosted-local-harness test`, scoped `git diff --check`, and scoped privacy scan passed after the final model-image preflight/login fix.
- Scoped `test:diff` is blocked by unrelated CLI assistant-codex expected-code failures outside this task.
Status: completed
Updated: 2026-06-05
Completed: 2026-06-05
