# Land returned Murph Privy localStorage auth refactor patch

Status: completed
Created: 2026-04-03
Updated: 2026-04-03

## Goal

- Apply the returned ChatGPT Pro patch that moves `apps/web` hosted onboarding/share/settings auth from Murph's hosted-session cookie dependency to Privy bearer plus identity-token request auth, then complete repo-required verification, audit, and commit flow.

## Success criteria

- The returned patch is downloaded, inspected, and applied without overwriting unrelated dirty-tree edits.
- The `apps/web` hosted onboarding, hosted share, and settings auth paths use the new request-auth seam from the patch and remain consistent with the current repo.
- Required verification for this high-risk `apps/web` change is run and recorded, with any unrelated baseline failures called out explicitly if they remain.
- The required `task-finish-review` audit pass runs on the landed diff and any high-severity findings are resolved.
- The task closes with a scoped commit containing only the exact touched paths.

## Scope

- In scope:
- Applying `output-packages/chatgpt-watch/69cda277-downloads/murph-privy-localstorage-refactor-clean.patch`.
- Reviewing and, if needed, minimally adjusting the touched `apps/web` auth/request/session files so the returned patch fits the live tree.
- Running required verification and final audit for the landed diff.
- Out of scope:
- Broader Privy architecture changes outside the returned patch.
- Removing now-unused compatibility helpers beyond what the patch already changes.

## Constraints

- Technical constraints:
- The repo worktree is already dirty in unrelated files; preserve those edits and avoid resets or broad staging.
- This is a high-risk auth/trust-boundary change under `apps/web`, so scoped verification is not allowed unless the user explicitly says otherwise.
- The patch landed from an external artifact and passed `git apply --check` before application.
- Product/process constraints:
- Follow repo completion workflow, including the coordination ledger, plan closure, required final audit subagent, verification, and scoped commit.
- Keep personal identifiers out of written artifacts and handoff text.

## Risks and mitigations

1. Risk: The patch applies mechanically but leaves the auth boundary inconsistent with current `apps/web` request helpers.
   Mitigation: Read the touched request-auth, Privy, and route files after apply and make only minimal fit fixes before verification.
2. Risk: Repo-wide required checks fail due to unrelated pre-existing dirty-tree issues.
   Mitigation: Record the exact failing command and target, and distinguish unrelated failures from patch-caused regressions.
3. Risk: The new bearer plus identity-token flow lacks direct scenario proof.
   Mitigation: Add the highest-signal direct auth-flow evidence available locally in addition to scripted checks.

## Tasks

1. Apply the returned patch and inspect the touched auth files for correctness against the current tree.
2. Run required verification and gather direct auth-flow proof where possible.
3. Run the required `task-finish-review` audit and address any findings.
4. Close the plan and create a scoped commit.

## Decisions

- Use a plan-bearing workflow because this is a multi-file external patch landing on a high-risk auth surface.
- Treat the returned patch as behavioral intent rather than overwrite authority, even though it currently applies cleanly.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- Additional focused checks if the main verification surface points at a narrower regression.
- Expected outcomes:
- Required checks pass, or any remaining failures are documented as credibly unrelated pre-existing baselines.
Completed: 2026-04-03
