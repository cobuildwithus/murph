# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Conversation onboarding first-experiment prompt | none | `packages/assistant-engine/skills/conversation-onboarding/SKILL.md`; `packages/assistant-engine/test/assistant-skill-assets.test.ts` | `conversation-onboarding` | Active | Narrow prompt/test update; preserve existing adjacent assistant prompt edits. |
| Codex | Hosted-local runner base image resolution | `agent-docs/exec-plans/active/2026-06-05-fix-runner-base-image.md` | `Dockerfile.cloudflare-hosted-runner`; `apps/cloudflare/scripts/runner-base-image-contract.ts`; `apps/cloudflare/scripts/runner-base-image.ts`; `apps/cloudflare/test/container-image-contract.test.ts`; `apps/cloudflare/test/runner-base-image.test.ts`; `apps/cloudflare/test/dev-worker.test.ts`; `apps/cloudflare/DEPLOY.md` | `HOSTED_RUNNER_BASE_IMAGE`; `hostedRunnerBaseImageRemoteTag`; `prepareRunnerBaseImage` | Active | Narrow Cloudflare runner startup fix; preserve unrelated onboarding row. |
| Codex | Junction Oura RHR biomarker fallback | none | `packages/query/src/wearables.ts`; `packages/query/test/wearables-normalized-surfaces.test.ts`; `packages/query/test/browser-vault-metric-points-labs-measurements.test.ts` | `listWearableRecoveryDaysFromDataset`; `buildWearableMetricEvidenceFromBundle`; `restingHeartRate` | Active | Narrow query-layer fallback; avoid active `apps/web` biomarker status UI files. |
