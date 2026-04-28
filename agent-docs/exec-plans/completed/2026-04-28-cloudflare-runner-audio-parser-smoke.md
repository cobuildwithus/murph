# Fix hosted runner Docker audio parser smoke failure

Status: completed
Created: 2026-04-28
Updated: 2026-04-28

## Goal

- Make the local hosted-runner Docker audio smoke robust and truthful after the
  CLI commands are discoverable: fix the linux/amd64 `whisper.cpp` illegal
  instruction failure under local arm64 emulation where feasible, and keep
  parser subprocess failures surfaced as command failures rather than missing
  transcript artifacts.

## Success criteria

- Root cause is identified without widening into full hosted E2E.
- Signal and unknown parser subprocess exits fail closed as command failures
  before provider-specific transcript artifact checks run.
- The hosted runner base image uses a portable amd64 `whisper.cpp` build path
  that can run under Docker Desktop arm64 emulation while preserving optimized
  CPU variants for production amd64 hosts.
- Local `pnpm --dir apps/cloudflare runner:docker:smoke` passes and exercises
  real `whisper.cpp` transcript output.
- Focused parser tests cover the corrected contract.
- Codex CLI install work is not widened, and `@openai/codex` is not re-added to
  `apps/cloudflare` dependencies.

## Scope

- In scope:
  - `packages/parsers` whisper.cpp/audio-provider behavior if root cause lands
    there.
  - `apps/cloudflare` hosted runner smoke child, fixture, or Docker native
    parser env only if root cause lands there.
  - `Dockerfile.cloudflare-hosted-runner-base` if native image CPU flags or
    runtime library layout are required.
  - Directly coupled tests for the smoke/provider contract.
- Out of scope:
  - Codex CLI Docker install work unless directly required.
  - Full hosted E2E suites.
  - Hosted web, Health Commons, and unrelated active Cloudflare/runtime rows.

## Constraints

- Technical constraints:
  - Preserve the shared parser pipeline exercised by the smoke; avoid replacing
    it with smoke-only provider stubs.
  - Keep native parser command/env behavior deterministic inside the hosted
    runner image.
- Product/process constraints:
  - Preserve unrelated dirty work in the shared checkout.
  - Do not include local usernames, home paths, legal names, secrets, raw
    credentials, or direct personal identifiers in files, logs, docs, or
    handoff.

## Risks and mitigations

1. Risk: The failure is caused by native tool behavior that only appears inside
   Docker.
   Mitigation: Reproduce through the focused Docker smoke and add the smallest
   direct contract test available outside Docker.
2. Risk: Fixing the smoke fixture hides a real production parser failure.
   Mitigation: Exercise the shared `@murphai/parsers` attachment pipeline and
   inspect provider command output before patching.

## Tasks

1. Inspect hosted runner smoke audio fixture and parser provider code.
2. Reproduce the failure with the narrow Docker smoke and, if needed, an
   isolated child/parser command.
3. Patch the root cause in parser behavior, smoke fixture, or native image env.
4. Run focused parser/Cloudflare smoke verification.
5. Run required completion audits, close the plan, and create a scoped commit
   if safe in the dirty checkout.

## Decisions

- Parser diagnostic root cause: `packages/parsers` shared `runCommand` ignored the `signal`
  argument from `child_process.spawn` `close` events and normalized
  `code === null` to `0`, so signal-terminated native parser commands could
  look successful to providers.
- Signal and unknown-exit parser failures report the command basename and
  termination status only. They intentionally do not attach child stdout/stderr,
  because those buffers can contain transcript text or other sensitive payloads.
- Native image root cause: `-DGGML_NATIVE=OFF` alone does not disable x86
  instruction-specific backends in the whisper.cpp v1.8.1 CMake build when the
  build is not cross-compiling. The previous amd64 image could still compile
  AVX/FMA/BMI code that traps as `SIGILL` under local arm64 amd64 emulation.
- Build whisper.cpp with `BUILD_SHARED_LIBS=ON`, `GGML_BACKEND_DL=ON`, and
  `GGML_CPU_ALL_VARIANTS=ON`. The runtime image copies the generated
  `libggml-cpu*.so` modules beside `whisper-cli`, which is where ggml's backend
  loader searches by default. Local emulation loads `libggml-cpu-sse42.so`;
  production amd64 hosts can still load higher-scoring optimized variants.
- The Dockerfile already contained overlapping, pre-existing Codex CLI install
  work from another active row. This lane only changes whisper.cpp build flags
  and backend module layout plus the coupled image contract assertions.

## Verification

- Commands run:
- `pnpm --dir packages/parsers exec vitest run test/parsers.test.ts -t "whisper.cpp provider reports command signals" --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/parsers typecheck`
- `pnpm --dir packages/parsers test:coverage`
- `pnpm --dir apps/cloudflare exec vitest run test/container-image-contract.test.ts -t "pins native and Codex CLI provisioning" --config vitest.node.workspace.ts --no-coverage`
- `pnpm --dir apps/cloudflare runner:docker:base`
- Direct `docker run --platform linux/amd64` transcription against the smoke WAV
  using the rebuilt base image and `whisper-cli` with local speed flags; passed
  and loaded `libggml-cpu-sse42.so`.
- `pnpm --dir apps/cloudflare runner:docker:smoke`
- `pnpm --dir apps/cloudflare test:node`
- `pnpm --dir apps/cloudflare verify`
- `pnpm typecheck`
- `pnpm test:smoke`
- `git diff --check -- Dockerfile.cloudflare-hosted-runner-base apps/cloudflare/test/container-image-contract.test.ts packages/parsers/src/shared.ts packages/parsers/test/parsers.test.ts agent-docs/exec-plans/active/2026-04-28-cloudflare-runner-audio-parser-smoke.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Required audits:
- `security-privacy-review`: found one in-lane issue: signal/unknown-exit
  command failures were appending child output after path-only redaction. Fixed
  by removing stdout/stderr detail from those termination classes and extending
  the parser regression to prove sensitive child output is omitted. The audit
  also flagged the pre-existing global Codex CLI install in the overlapping
  active Codex CLI row; this lane does not stage or commit that install.
- `coverage-write`: no findings; coverage is adequate for parser signal
  handling, portable whisper.cpp CPU backend flags, backend-module copying, and
  Docker smoke truthfulness.
- `task-finish-review`: no code correctness findings; requested
  `pnpm --dir apps/cloudflare verify`, which now passes.
- `security-privacy-review` on `git diff --cached`: no findings in the staged
  task diff.
- Closeout note: used manual scoped staging/commit because the standard finish
  helper would have included overlapping dirty Dockerfile/test hunks from the
  separate active Codex CLI image row.
