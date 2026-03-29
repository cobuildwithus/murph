---
description: Deprecated compatibility shim for the former standalone coverage-audit prompt
action: redirect
---

This prompt is deprecated.

Do not run a separate `test-coverage-audit` subagent pass.

Use `agent-docs/prompts/task-finish-review.md` instead and perform coverage/proof-gap review inside that final completion audit.

When the final audit finds meaningful missing proof:
- recommend or add the smallest high-impact tests that exercise the highest stable behavior boundary available
- call out any remaining direct-scenario verification gaps explicitly

This file remains only as a compatibility redirect for older plan docs and references.
