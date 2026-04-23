# Harden hosted sync and device-sync trust boundaries

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Fail closed on hosted vault-sync imports and related device-sync control-plane seams so malformed or version-incompatible input cannot corrupt canonical hosted vault state, leak the active agent bearer, or persist impossible sync timelines.

## Success criteria

- Hosted vault-sync import staging validates imported record/file content before write and rejects merged vault states that fail canonical validation.
- Hosted vault-sync wake payloads carry `sourceSchemaVersion` end to end and reject unsupported versions before restore/merge.
- Device-sync export/refresh token-bundle responses stop echoing the current agent bearer in normal JSON responses while preserving retry-safe behavior.
- Local-heartbeat writes cannot move `lastSyncStartedAt` forward while leaving stale completion or error timestamps behind.
- Verification covers the touched owners truthfully, includes at least one direct scenario check for the trust-boundary changes, and the required repo completion audits run before handoff.
- The final scoped commit contains only this task's changes plus plan/ledger closeout.

## Scope

- In scope:
  - `packages/core` vault-sync import validation and merge gating
  - hosted vault-sync `sourceSchemaVersion` propagation/enforcement in `apps/web`, `packages/hosted-execution`, and `packages/assistant-runtime`
  - hosted device-sync agent token-bundle response shaping in `apps/web`
  - hosted device-sync local-heartbeat invariant enforcement in `apps/web`
  - directly coupled tests and plan/ledger bookkeeping
- Out of scope:
  - broader hosted-runtime run/execution refactors outside the direct vault-sync wake seam
  - unrelated active hosted/web/assistant work already in the tree
  - dependency changes, API redesign outside these narrow routes, or speculative schema migration machinery

## Constraints

- Technical constraints:
  - Preserve unrelated working-tree edits and active rows in overlapping hosted-runtime/web areas.
  - Keep write ownership aligned with existing package boundaries and public entrypoints.
  - Redact or avoid local account identifiers, home-directory paths, and secrets in repo files, commits, and handoff.
- Product/process constraints:
  - This is a high-risk repo change and needs plan + ledger registration, truthful verification, required completion audits, and a scoped `scripts/finish-task` commit path.
  - User explicitly requested `gpt-5.4` high-reasoning subagents for the implementation work; required repo audit passes still follow repo workflow model requirements.

## Risks and mitigations

1. Risk: imported canonical file families may need multiple validation paths, and a partial fix could still allow invalid hosted state through a less obvious lane.
   Mitigation: read the existing core validation helpers, add focused tests for each import family touched by the findings, and revalidate the merged vault before commit.
2. Risk: schema-version enforcement may drift between web payload creation, hosted-execution contracts, and assistant-runtime wake handling.
   Mitigation: trace the payload builder/parser path end to end and add tests at the payload/service and hosted-runtime event boundaries.
3. Risk: removing echoed bearer tokens could break retry-safe agent flows that implicitly relied on response bodies.
   Mitigation: keep retry matching keyed to the authenticated request bearer and verify export/refresh retry scenarios explicitly.
4. Risk: heartbeat timeline hardening could reject legitimate incremental patches or leave the persistence layer out of sync with the runtime update helper.
   Mitigation: keep the invariant in the shared helper used before persistence and cover forward-start plus stale completion/error scenarios in both unit and store-level tests.

## Tasks

1. Register the plan and coordination-ledger row.
2. Inspect the four reported seams and map the minimal file/test ownership needed for each fix.
3. Delegate the issue-specific implementation work to `gpt-5.4` high-reasoning workers with disjoint ownership.
4. Review each worker patch, integrate or refine locally, and ensure the combined behavior still fits existing package boundaries.
5. Run truthful scoped verification plus direct scenario checks for the trust-boundary changes.
6. Run required completion audits, fix findings, rerun affected checks, and finish through the scoped plan-bearing commit flow.

## Decisions

- Vault-sync import validation now fails closed at three seams inside `packages/core`: strict manifest parsing/kind re-derivation and duplicate-path rejection, per-file canonical contract validation before planning/conflict staging, and merged-vault preview validation before the real canonical write.
- Source schema version is emitted as `VAULT_SCHEMA_VERSION` for current vault packs and enforced end to end through the app payload, hosted-execution contracts/parsers, and assistant-runtime wake handling.
- Device-sync export/refresh routes now return only connection/token bundle metadata; the current agent bearer is rechecked server-side but never echoed in normal JSON responses.
- Local-heartbeat normalization stays in the shared helper used before persistence and now clears stale completion/error state when `lastSyncStartedAt` advances, including equal terminal timestamps and legacy rows with stale error details but no error timestamp.

## Verification

- Ran and passed:
  - `pnpm --dir packages/core test:coverage -- test/vault-sync.test.ts`
  - `pnpm --dir packages/hosted-execution test:coverage -- test/hosted-execution.test.ts`
  - `pnpm --dir packages/assistant-runtime test -- test/hosted-runtime-vault-sync-event.test.ts`
  - `pnpm --dir apps/web verify`
  - `pnpm test:smoke`
  - `git diff --check -- packages/core/src/vault-sync.ts packages/core/src/vault.ts packages/core/test/vault-sync.test.ts packages/core/test/high-value-seam-regressions.test.ts apps/web/src/lib/device-sync/local-heartbeat.ts apps/web/test/device-sync/local-heartbeat.test.ts apps/web/test/prisma-store-local-heartbeat.test.ts apps/web/src/lib/vault-sync/session-service.ts apps/web/src/lib/vault-sync/shared.ts apps/web/test/vault-sync-payload-route.test.ts apps/web/test/vault-sync-session-service.test.ts packages/hosted-execution/src/builders.ts packages/hosted-execution/src/contracts.ts packages/hosted-execution/src/parsers.ts packages/hosted-execution/test/hosted-execution.test.ts packages/assistant-runtime/src/hosted-runtime/events/vault-sync.ts packages/assistant-runtime/test/hosted-runtime-vault-sync-event.test.ts apps/web/app/api/device-sync/agent/connections/[connectionId]/export-token-bundle/route.ts apps/web/app/api/device-sync/agent/connections/[connectionId]/refresh-token-bundle/route.ts apps/web/src/lib/device-sync/agent-session-service.ts apps/web/src/lib/device-sync/control-plane.ts apps/web/test/agent-session-service.test.ts apps/web/test/agent-session-routes.test.ts agent-docs/exec-plans/active/COORDINATION_LEDGER.md agent-docs/exec-plans/active/2026-04-23-hosted-sync-device-hardening.md`
- Required audits:
  - `simplify` found a JSONL pre-staging validation gap plus smaller cleanup issues; all were fixed and re-verified.
  - `coverage-write` (`gpt-5.4-mini`) found no additional proof worth adding.
  - `task-finish-review` found three rounds of trust-boundary gaps: missing JSONL post-validation before conflict staging, duplicate manifest-path acceptance / stale-equality heartbeat clearing, and current-vault schema-version emission. All were fixed and re-verified.
- Direct boundary proof captured in the touched suites:
  - malformed manifest entries and duplicate canonical manifest paths fail closed
  - missing or hash-mismatched manifest-listed restored files fail closed
  - contract-invalid imported JSONL/text is rejected before hosted canonical mutation or conflict staging
  - schema-valid JSONL that breaks vault invariants is rejected before commit
  - freshly built vault-sync packs emit `VAULT_SCHEMA_VERSION`
  - unsupported hosted `sourceSchemaVersion` is rejected before restore/merge
  - export/refresh route responses omit the active bearer token
  - advancing `lastSyncStartedAt` clears stale completion/error state, including equal timestamps and legacy detail-only rows
- Remaining unrelated blockers outside this lane:
  - `pnpm --dir packages/assistant-runtime test:coverage -- test/hosted-runtime-vault-sync-event.test.ts` still fails because unrelated pre-existing `src/hosted-runtime/events/linq.ts` coverage thresholds miss.
  - `pnpm typecheck` still fails on unrelated active work: workspace-boundary violations in `apps/cloudflare/src/user-runner/runner-run-processor.ts` and missing `expect` names in `packages/operator-config/test/http-linq-device-runtime.test.ts`.
  - earlier `bash scripts/workspace-verify.sh test:diff ...` broadened into unrelated reverse-dependent `packages/assistant-engine` failures.
Completed: 2026-04-23
