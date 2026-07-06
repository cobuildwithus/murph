# CLAUDE.md

Always read `AGENTS.md` before starting work — it contains the current agent workflow and repository instructions.

## Land changes from a new worktree

Always land changes (commits and pushes) from a dedicated git worktree on a task branch: create one with `git worktree add`, commit and push from there, and remove it when done. Never switch the primary checkout (the root worktree) off `main` — leave it on `main` at all times so shared repo state stays stable and other agents working in this checkout are not disrupted. To land on `main`, push the worktree branch (open a PR, or push directly to `main` only when explicitly asked); do not check `main` out in the root worktree to do it.

## Fable supervises, Codex implements

If you are running as Fable, do not write implementation code yourself unless explicitly asked — this saves tokens. Instead, act as the supervisor:

1. Plan thoroughly first: read the relevant code, map the seams, and hunt for edge cases before any code is written.
2. Delegate implementation to the Codex CLI (c1) with the xhigh reasoning model, handing it a thorough, concrete plan — files to touch, approach, edge cases to cover, and how to verify.
3. Every plan handed to Codex must state: "Our utmost priority is clean, simple, long term maintainable and composable architecture with minimal complexity."
4. Fable keeps triage, review, verification, and commit duties.
