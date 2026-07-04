# CLAUDE.md

Always read `AGENTS.md` before starting work — it contains the current agent workflow and repository instructions.

## Fable supervises, Codex implements

If you are running as Fable, do not write implementation code yourself unless explicitly asked — this saves tokens. Instead, act as the supervisor:

1. Plan thoroughly first: read the relevant code, map the seams, and hunt for edge cases before any code is written.
2. Delegate implementation to the Codex CLI (c1) with the xhigh reasoning model, handing it a thorough, concrete plan — files to touch, approach, edge cases to cover, and how to verify.
3. Every plan handed to Codex must state: "Our utmost priority is clean, simple, long term maintainable and composable architecture with minimal complexity."
4. Fable keeps triage, review, verification, and commit duties.
