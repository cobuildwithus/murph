# Workers AI hosted transcription + whisper.cpp image removal

## Goal

Replace the hosted runner's in-container whisper.cpp transcription with a
Worker-mediated Cloudflare Workers AI `@cf/openai/whisper-large-v3-turbo` call,
and remove the whisper.cpp binary plus ggml-base model from the hosted runner
image.

Success criteria:

- A 30s hosted voice memo transcribes in seconds, not tens of seconds. The
  repo's own constrained benchmark measured `parseAttachmentMs: 571786` for a
  65s clip at the deployed 1 vCPU / 3 GiB resource class
  (`agent-docs/exec-plans/completed/2026-06-01-runner-audio-benchmark.md`),
  so the current in-image path is the proven latency bottleneck.
- Audio bytes never leave Cloudflare: container -> Worker outbound intercept ->
  `env.AI.run(...)`. No new third-party vendor, no new credentials in the
  runtime env.
- The local lane keeps its local-first posture: whisper.cpp stays a supported
  local parser provider via the existing toolchain config/env/system discovery;
  only the hosted image stops shipping it.
- Hosted runner image no longer contains the whisper-cli binary, ggml libs, or
  the ~142 MB model layer, and the base image build no longer compiles
  whisper.cpp.

## Constraints / Assumptions

- Follow the existing Worker-mediated provider egress pattern
  (`apps/cloudflare/src/runner-egress-intercept.ts`); the closest template is
  `maybeHandleHostedDataApiRequest` (fixed virtual host, active-user-fence
  authorization without exact headers, bounded body).
- `packages/parsers` stays platform-neutral: the new provider is a plain HTTP
  client against a Murph-shaped transcription endpoint; it carries no hosted
  auth, no Workers AI types, and activates only when an endpoint is configured.
- No test-only branches in production source. Hosted-local E2E stubs the
  transcription endpoint from the harness side instead of stubbing whisper-cli
  binaries inside the image.
- Transcript text must never appear in persisted/structured logs (logs:guard
  posture); log counts/durations/status only.
- Networked provider calls set explicit timeouts and propagate the parse
  job abort signal (`agent-docs/RELIABILITY.md`).
- Preserve unrelated dirty work; avoid `apps/cloudflare/src/runner-container.ts`
  (active destroy-timeout lane) and keep `DEPLOY.md` / hosted-local-harness
  touches minimal (other active lanes).
- Deletion-first: the opt-in runner audio benchmark lane measured the in-image
  whisper path and is deleted with it rather than ported.

## Key decisions

- New parser tool name `transcription` with an `endpoint` field rides the
  existing typed toolchain plumbing end to end: `ParserToolchainTools`
  (`packages/parsers/src/toolchain/config.ts`) ->
  `HostedAssistantRuntimeParserToolchainConfig`
  (`packages/assistant-runtime/src/hosted-runtime/parsers.ts`) ->
  `createHostedRunnerNativeParserToolchain`
  (`apps/cloudflare/src/runner-native-parser-toolchain.ts`). No new config
  channel, no env-var selector (hosted per-user env must not steer parser
  execution per `agent-docs/SECURITY.md`).
- New `ParserProvider` `remote-transcription` (locality `remote`, openness
  `open_weights`, runtime `remote_api`) POSTs the ffmpeg-prepared 16 kHz mono
  WAV from `parseAttachment` to the configured endpoint and maps the JSON
  response (`text`, optional `language`/`segments`) into `ProviderRunResult`
  blocks. Existing ranking policy keeps local whisper.cpp ahead of it whenever
  whisper is actually installed, so local-first ordering needs no policy edit;
  in the hosted image (whisper removed) the remote provider is simply the only
  available audio provider.
- New fixed virtual host `murph-transcribe.worker` handled in the runner
  outbound intercept: validate method/path, bounded body, authorize via
  active-user-fence (same posture as the hosted data API), base64 the audio,
  call `env.AI.run("@cf/openai/whisper-large-v3-turbo", ...)` with the new
  `ai` Worker binding, return Murph-shaped JSON. Workers AI credentials and
  account context never enter the runtime env.
- ffmpeg stays in the image: it still prepares/normalizes audio (and extracts
  audio from video) before upload, and other parse paths use it.
- Keep the `whisper-cpp.ts` adapter and the local `whisper` toolchain name;
  delete only image layers, the in-image default toolchain entries, the
  whisper-model Dockerfile, and the benchmark lane.

## Files (planned)

- `packages/parsers/src/adapters/remote-transcription.ts` (new) + focused test
- `packages/parsers/src/toolchain/config.ts`, `toolchain/discover.ts`,
  `src/index.ts`, contracts as needed; existing toolchain tests
- `packages/assistant-runtime/src/hosted-runtime/models.ts`, `parsers.ts`
  (+ tests): `transcription.endpoint` (absolute http(s) URL) in the hosted
  parser toolchain contract
- `apps/cloudflare/src/runner-egress-intercept.ts` (+ test): transcribe host
  handler; `apps/cloudflare/src/runner-native-parser-toolchain.ts` (+ test):
  drop whisper defaults, add transcription endpoint
- `apps/cloudflare/wrangler.jsonc`: `ai` binding; Worker env type
- `Dockerfile.cloudflare-hosted-runner-base`: remove whisper stages/layers;
  delete `Dockerfile.cloudflare-whisper-model`; base image tag/refs per
  inventory
- Delete `apps/cloudflare/src/hosted-runner-audio-benchmark*.ts`,
  `apps/cloudflare/scripts/runner-audio-benchmark.ts`, related tests and
  `runner:docker:audio-benchmark*` package scripts
- Image/CI removal: `Dockerfile.cloudflare-hosted-runner-base` whisper stages,
  delete `Dockerfile.cloudflare-whisper-model`,
  `.github/workflows/cloudflare-runner-base-image.yml` model-image build steps,
  `.github/workflows/deploy-cloudflare-hosted.yml` base tag string +
  `vars.WHISPER_MODEL_PATH`/`vars.WHISPER_COMMAND` deploy env,
  `apps/cloudflare/scripts/runner-base-image.ts` whisper-model image
  read/assert helpers, `apps/cloudflare/test/container-image-contract.test.ts`
  whisper sections
- Hosted-local E2E: replace the in-image whisper-cli/model stub envs with a
  harness-served transcription endpoint (loopback provider-base pattern):
  `apps/cloudflare/src/runner-native-parser-toolchain.ts` e2e branch,
  `apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts`,
  `packages/hosted-local-harness/src/dev-hosted-local/constants.ts`
  WRANGLER_VAR_ALLOWLIST entries
- `packages/assistant-runtime/src/hosted-runtime/environment.ts`: add
  `transcription` to hosted parser tool names; KEEP the WHISPER_* env
  denylist/selector hardening (whisper remains a local-lane tool and the
  denylist is defense in depth)
- Docs in the same change: `ARCHITECTURE.md` (parsers line, cloudflare egress
  list), `agent-docs/SECURITY.md` (Worker-owned Workers AI transcription
  boundary), `apps/cloudflare/README.md`, `apps/cloudflare/DEPLOY.md`
  (binding + image note), `agent-docs/references/testing-ci-map.md`
  (benchmark removal, new tests)

## Verification

- Focused vitest: parsers toolchain/provider tests, assistant-runtime parser
  contract tests, cloudflare egress-intercept + native-toolchain tests.
- `pnpm typecheck` scoped to touched packages (`packages/parsers`,
  `packages/assistant-runtime`, `apps/cloudflare`).
- Hosted-local audio E2E lane against the harness transcription stub if
  runnable without disturbing active containers.
- Completion audits per standard repo change class (security-privacy-review
  required: external egress/trust boundary), then `scripts/finish-task`.

## Open questions (UNCONFIRMED if needed)

- Exact Workers AI response field set for whisper-large-v3-turbo (`text`,
  `segments`, `vtt`, `transcription_info`); handler maps defensively and the
  provider requires only `text`.
- Base image tag derivation in CI (resolved by inventory).

## State

Implementation complete in worktree `murph-workers-ai-transcription`.

Done:
- `remote-transcription` ParserProvider + `transcription.endpoint` toolchain
  field through parsers -> assistant-runtime -> cloudflare native toolchain.
- `murph-transcribe.worker/v1/transcribe` outbound handler calling the Workers
  AI binding with active-user-fence authorization; `ai` binding added to the
  scaffold and generated deploy wrangler configs.
- whisper.cpp stages/model removed from the base image; whisper-model
  Dockerfile, GHCR model publish steps, audio benchmark lane, and deploy-time
  WHISPER_* vars deleted; base tag now `node24.14.1-codex0.135.0`.
- Runner smoke replaced whisper transcription proofs with ffmpeg
  normalization + production `prepareAudioInput` proofs.
- Hosted-local E2E whisper stub lane intentionally unchanged (stubs are
  bundle-local fake binaries, not the real model).
- Docs updated: ARCHITECTURE, SECURITY, DEPLOY, READMEs, testing-ci-map,
  verification-and-runtime.

Verification run:
- packages/parsers: typecheck + full vitest (incl. new adapter + registry
  wiring tests) green.
- packages/assistant-runtime: typecheck + full vitest (814 passed) green.
- apps/cloudflare: typecheck green; full node lane green after deploy
  workflow assertion update; workers lane green.
- packages/setup-cli, packages/inbox-services, packages/cli typechecks green.

Completion audits run and resolved:
- simplify: accepted 6 findings (factory-throw endpoint validation, alias
  removal, dead language plumbing deleted on both sides, smoke passthrough
  inlined); rejected intra-package validator dedup (keeps existing symmetry)
  and bounded-response rename (response comes from our Worker).
- security-privacy-review: no medium+ findings; added the SECURITY.md note
  about keeping account-level Workers AI / AI Gateway logging disabled.
- coverage-write: found a real production bug — `launch-spec.ts`
  `readHostedRuntimeLaunchParserToolchain` silently dropped `endpoint`, so the
  hosted registry would never get the remote provider. Fixed with an endpoint
  copy + http(s) validation branch; the red proof test now passes. Also added
  endpoint round-trip/validation coverage and write-side endpoint validation
  in the parsers config merge.
- deep-review: rejected the rollout-skew finding (toolchain is bound
  container-side from the container's own bundle, so old containers keep the
  old whisper toolchain and binary); accepted one bounded replay-safe retry in
  the provider and lowered both transcription size caps 32 -> 16 MiB for
  Worker memory headroom; new-container->old-worker rollback fails closed
  (NXDOMAIN before any bytes leave).

- task-finish-review: clean; two low findings fixed (generated deploy config
  now asserts the `ai` binding; stale model-image phrase removed from
  testing-ci-map).

All required checks green at handoff. Remaining deploy-time checks: first
live Workers AI call shape, account-level Workers AI / AI Gateway logging
disabled, protected-main base-image publish for the new
`node24.14.1-codex0.135.0` tag.
Status: completed
Updated: 2026-06-10
Completed: 2026-06-10
