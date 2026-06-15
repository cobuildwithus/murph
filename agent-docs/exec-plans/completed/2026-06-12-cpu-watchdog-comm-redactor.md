Goal (incl. success criteria):
- Log CPU watchdog Linux `comm` process names for better hosted CPU debugging, while running them through the shared structured-log text redactor.
- Success means the watchdog logs all parsed `comm` names after redaction, keeps never reading argv/cmdline/path fields, and keeps the separate watchdog fingerprint/env path deleted.

Constraints/Assumptions:
- Preserve unrelated dirty work and do not deploy, push, or merge.
- Current repo and pinned Codex launcher searches found no `process.title`, `prctl(PR_SET_NAME)`, `pthread_setname_np`, `/proc/self/comm`, or `exec -a` usage in our hosted runner code paths.
- The accepted tradeoff is that non-obvious process-controlled identifiers may appear if the shared redactor does not classify them.

Key decisions:
- Use the existing hosted structured-log text sanitizer instead of an allowlist or a special watchdog secret.
- Keep reading `/proc/<pid>/stat` `comm` only; do not add `/proc/<pid>/cmdline` or argv logging.

State:
- Active.

Done:
- Verified repo code paths do not set process names.
- Replaced the allowlist with shared structured-log text sanitization for all parsed `comm` values.
- Updated direct watchdog tests for unknown-name passthrough and email-shaped redaction.
- Verification passed: focused watchdog Vitest, `apps/cloudflare` typecheck, and `apps/cloudflare verify`.
- Security/privacy review found no medium-or-higher findings beyond the documented accepted residual risk.
- Final task review found one low missing-test gap for empty sanitizer output; added direct coverage and reran verification.

Now:
- Ready for scoped finish-task commit.

Next:
- Archive the plan and commit the scoped files.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/cloudflare/src/container-cpu-watchdog.ts`
- `apps/cloudflare/test/container-cpu-watchdog.test.ts`
- `agent-docs/SECURITY.md`
Status: completed
Updated: 2026-06-12
Completed: 2026-06-12
