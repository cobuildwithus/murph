# CLAUDE.md

Read `AGENTS.md` before starting work. It is the canonical repository instruction
file; `agent-docs/operations/agent-workflow-routing.md` owns task classification,
worktree choice, model routing, audits, verification, and commit paths.

Do not create a second workflow here. In particular:

- Use the task-class worktree and model route instead of a universal delegation rule.
- When invoked as a delegated implementer, work in the supplied checkout and
  leave branches, commits, pushes, verification, and final review to the parent
  unless the handoff explicitly widens that authority.
- Follow the privacy rules in `AGENTS.md`; omit personal names from PR titles and
  bodies as well as committed artifacts.
