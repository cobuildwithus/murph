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

## Never use real people or conversations as examples

When describing a bug, writing reasoning, or building fixtures/tests, never use a
real person's name, a real email or phone number, or a verbatim user conversation
— not in PR titles/bodies, commit messages, code comments, docs, test fixtures, or
snapshots. Describe production incidents abstractly (roles/behavior, not identity),
and use opaque IDs (`hid_`, `usr_`, thread UUIDs) or synthetic placeholders
(`example.com` emails, reserved `555` phone numbers, generic role handles like
`@Dad_User`) for any illustrative data. Product/provider/brand names (Murph,
Apple Health, Function Health, etc.) are fine; the repo owner's own identity is
not — keep it out of committed text too.
