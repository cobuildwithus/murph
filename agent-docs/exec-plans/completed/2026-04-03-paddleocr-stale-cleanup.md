# 2026-04-03 PaddleOCR Stale Cleanup

## Goal (incl. success criteria)

- Remove the remaining stale PaddleOCR deploy/config/doc references from the active hosted Cloudflare surface.
- Keep the checked-in workflow, deploy automation, tests, and durable docs aligned with the actual post-hard-cut parser/runtime contract.

## Constraints / Assumptions

- Scope stays limited to stale PaddleOCR residue; do not broaden into unrelated hosted deploy cleanup.
- Preserve unrelated dirty worktree edits already in flight.
- Treat PaddleOCR as fully removed from the active runtime surface.

## Key Decisions

- Remove dead workflow and deploy-automation knobs instead of keeping misleading no-op compatibility flags.
- Update the repo-owned verification/runtime doc in the same change when it still describes the removed knob as active.

## State

- Verification complete; ready to close and commit.

## Done

- Confirmed the active runtime/parser surface no longer contains a live PaddleOCR adapter or source path.
- Identified remaining stale references in the Cloudflare workflow, deploy automation, tests, and durable docs.
- Removed the stale PaddleOCR workflow env exports, deploy-automation image-var plumbing, runner env-prefix allowlist entry, deploy-guide note, and verification/runtime doc reference.
- Updated the Cloudflare deploy-automation tests to match the post-hard-cut container contract with no PaddleOCR image vars.
- Updated `agent-docs/index.md` so the doc-index guard matches the touched durable verification doc.
- Verified `pnpm typecheck` passes.
- Verified focused Cloudflare proof passes with:
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/deploy-automation.test.ts`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-env.test.ts`
- Confirmed no live PaddleOCR references remain outside this temporary active plan, immutable historical plans, and release-note/changelog history.
- Re-ran `pnpm test` and `pnpm test:coverage`; both remain blocked by the unrelated existing `packages/contracts` verify assertion failure (`17 !== 16` in `packages/contracts/dist/scripts/verify.js`).

## Now

- Close the plan and create the scoped commit.

## Next

- Hand off with the focused verification evidence and the unrelated repo-wide contracts failure noted explicitly.

## Open Questions

- None.

## Working Set (files / ids / commands)

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-03-paddleocr-stale-cleanup.md`
- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/cloudflare/src/deploy-automation.ts`
- `apps/cloudflare/test/deploy-automation.test.ts`
- `apps/cloudflare/DEPLOY.md`
- `agent-docs/operations/verification-and-runtime.md`
Status: completed
Updated: 2026-04-03
Completed: 2026-04-03
