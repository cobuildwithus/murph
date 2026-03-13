# Coordination Ledger

Active coding work must claim ownership here before code changes begin.

| Agent | Scope | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| codex-zod-cutover | Hard-cut the contracts stack over to Zod as the only authoring surface, preserve generated JSON Schema artifacts, migrate core consumers, and integrate docs/tests/verification. | `agent-docs/exec-plans/active/2026-03-13-zod-contracts-cutover.md`, `packages/contracts/**`, `packages/core/src/mutations.ts`, `packages/core/src/vault.ts`, `packages/core/src/family/api.ts`, `packages/core/src/genetics/api.ts`, `packages/core/src/family/types.ts`, `packages/core/src/genetics/types.ts`, `packages/core/test/**`, `ARCHITECTURE.md`, `docs/contracts/02-record-schemas.md`, `docs/safe-extension-guide.md`, `packages/contracts/README.md`, `agent-docs/references/testing-ci-map.md`, `agent-docs/operations/verification-and-runtime.md` | contracts schemas/types/validate exports; generated schema pipeline; core contract parsing; contract limits helpers | in_progress | Do not touch `packages/cli/**`, `package.json`, or `scripts/review-gpt.config.sh`. Generated JSON Schema filenames and export subpaths must remain stable unless explicitly documented in this lane. |
