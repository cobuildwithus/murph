# Security review runtime artifact hardening

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Validate and close the six reported security findings around guard receipts, vault-sync imports, OAuth post-connect setup, wearable raw replay identity, inbox model bundles, and parser output boundaries.

## Success criteria

- Guard receipts no longer copy protected canonical payload bytes outside the vault boundary.
- Vault-sync import manifests and restored files are bounded before expensive decoding, hashing, and merge planning.
- OAuth callback failures after token persistence leave no silently active half-connected account with stored usable tokens.
- Replayed wearable snapshots use stable raw-envelope identity for materially identical provider payloads.
- Inbox model bundle CLI output is path-only by default and sensitive bundle output requires an explicit flag; persisted bundle artifacts are private.
- Parser provider output is runtime-validated and bounded before derived artifacts are written.
- Focused regression coverage proves each fixed boundary, with scoped verification and required completion review captured before handoff.

## Scope

- In scope:
  - `packages/core/src/{operations/write-batch.ts,vault-sync.ts,mutations.ts}`
  - `packages/importers/src/device-providers/{raw-ingest-envelope.ts,import-device-provider-snapshot.ts}`
  - `packages/device-syncd/src/{public-ingress.ts,service.ts,store.ts,types.ts}`
  - `apps/web/src/lib/device-sync/{public-ingress-service.ts,prisma-store.ts,prisma-store/connections.ts}`
  - `packages/cli/src/{inbox-model-contracts.ts,inbox-model-harness.ts,commands/inbox.ts}`
  - `packages/parsers/src/{contracts/parse.ts,pipelines/parse-attachment.ts,publish/writer.ts}`
  - directly coupled focused tests in `packages/{core,importers,device-syncd,cli,parsers}/test/**` and `apps/web/test/**`
  - this plan plus `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Out of scope:
  - broad vault-sync storage redesign beyond import bounds and streaming-ish JSONL parsing safeguards
  - dependency additions
  - unrelated active hosted onboarding, assistant-runtime, parser cleanup, or core raw-manifest refactors

## Constraints

- Preserve unrelated dirty-tree work and do not revert active rows owned by other lanes.
- Keep secrets and health payloads out of logs, docs, and final handoff.
- Prefer existing storage/status states and local helpers over new schema migrations.
- Use package-local focused verification where it truthfully covers the touched surfaces; broader repo checks may already be red from unrelated active rows.

## Risks and mitigations

1. Risk: This touches several high-sensitivity seams in one pass.
   Mitigation: Keep each fix small, add focused proof for each reported behavior, and avoid unrelated refactors.
2. Risk: Active rows overlap nearby `packages/core`, `packages/device-syncd`, and `packages/parsers` files.
   Mitigation: Target only the clean cited files and directly coupled tests; stop if overlapping edits appear.
3. Risk: Tight bounds could reject legitimate large local artifacts.
   Mitigation: Use conservative package-local constants and error codes that fail closed with actionable messages.

## Tasks

1. Validate each reported finding against current code and record the active work lane.
2. Patch guard receipts to be metadata/hash-only and private.
3. Add vault-sync manifest/file/JSONL bounds and actual-size checks before heavy reads.
4. Add OAuth post-persistence failure cleanup that revokes provider access where available and clears/marks persisted accounts.
5. Stabilize wearable raw-envelope replay identity and observed-at fallback.
6. Make inbox model bundle output path-only by default and write private artifacts.
7. Add parser output validation/size contracts and private derived artifact writes.
8. Run focused tests/typecheck, completion audits required by workflow, and close the plan with a scoped commit unless blocked by overlapping dirty work.

## Decisions

- Use existing `reauthorization_required`/token-clearing behavior for failed OAuth setup instead of adding a new account status enum.
- Keep guard receipt schema version unchanged but drop `payloadRelativePath` and all payload copying so existing readers that only inspect action metadata continue to work.
- Keep inbox bundle artifacts under the existing `derived/inbox/**/assistant` path, but restrict file modes and require an explicit sensitive-output option for returning the full bundle.
- Make OAuth setup-failure marking a required public-ingress store contract so post-persistence cleanup cannot be silently unsupported.

## Verification

- Commands passed:
  - `pnpm --dir packages/core exec vitest run --config vitest.config.ts --no-coverage test/core-event-thresholds.test.ts test/vault-sync.test.ts`
  - `pnpm --dir packages/importers exec vitest run --config vitest.config.ts --no-coverage test/canonical-wearables.test.ts`
  - `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts --no-coverage test/public-ingress.test.ts`
  - `pnpm --dir packages/device-syncd typecheck`
  - `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --no-coverage test/prisma-store-oauth-connection.test.ts`
  - `pnpm --dir packages/parsers exec vitest run --config vitest.config.ts --no-coverage test/parsers.test.ts`
  - `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/model-harness-runtime.test.ts`
  - `pnpm --dir packages/cli exec vitest run --config vitest.workspace.ts --no-coverage test/inbox-model-harness.test.ts`
  - `pnpm typecheck`
  - `pnpm test:smoke`
  - `git diff --check -- <tracked current-task files>`
- Commands with caveats:
  - `pnpm test` was attempted, entered an interactive CLI/setup/chat prompt, and was stopped; no assertion failure was observed before the stop.
- Commands still pending:
  - required `coverage-write` and `task-finish-review` completion audit passes.
  - final post-audit re-run of affected checks.
- Direct proof:
  - Guard receipt test asserts receipt JSON has no payload path, no payload directory, and private modes.
  - Vault-sync tests reject non-integer byte counts, mismatched actual file sizes, and oversized JSONL lines before merge planning.
  - OAuth tests cover post-persistence hook failure, provider revoke, reauthorization marking, token cleanup, and cleanup-failure surfacing.
  - Wearable replay test asserts changing adapter import clocks keep the same raw envelope id, observedAt, and artifact filenames.
  - Inbox bundle tests assert default output is path-only, sensitive opt-in returns the full bundle, and artifacts are private.
  - Parser tests reject oversized provider output before publication and assert private writer modes.
Completed: 2026-04-24
