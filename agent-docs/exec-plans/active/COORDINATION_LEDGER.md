# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| Codex | Watch and land returned Pro patch from `69d20df8-acf0-839e-98a3-d7e41efee655` | Scope TBD from returned patch; likely hosted execution files already dirty in tree | Returned patch scope TBD | in_progress | Non-exclusive. Keep `thread wake` running up to 120 minutes; do not stop early just because the thread is still busy. Merge carefully on top of current dirty hosted-execution/auth changes. |
| Codex | Watch and land returned Pro patch from `69d1c1a7-7414-83a0-83f6-517525c12f83` | Scope TBD from returned patch | Returned patch scope TBD | in_progress | Non-exclusive. Run in parallel with the other wake session; keep both watchers alive up to 120 minutes and merge carefully on top of the existing dirty tree. |
| Codex | Watch and land returned Pro patch from `69d23283-9cfc-839e-a4d3-694abfa70e6e` | Scope TBD from returned patch | Returned patch scope TBD | in_progress | Non-exclusive. Child worker owns wake/apply flow for this thread and must merge carefully on top of the current dirty tree. |
| Codex | Watch and land returned Pro patch from `69d23286-9f10-8398-a5e5-7f6a3093fbe0` | Scope TBD from returned patch | Returned patch scope TBD | in_progress | Non-exclusive. Child worker owns wake/apply flow for this thread and must merge carefully on top of the current dirty tree. |
| Codex | Watch and land returned Pro patch from `69d23385-fdf8-839e-a45a-a61de6569f02` | Scope TBD from returned patch | Returned patch scope TBD | in_progress | Non-exclusive. Watch-only flow only: do not nudge the thread unless the user explicitly asks. Merge carefully on top of the current dirty tree if a patch arrives. |
| Codex | Patch `../review-gpt` wake/browser robustness and bump Murph to the released version | `agent-docs/exec-plans/active/2026-04-05-review-gpt-robustness-release.md`, Murph root dependency metadata/lockfile | `@cobuild/review-gpt` version bump only on Murph side | in_progress | Non-exclusive in Murph. Preserve unrelated dirty files. Upstream package edits and release happen in sibling repo `../review-gpt`; Murph stays limited to the dependency import path and plan/ledger bookkeeping. |
