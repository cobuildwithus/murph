# Hosted Whisper Parity

## Goal

Close the hosted Cloudflare runner audio-transcription parity gap so the default native-container image ships a working `whisper.cpp` CLI plus a default Whisper model, matching the parser toolchain contract instead of requiring extra operator image customization for basic audio transcription.

## Why

- The hosted runner image already bakes `ffmpeg` and `pdftotext`, and the hosted env surface already forwards `WHISPER_COMMAND` and `WHISPER_MODEL_PATH`.
- The current image creates a Whisper model directory but does not install a `whisper.cpp` binary or a default model, so audio parsing is not actually ready out of the box.
- Debian Bookworm does not provide the needed `whisper.cpp` package in the base image path, so the hosted image needs an explicit provisioning step.

## Scope

- `Dockerfile.cloudflare-hosted-runner`
- `apps/cloudflare/test/**` for hosted runner env/deploy contract coverage
- `apps/cloudflare/README.md`
- `apps/cloudflare/DEPLOY.md`
- `ARCHITECTURE.md` only if the durable runtime contract description needs to become more explicit

## Constraints

- Keep the fix narrow to hosted runner image provisioning and the documented hosted contract.
- Prefer a deterministic pinned install path over implicit package-manager availability.
- Preserve unrelated dirty-tree edits already in progress.

## Verification

- Focused `apps/cloudflare` tests for the hosted env/deploy contract
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Outcome

- Completed.
- Hosted runner image now builds a pinned `whisper.cpp` `whisper-cli` binary in a multi-stage Docker build, copies it into the runtime image, and bakes the default `ggml-base.en.bin` model into the hosted models directory.
- Focused proof passed: `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/container-image-contract.test.ts apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/deploy-automation.test.ts`
- Required verification passed: `pnpm typecheck`, `pnpm test`
- Required verification gap: `pnpm test:coverage` failed twice in `apps/web` because `apps/web/scripts/dev-smoke.ts` reported a stale active Next dev smoke process (`pid 74522`, `port 60998`) after waiting `15000ms`; that hosted-web cleanup failure is outside the hosted whisper image change.
Status: completed
Updated: 2026-04-03
Completed: 2026-04-03
