# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Conversation onboarding first-experiment prompt | none | `packages/assistant-engine/skills/conversation-onboarding/SKILL.md`; `packages/assistant-engine/test/assistant-skill-assets.test.ts` | `conversation-onboarding` | Active | Narrow prompt/test update; preserve existing adjacent assistant prompt edits. |
| Codex | Hosted-local runner base image resolution | `agent-docs/exec-plans/active/2026-06-05-fix-runner-base-image.md` | `Dockerfile.cloudflare-hosted-runner`; `apps/cloudflare/scripts/runner-base-image-contract.ts`; `apps/cloudflare/scripts/runner-base-image.ts`; `apps/cloudflare/test/container-image-contract.test.ts`; `apps/cloudflare/test/runner-base-image.test.ts`; `apps/cloudflare/test/dev-worker.test.ts`; `apps/cloudflare/DEPLOY.md` | `HOSTED_RUNNER_BASE_IMAGE`; `hostedRunnerBaseImageRemoteTag`; `prepareRunnerBaseImage` | Active | Narrow Cloudflare runner startup fix; preserve unrelated onboarding row. |
| Codex | Junction Oura RHR biomarker fallback | none | `packages/query/src/wearables.ts`; `packages/query/test/wearables-normalized-surfaces.test.ts`; `packages/query/test/browser-vault-metric-points-labs-measurements.test.ts` | `listWearableRecoveryDaysFromDataset`; `buildWearableMetricEvidenceFromBundle`; `restingHeartRate` | Active | Narrow query-layer fallback; avoid active `apps/web` biomarker status UI files. |
| Codex | Hosted Junction wearable direct-resource replay PR failure | none | `apps/cloudflare/test/hosted-local-device-sync-junction-wearable-direct-resource-replay-e2e.test.ts`; `apps/cloudflare/test/helpers/hosted-local-full-stack-scenario.ts`; `packages/vault-usecases/src/testing/junction-wearable-fixture.ts`; `packages/device-syncd/test/junction-provider.test.ts` | `runWake`; `seedActiveHostedMember`; `hosted-local device-sync-junction-wearable-direct-resource-replay` | Active | Narrow PR fix for hosted-local E2E wake/setup failure; preserve unrelated ledger rows. |
| Codex | CLI UX fixes plan | `agent-docs/exec-plans/active/2026-06-06-cli-ux-fixes.md` | `agent-docs/exec-plans/active/2026-06-06-cli-ux-fixes.md` | assistant-facing CLI UX audit plan | Active | Planning-only PR; excludes compact discovery-manifest fix by user request. |
