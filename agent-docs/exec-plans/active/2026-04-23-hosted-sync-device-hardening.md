# Harden hosted sync and device-sync trust boundaries

Status: active
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

- Vault-sync import validation now fails closed at three seams inside `packages/core`: strict manifest parsing/kind re-derivation, per-file canonical contract validation before planning/conflict staging, and merged-vault preview validation before the real canonical write.
- Tampered manifest-listed files are treated as untrusted input: missing restored files, hash mismatches, malformed manifest entries, and manifest `kind`/path mismatches now reject the import instead of being skipped or partially applied.
- Verified raw/text conflict payloads stay in memory through preview/final apply via `rawContents` instead of re-reading `sourcePath` later, so the bytes that pass verification are the bytes staged.
- The merged-vault preview still clones the full target vault inside the canonical write lock so `assertValidVault(...)` can run against the real merged state. That preserves correctness for this hardening pass, but it leaves a lock-hold / preview-copy cost as a residual reliability concern for later follow-up.

## Verification

- Ran and passed:
  - `pnpm --dir packages/core typecheck`
  - `pnpm --dir packages/core exec vitest run test/vault-sync.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm --dir packages/core exec vitest run test/high-value-seam-regressions.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm --dir packages/core test:coverage` (`30` files, `319` tests)
  - `pnpm test:smoke`
  - `git diff --check -- packages/core/src/vault-sync.ts packages/core/test/vault-sync.test.ts packages/core/test/high-value-seam-regressions.test.ts`
- Repo-wide verification:
  - `pnpm typecheck` completed successfully on the final tree, while still printing existing workspace-boundary diagnostics in `apps/cloudflare/src/user-runner/runner-run-processor.ts` and `apps/cloudflare/test/runner-run-processor.test.ts`
- Required audits:
  - `coverage-write` (`gpt-5.4-mini`) found no additional proof worth adding beyond the new vault-sync regressions
  - `task-finish-review` found two rounds of trust-boundary gaps; strict manifest parsing/kind validation and verified raw-byte staging were fixed locally and re-verified
- Direct scenario proof captured in tests:
  - invalid contract JSONL is rejected before hosted canonical mutation
  - invalid conflicted canonical text is rejected before conflict staging
  - malformed manifest entries and tampered manifest `kind`/path pairs fail closed
  - missing or hash-mismatched manifest-listed restored files fail closed
  - merged preview rejects schema-valid JSONL that references missing raw evidence
  - source assertions keep raw/text conflict preservation on verified in-memory bytes instead of `sourcePath` copies
