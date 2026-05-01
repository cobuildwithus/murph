# Land hosted parser toolchain greenfield cut

Status: active
Created: 2026-05-01
Updated: 2026-05-01

## Goal

- Land the supplied hosted parser toolchain greenfield cut so the hosted runner
  owns native parser executable/model paths from the image, rejects
  `parserToolchain:null`, and stops projecting parser path config into isolated
  child process environment.

## Success criteria

- Runner native parser toolchain construction is zero-arg and returns stable
  image-owned paths.
- `parserToolchain:null` is rejected at hosted runtime parsing, launch-spec, and
  hosted runner boundaries.
- Isolated child env projection no longer emits parser command/model path vars.
- The runner base image copies the configured Whisper model to the stable
  `/home/runner/.murph/models/whisper/model.bin` path.
- Focused tests, typecheck, required audits, and diff checks pass or any
  unrelated blockers are recorded.

## Scope

- In scope:
  - `Dockerfile.cloudflare-hosted-runner-base`
  - Hosted runner env/native parser toolchain code in `apps/cloudflare/src/**`.
  - Hosted runtime config/env/launch parser handling in
    `packages/assistant-runtime/src/hosted-runtime/**`.
  - Directly coupled Cloudflare and assistant-runtime tests.
- Out of scope:
  - Broader hosted web, device-sync, active-turn, or local Codex provider work.
  - Changing per-user env allowlist policy beyond existing parser path behavior.
  - Running live Cloudflare deploys or live external parser model downloads.

## Constraints

- Technical constraints:
  - Preserve explicit typed parser toolchain support when a caller provides it.
  - Do not rediscover native parser paths from forwarded env/config sources.
  - Keep per-user/env overrides from steering executable selectors.
- Product/process constraints:
  - Preserve unrelated dirty work in the shared checkout.
  - Coordinate with active hosted-runner/Cloudflare rows and keep this landing
    narrow.
  - Do not write local usernames, home paths, legal names, secrets, or raw
    credentials into files, logs, docs, or handoff.

## Risks and mitigations

1. Risk: Removing parser env projection breaks callers that relied on env path
   overrides.
   Mitigation: Keep explicit typed `parserToolchain` support and update tests to
   prove typed fields are preserved.
2. Risk: Null parser toolchain used to mean "ambient fallback" and can silently
   re-enable env discovery.
   Mitigation: Reject `parserToolchain:null` at each runtime boundary with a
   clear error.
3. Risk: Stable model path diverges from the image copy destination.
   Mitigation: Assert both the Dockerfile copy destination and native toolchain
   constant in tests.

## Tasks

1. Apply the supplied patch against current files, adjusting for local drift.
2. Update tests around native parser defaults, null rejection, and child env
   projection.
3. Run focused Cloudflare/assistant-runtime verification and typecheck/diff
   checks.
4. Run required security/privacy, coverage-write, and final review audits.
5. Close the plan and create a scoped commit if the touched paths are safe to
   commit.

## Decisions

- Treat the supplied patch as behavioral intent, not overwrite authority, so
  local tests may be adjusted to match current file layout.

## Verification

- Commands to run:
- `pnpm exec vitest run apps/cloudflare/test/container-image-contract.test.ts apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/runner-child-launcher.test.ts packages/assistant-runtime/test/hosted-runtime-environment.test.ts packages/assistant-runtime/test/hosted-runtime-config.test.ts --config apps/cloudflare/vitest.node.workspace.ts --no-coverage` or equivalent owner-specific focused commands if config ownership requires splitting.
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff <touched paths>`
- `git diff --check`
- Expected outcomes:
- Focused tests and typecheck pass.
- Diff check passes.
- Required audits report no blocking findings, or fixes are landed and checks
  are rerun.
