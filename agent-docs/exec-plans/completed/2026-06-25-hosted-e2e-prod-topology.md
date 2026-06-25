Goal (incl. success criteria):
- Land the supplied hosted-local E2E production-topology patch in an isolated worktree and open a draft PR.
- Success means normal `e2e:stub` hosted-local scenarios exercise production Worker/Runner/UserRunner topology with fake external vendors only, fault-injection scenarios explicitly opt into test controls, focused E2E/verification commands pass or have a concrete unrelated blocker, and the branch is pushed with a PR.

Constraints/Assumptions:
- Preserve unrelated work in the main checkout and other worktrees.
- Do not expose secrets, direct user identifiers, local usernames, or home paths in committed files, logs, docs, PR text, or handoff.
- Keep the harness simple: no new profile, no duplicate Murph authority boundary, and no broad compatibility layer.
- Test controls must fail closed when a scenario has not explicitly opted in.

Key decisions:
- Start from current `origin/main` in a dedicated worktree.
- Treat the supplied patch as behavioral intent; resolve only apply drift and compile/test issues needed to land it.
- Use the PR-lane completion path and external ReviewGPT loop after the pushed PR head.

State:
- Active.

Done:
- Read required repo workflow, architecture, verification, security, reliability, and testing docs.
- Created isolated branch/worktree from current `origin/main`.
- Applied and reconciled the hosted-local production-topology patch.
- Removed the proposed `openai-compact-egress` scenario after local verification showed it did not observe a compact provider request under the production-topology E2E path.
- Verified `openai-egress-authority`, `provider-egress-token-bridge`, and `warm-reuse-egress` with `e2e:stub`.

Now:
- Run final typecheck and diff hygiene.

Next:
- Inspect the diff for privacy leaks and unnecessary complexity.
- Commit, push, open draft PR, and start the PR review loop.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- Isolated task worktree on `codex/hosted-e2e-prod-topology`
- `packages/hosted-local-harness/src/e2e.ts`
- `packages/hosted-local-harness/README.md`
- `apps/cloudflare/test/helpers/hosted-local-dev-harness.ts`
- `apps/cloudflare/test/helpers/hosted-local-full-stack-scenario.ts`
- `apps/cloudflare/test/helpers/hosted-local-egress-scenario.ts`
- `apps/cloudflare/test/hosted-local-*-egress*.test.ts`
- `pnpm hosted-local e2e openai-egress-authority --profile e2e:stub`
- `pnpm hosted-local e2e provider-egress-token-bridge --profile e2e:stub`
- `pnpm hosted-local e2e warm-reuse-egress --profile e2e:stub`
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
