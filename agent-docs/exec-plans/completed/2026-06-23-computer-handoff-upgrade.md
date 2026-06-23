Goal (incl. success criteria):
- Let an already-paused live computer run be upgraded into a secure browser handoff link when the user asks to inspect the screen.
- Keep final confirmation chat-first: a plain fresh user reply such as "yes" should still resume the paused checkout without requiring the user to open or complete a hidden handoff.
- Success means chat-only final-confirmation pauses can mint an on-demand handoff later, existing handoff refresh behavior remains intact, and login/payment handoff safety remains fail-closed.

Constraints/Assumptions:
- Web remains the owner of hosted computer run and handoff authority.
- Do not add a new public route, scheduler, queue, or second browser-link abstraction.
- Do not store raw handoff URLs or raw provider live-view URLs.
- Preserve same-turn pause locking and fresh-user-reply resume proof.
- Preserve unrelated active ledger rows.

Key decisions:
- Extend the existing pause/handoff transition instead of adding a separate "get screen link" tool.
- Treat handoff creation for an awaiting run as an explicit on-demand upgrade, not a hidden handoff created for every final confirmation.
- Keep the CAS boundary at the store layer so races with resume, finish, expiry, or another handoff request fail closed.

State:
- Ready for PR.

Done:
- Static review identified the current gap: existing handoff refresh requires `pendingHandoffId`, so chat-only awaiting runs cannot mint the first link.
- Implemented the web-owned awaiting-run handoff upgrade and optional final-confirmation inspection resume path.
- Added a narrow computer-use prompt/skill instruction so Murph asks the existing pause tool for a link instead of restarting the browser task.
- Added regressions for on-demand inspection handoff minting, final-confirmation chat resume with an open inspection link, non-final manual handoff blocking, and Prisma CAS fences.
- Security/privacy, deep code, prompt, and coverage reviews found no blocking findings.
- Focused hosted computer-use Vitest passed.
- Diff verification passed through package typechecks/tests and Cloudflare verification; apps/web verify remains blocked by the pre-existing missing `2026062100_hosted_ai_usage_period_counter_backfill` migration expected by `hosted-onboarding-privacy-foundation-migration.test.ts`.

Now:
- Commit and open PR.

Next:
- Watch PR checks after push; apps/web may remain red until the unrelated migration baseline is repaired on main.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/computer-use/service.ts
- apps/web/src/lib/computer-use/store.ts
- apps/web/test/hosted-execution-computer-use.test.ts
- packages/assistant-engine/src/assistant/system-prompt.ts
- packages/assistant-engine/skills/computer-use/SKILL.md
- `pnpm exec vitest run apps/web/test/hosted-execution-computer-use.test.ts --config apps/web/vitest.workspace.ts --no-coverage`
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/computer-use/service.ts apps/web/src/lib/computer-use/store.ts apps/web/test/hosted-execution-computer-use.test.ts packages/assistant-engine/src/assistant/system-prompt.ts packages/assistant-engine/skills/computer-use/SKILL.md`
Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
