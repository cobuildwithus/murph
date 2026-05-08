# Browser vault refresh authority narrowing

Status: completed
Created: 2026-05-09
Updated: 2026-05-09

## Goal

- Narrow detached browser-vault refresh outbound authority to the two routes it needs and make replica writes fail closed when neither a live lease nor refresh authority is present.

## Success criteria

- Browser-vault refresh proxy authority allows only `POST /replicas` on the browser-vault replica store and `POST` to the web browser-vault replica publish route.
- Browser-vault refresh proxy authority no longer allows committed workspace reads.
- Browser-vault replica write headers are empty only for explicit refresh authority.
- Header construction throws if a replica write is attempted without an active workspace lease or refresh authority.
- Focused tests cover the route denial and explicit refresh write behavior.

## Scope

- In scope:
- `apps/cloudflare/src/runner-outbound.ts`
- `apps/cloudflare/src/runtime-platform.ts`
- focused `apps/cloudflare/test/**` coverage
- Out of scope:
- broader hosted runner lifecycle changes and unrelated dirty worktree edits.

## Constraints

- Preserve active invocation lease-based browser-vault replica writes.
- Preserve source-hash guarded detached refresh writes and web publish.
- Keep the fix small and fail-closed.
- Preserve unrelated dirty worktree edits.

## Risks and mitigations

1. Risk: overlapping dirty Cloudflare work blocks a scoped commit.
   Mitigation: keep changes to non-overlapping files where possible and report exact blockers if commit automation cannot safely isolate the diff.
2. Risk: over-tightening breaks live refresh publishing.
   Mitigation: keep `POST /replicas` and `POST` browser-vault replica publish explicitly covered by focused tests.

## Tasks

1. Done: remove committed workspace read from the browser-vault refresh outbound allowlist.
2. Done: make browser-vault replica write header creation throw on missing authority.
3. Done: add focused regression tests for denied workspace read, explicit refresh-authority writes, and workspace bridges with no active lease.
4. Done: run targeted Cloudflare verification and required audits.
5. Now: commit or report scoped-commit blockers.

## Decisions

- Use direct route checks and a direct throw instead of a new authority abstraction.

## Verification

- Passed: `pnpm --dir . exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/runner-platform.test.ts` (2 files, 132 tests).
- Passed: `git diff --check -- apps/cloudflare/src/runner-outbound.ts apps/cloudflare/src/runtime-platform.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/runner-platform.test.ts agent-docs/exec-plans/active/2026-05-09-browser-vault-refresh-authority.md`.
- Blocked by unrelated dirty work: `pnpm --dir apps/cloudflare typecheck` fails in `apps/web/src/testing.ts` because the test store type is missing `publishHostedBrowserVaultReplicaRef`.
- Blocked by unrelated dirty work: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-outbound.ts apps/cloudflare/src/runtime-platform.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/runner-platform.test.ts` reaches `apps/cloudflare verify` and fails in `apps/cloudflare/test/user-runner-alarm.test.ts` for a missing `preferredWakeAt` field from another active runner change, plus the same `apps/web/src/testing.ts` issue.
Completed: 2026-05-09
