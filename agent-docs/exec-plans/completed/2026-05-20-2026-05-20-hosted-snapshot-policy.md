# Hosted direct-R2 snapshot content policy

Status: completed
Created: 2026-05-20
Updated: 2026-05-20

## Goal

- Make hosted direct-R2 v2 idle-shutdown snapshots archive only portable workspace state selected by the existing runtime-state ownership policy, while preserving the current single encrypted `tar.zst` object format and direct-R2 checkpoint flow.

## Success criteria

- v2 snapshot capture no longer recursively archives the entire durable root.
- Canonical vault files and durable assistant continuity survive checkpoint/restore without a brittle file whitelist.
- Rebuildable/cache/private/process-local state such as `.runtime/projections`, `.runtime/cache`, `.runtime/tmp`, restore markers, and unreferenced Codex home files are excluded.
- Codex continuity restores active manifest-referenced JSONL files and rejects unsafe/unexpected restored Codex home state when a v2 manifest is present.
- Focused unit/integration/E2E coverage proves capture and restore behavior.

## Scope

- In scope:
  - Runtime-state snapshot entry policy API for hosted workspace capture.
  - Cloudflare local snapshot tar capture using a generated entry list.
  - Focused Cloudflare/runtime-state/assistant-runtime tests for capture and restore.
- Out of scope:
  - Changing the direct-R2 object format, encryption, presigned upload, checkpoint CAS, or R2 storage flow.
  - Broad bridge refactors, layout centralization, AAD/ref parser dedupe, or physical relocation of restore cache files unless required for correctness.
  - Production deploy.

## Constraints

- Technical constraints:
  - Reuse existing runtime-state portability rules; do not create a hand-maintained per-file whitelist.
  - Keep old v2 snapshots restorable when no Codex continuity manifest is present.
  - Avoid extra durable-root scans beyond the existing preflight/archive path where practical.
- Product/process constraints:
  - Do not expose raw vault paths, user identifiers, secrets, payloads, transcripts, or provider data in logs/tests/docs.
  - Preserve unrelated dirty work in the current checkout.

## Risks and mitigations

1. Risk: overly narrow archive selection drops resume-critical assistant/Codex state.
   Mitigation: include canonical vault broadly, assistant continuity broadly, and Codex active JSONL files through the existing continuity collector; add restore tests.
2. Risk: selected-entry tar loses directory semantics or safety checks from whole-root tar.
   Mitigation: keep explicit directory entries where needed, retain symlink/hardlink/special-file/path traversal checks, and assert restore recreates required roots.
3. Risk: tightening unknown runtime-owned state breaks idle shutdown on legacy local residue.
   Mitigation: exclude known rebuildable/private residue first and keep broad assistant continuity; avoid broad new fail-closed unknown-state behavior in this patch.

## Tasks

1. Map existing snapshot capture, restore, and runtime-state policy call sites.
2. Add a runtime-state entry collector that returns portable archive entries and redacted diagnostics.
3. Switch direct-R2 v2 local capture from whole-root tar to selected-entry tar.
4. Add focused tests for archive contents, safety checks, Codex continuity, and restore compatibility.
5. Run scoped verification, required audit subagents, and a hosted-local direct-R2 scenario if feasible.

## Decisions

- Keep one encrypted `tar.zst` object and direct-R2 upload flow unchanged.
- Treat the archive entry list as a mechanical capture plan from runtime-state policy, not a hand-maintained whitelist.
- Defer broad bridge/layout/AAD refactors unless the narrow implementation exposes a direct correctness issue.

## Verification

- Passed:
  - `pnpm --filter @murphai/runtime-state typecheck`
  - `pnpm --filter @murphai/assistant-runtime typecheck`
  - `pnpm --filter @murphai/cloudflare-runner typecheck`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runtime-bridge-workspace.test.ts apps/cloudflare/test/workspace-snapshot-local.test.ts`
  - `pnpm exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-workspace-restore-codex-continuity.test.ts` from `packages/assistant-runtime`
  - `pnpm --filter @murphai/runtime-state test`
  - `pnpm hosted-local e2e checkpoint-baseline --profile e2e:stub`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage --cache=false --project cloudflare-node-platform apps/cloudflare/test/user-runner-alarm.test.ts --reporter verbose`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage --cache=false --project cloudflare-node-platform --reporter dot`
  - `MURPH_VERIFY_STEP_PARALLEL=0 pnpm --dir apps/cloudflare verify`
  - `pnpm test:diff packages/runtime-state apps/cloudflare packages/assistant-runtime`
- Notes:
  - The original broad verification blocker was stale Cloudflare alarm/nudge tests that still expected pre-Temporal semantic scheduling. They now assert the hard-cut contract: Temporal owns demand/sleeps, while Cloudflare owns write-fence watchdog alarms, execution adapter behavior, deletion cleanup, and snapshot upload-session coordination.
Completed: 2026-05-20
