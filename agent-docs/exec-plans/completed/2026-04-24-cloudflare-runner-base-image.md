# Cloudflare Runner Base Image Split

## Goal

Reduce the `cf:deploy` Worker deploy step by moving stable native runner dependencies out of the Wrangler-built app image layer.

Success criteria:

- The hosted runner image keeps the same runtime contract.
- Day-to-day deploys avoid rebuilding `ffmpeg`, `whisper.cpp`, and the default Whisper model in the `Deploy Worker` step.
- Local Docker smoke/build paths prepare the base image before building the final runner image.
- The GitHub deploy workflow prepares the base image with a reusable CI cache before `wrangler deploy`.

## Scope

- `Dockerfile.cloudflare-hosted-runner*`
- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/cloudflare/package.json`
- directly coupled Cloudflare deploy/container tests and docs
- durable verification/runtime docs that describe the Cloudflare deploy surface

## Constraints

- Preserve the existing Wrangler deploy model and generated container config shape.
- Do not introduce new npm dependencies or lockfile changes.
- Do not require a new GitHub environment variable for normal deploys.
- Keep secrets out of Docker build contexts and logs.

## Progress

- Done: split the native runner dependencies into `Dockerfile.cloudflare-hosted-runner-base`.
- Done: reduced `Dockerfile.cloudflare-hosted-runner` to the app bundle layer.
- Done: updated local deploy/dev/docker scripts and the GitHub deploy workflow to prepare the base image before Wrangler deploys the app image.
- Done: updated Cloudflare deploy docs, durable verification docs, and direct contract tests.
- Done: focused Cloudflare checks, root typecheck, scoped diff verification, base-image build, and final app-image build passed.
- Done: required `coverage-write` and `task-finish-review` audits completed with no findings.
- Note: `pnpm verify:acceptance` is red on an unrelated existing `packages/cli/test/gateway-core.test.ts` sendability expectation; this task has no diffs under `packages/cli` or `packages/gateway-core`.
Status: completed
Updated: 2026-04-24
Completed: 2026-04-24
