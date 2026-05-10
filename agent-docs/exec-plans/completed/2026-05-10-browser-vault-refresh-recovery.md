# Browser-vault refresh recovery

Status: completed
Created: 2026-05-10
Updated: 2026-05-10

## Goal

- Stop hosted browser-vault refresh from publishing empty/minimal replicas when the warm runner vault is missing or stale, and close the R2-write/publish orphan window.

## Success criteria

- Detached browser-vault refresh restores/materializes the current hosted workspace before building the private browser replica.
- A restored workspace with canonical source evidence cannot publish an empty browser-vault replica.
- After a replica object write succeeds, publishing the latest ref is treated as the non-preemptible commit tail.
- Transient refresh failure and missing/unreadable stored replicas keep one coalesced retry intent instead of relying only on best-effort `waitUntil`.
- Focused Cloudflare, assistant-runtime/query, and web session tests cover the new invariants.

## Scope

- In scope:
  - Hosted browser-vault refresh preparation and diagnostics.
  - Cloudflare refresh orchestration, write/publish boundary, and retry intent.
  - Browser-vault session handling for missing/unreadable stored replicas.
  - Focused tests for restore-before-build, empty publish prevention, post-write publish, and retry scheduling.
- Out of scope:
  - Changing public Health Commons catalog generation.
  - Wiring or expanding source-hash refresh authorization.
  - Changing canonical vault mutation ownership.

## Constraints

- Keep architecture simple: one restored source of truth, one derived replica publish boundary, one coalesced retry intent.
- Do not use byte-length heuristics for correctness.
- Do not deep-import assistant-runtime internals from Cloudflare; expose a small owned runtime seam if needed.
- Preserve unrelated dirty worktree edits.

## Risks and mitigations

1. Risk: Empty replicas can suppress future browser refresh because a ref exists.
   Mitigation: Guard on restored source evidence plus real replica content before write/publish.
2. Risk: Foreground preemption can leave an orphaned R2 object.
   Mitigation: Make publish non-preemptible after a successful write.
3. Risk: Retry state can grow into a queue or competing scheduler.
   Mitigation: Keep one coalesced pending intent with bounded retry metadata.

## Tasks

1. Add a small hosted browser-vault refresh preparation result with source/content diagnostics.
2. Restore workspace before replica build and enforce empty publish prevention.
3. Close the post-write abort window.
4. Add coalesced retry scheduling for transient refresh failures and missing stored replicas.
5. Add focused tests and run required verification/audits.

## Verification

- Passed:
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --project cloudflare-node-runner apps/cloudflare/test/node-runner-browser-vault-refresh.test.ts`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --project cloudflare-node-runner apps/cloudflare/test/runner-container.test.ts -t "empty-source browser-vault"`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --project cloudflare-node-runner apps/cloudflare/test/runner-outbound.test.ts -t "browser-vault refresh authority"`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --project cloudflare-node-platform apps/cloudflare/test/user-runner-alarm.test.ts`
  - `pnpm --filter @murphai/assistant-runtime test -- hosted-browser-vault-replica.test.ts`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --project hosted-web-store-config apps/web/test/browser-vault-session-route.test.ts`
  - `pnpm --filter @murphai/query typecheck`
  - `pnpm --filter @murphai/assistant-runtime typecheck`
  - `pnpm --filter @murphai/cloudflare-runner typecheck`
  - `pnpm --filter @murphai/hosted-web typecheck:prepared`
- Blocked/unrelated:
  - `pnpm --dir apps/web test -- browser-vault-session-route.test.ts` ran the full web workspace; it hit unrelated hosted onboarding/settings failures in existing dirty lanes. The targeted browser-vault route project command above passed.
Completed: 2026-05-10
