# Codex auth checkpoint

Status: completed
Created: 2026-06-23
Updated: 2026-06-23

## Goal

- Integrate the supplied Codex auth checkpoint patch on an isolated branch and open a draft PR.
- Preserve hosted auth/session, privacy, runtime checkpoint, and package-boundary invariants while adapting the patch to current `origin/main`.

## Success criteria

- Patch intent is implemented against current code with no unresolved merge artifacts.
- Hosted ChatGPT/Codex auth checkpoint state has focused tests or direct proof for store, route, runtime, and control-plane contracts touched by the patch.
- Required high-risk completion audits are run and any accepted findings are resolved.
- Required verification passes or documented truthful scoped substitutes pass.
- Scoped commit is pushed and a draft PR is opened.

## Scope

- In scope:
  - `apps/web`, `apps/cloudflare`, `packages/assistant-engine`, `packages/assistant-runtime`, `packages/hosted-execution`, and `packages/runtime-state` changes from the supplied patch.
  - Prisma schema/migration changes required by the patch.
  - Tests and docs needed to prove or document new auth/checkpoint behavior.
- Out of scope:
  - Broader auth redesigns beyond the supplied patch intent.
  - Unrelated hosted runtime, assistant media, device-sync, billing, or product changes.

## Constraints

- Technical constraints:
  - Keep Composio, Codex, hosted web, hosted runner, and persisted-state ownership boundaries intact.
  - Keep secrets and direct identifiers out of logs, fixtures, docs, PR text, and committed artifacts.
  - Avoid broad compatibility shims or speculative state surfaces.
- Product/process constraints:
  - Treat this as high-risk PR-lane work because it touches auth/session and hosted runtime boundaries.
  - Use the repo plan, audit, verification, finish-task, and draft PR workflow.

## Risks and mitigations

1. Risk: The supplied patch was produced against a different tree and may be stale.
   Mitigation: Apply it as behavioral intent, inspect every reject/conflict, and re-read adjacent current code before accepting changes.
2. Risk: Auth checkpoint state could leak sensitive identifiers or credentials.
   Mitigation: Review storage, logs, tests, route responses, and PR text for secret/identifier exposure; run security/privacy audit.
3. Risk: Runtime control-plane contract drift between web, Cloudflare, and assistant runtime.
   Mitigation: Keep contract/parsers/builders/tests aligned and run focused owner verification.

## Tasks

1. Apply the supplied patch in the isolated worktree and resolve conflicts.
2. Read the touched current code paths and simplify/adapt the implementation to repo conventions.
3. Add or adjust focused tests for new auth/checkpoint behavior.
4. Run scoped verification and required completion audits.
5. Finish the plan-bearing task with a scoped commit, push, and open a draft PR.

## Decisions

- Use a dedicated worktree and branch `codex/codex-auth-checkpoint`.

## Verification

- Commands run:
  - Focused auth/runtime/control-plane Vitest suites for web, Cloudflare, assistant runtime, and hosted-execution.
  - `pnpm --dir apps/web verify`
  - `pnpm typecheck`
  - `pnpm test:diff`
  - `pnpm docs:drift`
  - `git diff --check`
- Result:
  - Passed.
  - Known non-failing warnings remained in the existing web/hosted-local verification output.
Completed: 2026-06-23
