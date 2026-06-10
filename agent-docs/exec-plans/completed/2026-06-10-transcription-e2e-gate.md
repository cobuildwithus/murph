# Hosted transcription E2E + CI gate

## Goal

Prove the Workers AI transcription path (PR #105) end to end in hosted-local
E2E and gate it in CI. After this change the audio E2E exercises the exact
production chain — container parser drain -> `remote-transcription` provider ->
`murph-transcribe.worker/v1/transcribe` egress handler -> `AI` binding ->
transcript evidence in the assistant prompt — instead of the legacy in-bundle
whisper-cli stub.

Success criteria:
- `pnpm hosted-local e2e linq-webhook` passes with the audio test going
  through the real transcribe handler and a deterministic fake `AI` binding.
- A new required CI job in `.github/workflows/cloudflare-hosted-e2e.yml` runs
  that scenario on every PR/main push (it has no CI gate today; the
  `linq-delivery` job is an alias of `linq-first-contact`).
- The whisper-cli/ggml stub lane is deleted (bundle stubs, e2e env vars,
  allowlist entries); the ffmpeg stub stays (fixture audio bytes are fake).

## Constraints / Key decisions

- No test-only branches in production source: the deterministic fake `AI`
  binding is injected in `apps/cloudflare/src/hosted-local-test/runner-container.ts`
  (the hosted-local test entrypoint composition) by wrapping
  `HOSTED_RUNNER_OUTBOUND_BY_HOST` handler env when `env.AI` is absent. The
  hosted-local generated wrangler config has no `ai` binding, so workerd-side
  `env.AI` is always undefined in e2e.
- The e2e toolchain branch in `runner-native-parser-toolchain.ts` switches its
  whisper stub entries to `transcription: { endpoint: CLOUDFLARE_HOSTED_TRANSCRIBE_ENDPOINT }`
  — the production constant — so the e2e proves the production endpoint and
  handler routing, not a test-only URL.
- Fake AI output keeps the canned transcript "Remember to log the voice note"
  in Workers AI shape (`text`, `transcription_info`, `segments`) so existing
  audio assertions stay meaningful and the handler's mapping is exercised.
- Append-only edits to `packages/hosted-local-harness/src/e2e.ts` and
  `.github/workflows/cloudflare-hosted-e2e.yml` (blocked media-E2E ledger lane
  overlaps those files).
- Known accepted gap: manual hosted-local dev (non-test entrypoint) has no
  `AI` binding, so dev-mode voice memos 500 at the transcribe handler unless a
  real binding is configured; e2e and production are both covered.

## Files

- `apps/cloudflare/src/runner-native-parser-toolchain.ts` (+ test): e2e branch
  whisper -> transcription endpoint
- `apps/cloudflare/src/hosted-local-test/runner-container.ts`: fake `AI` env wrap
- `apps/cloudflare/scripts/assemble-runner-bundle.ts`: drop whisper-cli +
  ggml-test.bin stubs (keep ffmpeg stub)
- `apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts`: drop WHISPER_*
  env from scenario start
- `packages/hosted-local-harness/src/dev-hosted-local/constants.ts` (+ tests):
  drop WHISPER_* from WRANGLER_VAR_ALLOWLIST
- apps/cloudflare env/runner tests referencing the whisper stub env
- `.github/workflows/cloudflare-hosted-e2e.yml`: new `linq-webhook` job
- Docs: `agent-docs/references/testing-ci-map.md`,
  `agent-docs/operations/verification-and-runtime.md`

## Verification

- Focused vitest: runner-native-parser-toolchain, egress intercept (no change
  expected), harness environment tests; typechecks for apps/cloudflare +
  hosted-local-harness.
- `pnpm hosted-local e2e linq-webhook` locally (Docker) as direct scenario
  proof.
- Completion audits per standard repo change class.

## State

Implementation complete; local `pnpm hosted-local e2e linq-webhook` proof run
in progress.

Done:
- E2E toolchain branch now emits `transcription: { endpoint: CLOUDFLARE_HOSTED_TRANSCRIBE_ENDPOINT }`
  (production constant) instead of the whisper stub; exact-shape recognizer
  updated and rejects any whisper entry.
- Deterministic fake `AI` binding injected in
  `apps/cloudflare/src/hosted-local-test/runner-container.ts` by wrapping the
  outbound-by-host handlers (test entrypoint composition only; returns the
  canned "Remember to log the voice note" transcript in Workers AI shape and
  requires base64 audio input).
- whisper-cli/ggml-test.bin bundle stubs deleted (ffmpeg stub kept); WHISPER_*
  dropped from the harness WRANGLER_VAR_ALLOWLIST and the linq-webhook e2e env.
- New `linq-webhook-media` CI job added to
  `.github/workflows/cloudflare-hosted-e2e.yml` (the audio scenario previously
  had no CI gate; `linq-delivery` is an alias of `linq-first-contact`), plus
  `MURPH_RUNNER_BUNDLE_TEST_PARSER_TOOLCHAIN=1` on the shared bundle job so the
  ffmpeg stub ships in the shared artifact.
- Docs: testing-ci-map + verification-and-runtime e2e job lists updated.

Found while proving locally: the `linq-webhook` scenario helper still set
`MURPH_DEV_TEMPORAL: "disabled"` from before the Temporal hard-cut, so every
networked test in the scenario failed with "Hosted runtime Temporal client is
not configured" on main (pre-existing; this is why it had no CI gate). Control
run `pnpm hosted-local e2e linq-delivery` passed locally, isolating the
breakage to the scenario env. Fix: drop the disable and set
`MURPH_HOSTED_LOCAL_TEST_ROUTES: "1"` (matching the green media scenarios),
which also selects the hosted-local test worker entrypoint that provides the
fake `AI` binding.

Final verification (all green):
- Direct scenario proof: local `pnpm hosted-local e2e linq-webhook` — all 6
  tests passed end to end (signed webhook -> Temporal wake -> container parser
  drain -> remote-transcription provider -> murph-transcribe.worker handler ->
  fake AI binding -> transcript in the assistant prompt -> reply delivered);
  `pnpm hosted-local e2e linq-delivery` control passed (8).
- apps/cloudflare typecheck + full node lane (82 files / 1303 tests after the
  coverage-write additions); hosted-local-harness typecheck + full suite
  (258); packages/cli workflow guard (2).

Completion audits resolved:
- coverage-write added: hosted-local-test outbound wrapper unit tests,
  container-image-contract ffmpeg-stub/bundle-gate pin, harness WHISPER_*
  negative allowlist pin, workflow-guard assertions for the new CI job and
  shared-bundle flag.
- task-finish-review: no high findings; accepted fixes applied — the fake-AI
  wrap is now scoped to the transcribe host only, a source-guard test pins
  that the production entry graph never imports hosted-local-test (the
  containers library keys outboundByHost by class name), and
  `agent-docs/index.md` rows were bumped. Residual: the CI job's first
  GitHub-hosted run validates the shared-bundle flag interplay; manual
  hosted-local dev still has no AI binding (documented accepted gap).
- simplify and security-privacy-review skipped with reviewer concurrence
  (mechanical test/CI diff; no auth/secret/trust-boundary change).
Status: completed
Updated: 2026-06-10
Completed: 2026-06-10
