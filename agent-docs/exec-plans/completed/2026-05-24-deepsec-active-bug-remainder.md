Goal:
- Fix the remaining actionable active DeepSec `BUG` findings with small owner-local changes and focused tests.

Constraints:
- Prefer existing primitives and ownership boundaries over new infrastructure.
- Keep fixes composable and narrow; no broad rewrites or speculative abstractions.
- Preserve unrelated dirty worktree changes and active plan rows.
- Avoid exposing local paths, direct identifiers, secrets, or raw private payloads.

Scope:
- Assistant/CLI correctness: cache eviction, failed turn timeline, latest assistant-input cursor read, and unsupported `event edit --kind`.
- Core integrity validation: event attachments, raw manifest byte/hash checks, and structured raw-reference tombstone guard.
- Runtime reliability: inbox promotion serialization, device-daemon post-spawn cleanup, Telegram default filtering, inbox pagination, and query read-model correctness.
- Mark stale DeepSec findings fixed only after direct static/test proof.

Out of scope:
- `HIGH_BUG` findings.
- Broad hosted runtime scheduling redesigns.
- New persisted indexes unless an existing owner primitive already requires them.

Verification:
- Focused tests for each touched owner.
- `pnpm test:diff` for changed paths where truthful.
- `pnpm typecheck` and required smoke/owner checks unless blocked by unrelated dirty work.
- Completion workflow audit subagents for security/privacy, coverage, final review, and simplify only if the final diff size requires it.

Completion:
- Fixed the active DeepSec `BUG` findings in the scoped assistant/CLI, core, inbox, daemon, Telegram, and query owners.
- Marked active DeepSec `BUG` findings fixed in local `.deepsec` state; ignored generated DeepSec state is not part of the git commit.
- Addressed audit follow-ups for malformed raw artifact paths, symlink/non-regular raw artifacts, explicit Telegram bot direct-chat opt-in, and post-spawn daemon cleanup.
- Verification passed: focused owner tests, package typechecks for touched owners, `git diff --check`, and root `pnpm typecheck`.
Status: completed
Updated: 2026-05-24
Completed: 2026-05-24
