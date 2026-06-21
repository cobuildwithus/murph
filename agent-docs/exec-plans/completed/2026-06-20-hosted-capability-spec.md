# Hosted capability hard cut

Status: completed
Created: 2026-06-20
Updated: 2026-06-20

## Goal

- Hard-cut hosted assistant capability env ownership into a canonical,
  data-only `@murphai/hosted-execution/assistant-capabilities` primitive.
- Split generated voice memo execution away from broad Codex process env so
  provider capabilities are explicit typed dependencies.
- Delete stale hosted assistant env shims and duplicated provider env lists
  where callers can move to the real owner in this branch.

## Success criteria

- Capability env names declare one owner and explicit allowed surfaces.
- Existing runtime, shell, Worker secret, and intercept env membership derives
  provider entries from the capability spec where appropriate.
- Voice memo dynamic tool no longer receives `NodeJS.ProcessEnv` as its
  provider capability surface.
- Telegram voice memo turn-time behavior remains deferred generation with
  current early configuration errors; Linq still generates and uploads at tool
  execution.
- ElevenLabs egress authorization remains explicit Worker code, not generated
  from metadata.
- Hosted-execution entrypoint remains workerd-safe and package cycle checks pass.

## Scope

- In scope:
  - `packages/hosted-execution` assistant capability spec/projections/tests.
  - Hosted runtime/env profile, shell, runner secret, and deploy-list callers.
  - Voice memo dynamic-tool runtime seam and narrow voice-memo extraction.
  - ElevenLabs egress adapter extraction only if it can stay an explicit
    deny-by-default dispatcher.
  - Durable docs that describe the hard-cut contract.
- Out of scope:
  - A global env manager, plugin registry, or generated source files.
  - Generating egress authorization rules from declarative metadata.
  - Changing model-visible tool registration or provider routes beyond the
    requested voice memo seam.

## Constraints

- Technical constraints:
  - Keep `hosted-execution` pure/workerd-safe; no Node-only imports.
  - Preserve package dependency direction: engine/runtime/Cloudflare may depend
    on hosted-execution, not the reverse.
  - Keep provider host/method/path/header/body/model validation explicit in
    Worker code.
  - Do not forward raw Worker credentials into the runner; sentinels stay at
    the existing egress boundary.
- Product/process constraints:
  - Preserve unrelated working-tree edits and active PR-221 branch work.
  - Use an isolated task worktree and scoped commit/PR.

## Risks and mitigations

1. Risk: Overlapping active PR-221 voice memo/runner work.
   Mitigation: Keep edits scoped to this branch, use explicit PR notes, and
   avoid unrelated process cleanup or CI fixes.
2. Risk: Declarative capability data becomes an implicit authorization system.
   Mitigation: Use it only for env-name membership/projection tests; keep egress
   checks hand-written.
3. Risk: Telegram voice memos generate audio during turn-time or expose secrets.
   Mitigation: Preserve the deferred descriptor and sentinel-only runner env.

## Tasks

1. Map current env constants, caller imports, and test coverage.
2. Add the canonical capability spec and projection helpers.
3. Migrate env membership callers and delete stale shims/lists.
4. Split voice memo dynamic-tool dependencies from Codex process env.
5. Add invariants for capability uniqueness, dynamic-tool resolution, and
   sentinel/no-secret behavior.
6. Run verification/audits, close the plan, commit, push, and open a draft PR.

## Decisions

- 2026-06-20: User clarified this should be a hard cut prioritizing clean,
  simple long-term architecture over staged compatibility.

## Verification

- Passed:
  - `git diff --check`
  - `pnpm --dir apps/cloudflare verify`
  - `pnpm --dir packages/hosted-execution build && pnpm --dir packages/hosted-execution typecheck`
  - `pnpm --dir apps/cloudflare typecheck`
  - Targeted hosted-execution, assistant-engine, assistant-runtime,
    apps/cloudflare, hosted-local-harness, and operator-config tests covering
    capability projections, dynamic tool runtime routing, sentinel env
    construction, and egress rejection invariants.
  - Repo guards and workspace package cycle checks inside
    `pnpm typecheck`/`scripts/workspace-verify.sh test:diff`.
- Blocked by existing repo-level issue:
  - `pnpm typecheck` and
    `scripts/workspace-verify.sh test:diff <touched paths>` stop at
    `packages/assistant-cli` typecheck with pre-existing missing subpath module
    declarations/export mismatches for assistant-engine/operator-config and
    strict `unknown` error handling failures. This occurs before the verifier
    reaches the hosted capability-specific test surface.
Completed: 2026-06-20
