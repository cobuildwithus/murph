Goal (incl. success criteria):
- Log hosted audio transcription (Worker-mediated Workers AI `@cf/openai/whisper-large-v3-turbo`) into the `hosted_ai_usage` ledger so transcription COGS stops being invisible.
- Success means: every successful hosted transcribe `ai.run` produces one `hosted_ai_usage` row attributed to the member with audio `durationMs` in `rawUsageJson`; allowance accounting prices the row at the Workers AI rate ($0.00051/audio-minute = 510 USD micros/min, prorated); recording is fire-and-forget and can never fail or slow the transcription response; regression tests cover record emission and duration pricing.

Constraints/Assumptions:
- Workers AI runs on the platform Cloudflare account → `credentialSource: "platform"` → allowance accounting marks the row counted, so the model MUST be priced or `priceHostedAiUsageForAllowance` throws and the record route 500s.
- Do NOT add whisper to `HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS` / `HOSTED_AI_USAGE_ALLOWANCE_ACCEPTED_MODEL_IDS` (deploy-preflight validates `HOSTED_ASSISTANT_MODEL` against that list); audio pricing stays local to `usage-allowance.ts`.
- Transcription happens outside any assistant turn (parse job → egress intercept), so use a synthetic turn id, mirroring `buildAssistantMaintenanceUsageRecord` (`turn_maintenance_*` precedent).
- The worker egress choke point (`maybeHandleHostedTranscribeRequest`) has everything needed: AI output `durationMs`, `authorization.userId` (= hosted member id), `ctx.waitUntil`, and web-control-plane reach (`readHostedExecutionEnvironment` + `fetchHostedExecutionWebControlPlaneResponse`); `HOSTED_RUNTIME_USAGE_RECORD_PATH` is already an allowed web-control operation (`usage_recording`).
- Tokens are all null for transcription rows; cost basis is `rawUsageJson.durationMs` (missing duration → 0-cost row with snapshot flag, never a throw).

Key decisions:
- Record at the worker egress intercept (single choke point for all hosted transcriptions), not in the parsers package or container runtime — no new plumbing, covers future call sites.
- Add `buildHostedTranscriptionUsageRecord` next to `buildAssistantMaintenanceUsageRecord` in `packages/hosted-execution/src/assistant-usage.ts` so record-schema knowledge stays in one place.
- Duration-based pricing branch in `priceHostedAiUsageForAllowance` keyed off the whisper model id; rate constant documented against the Cloudflare model page.

State:
- Complete in worktree `murph-transcribe-usage` (branch `transcription-usage-records`); all audits resolved; verification green.

Done:
- Audit complete: confirmed no usage row exists anywhere for `workers_ai_transcribe` (egress handler only emits a structured log); confirmed price $0.00051/audio-minute from Cloudflare docs; confirmed allowance/ledger ingest semantics and web-control policy allowlist.
- `buildHostedTranscriptionUsageRecord` + audio raw-usage keys (`audioBytes`, `durationMs`, non-negative-integer rule) in `assistant-usage.ts`.
- Fire-and-forget usage POST from `maybeHandleHostedTranscribeRequest` via `fetchHostedExecutionWebControlPlaneResponse` + `ctx.waitUntil`; failures warn-log only.
- Duration-priced audio branch in `priceHostedAiUsageForAllowance` (510 usd-micros/audio-minute, ceil proration; missing duration → 0-cost counted row).
- Tests: egress recording emission + failure isolation + duration-less recording (145 pass), builder round-trip (14 pass), audio pricing (33 pass). Touched-package typechecks green.

- `pnpm test:diff` over touched paths: green (twice — before and after review-driven fixes).
- Audits (Codex gpt-5.5 lane was rate-limited; security/coverage passes ran on the parent model per the documented fallback):
  - security-privacy-review: no medium+ findings; two below-medium observations assessed and accepted as residual (self-scoped usage reporting was already trusted-not-enforced).
  - coverage-write: added rawUsageJson rejection proofs, no-recording-on-failure proofs, and a tx-level allowance accounting proof using the real builder.
  - deep-review: F1 HIGH accepted+fixed (production ctx lacks waitUntil → recording now awaited as fallback, mirroring the in-file OpenAI cache diagnostic precedent; prod-shaped ctx test added); F2 LOW accepted+fixed (audio pricing branch gated on provider "workers-ai", exact model id only, modelSource label corrected); F3 INFO confirmed deploy-skew rollback safety.

Now:
- finish-task commit, PR.

Next:
- Post-CI `review:gpt pr-review` loop; deploy web before cloudflare (rows are warn-log dropped, transcription unaffected, until web prices audio rows).

Open questions (UNCONFIRMED if needed):
- None blocking. Recording silently drops rows if web deploys after cloudflare (fire-and-forget warn); acceptable for a metering fix, noted in deployment concerns.

Working set (files/ids/commands):
- `packages/hosted-execution/src/assistant-usage.ts`
- `apps/cloudflare/src/runner-egress-intercept.ts`
- `apps/web/src/lib/hosted-execution/usage-allowance.ts`
- `apps/cloudflare/test/runner-egress-intercept.test.ts`
- `apps/web/test/hosted-execution-usage-allowance.test.ts`
- `packages/hosted-execution/test/*assistant-usage*`
Status: completed
Updated: 2026-06-12
Completed: 2026-06-12
