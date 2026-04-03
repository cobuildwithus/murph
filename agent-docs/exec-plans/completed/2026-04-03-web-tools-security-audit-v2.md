# 2026-04-03 Web Tools Security Audit V2

## Goal (incl. success criteria)

- Land the supplied `murph-web-tools-security-audit-v2.patch` on top of the current repo state.
- Preserve unrelated dirty-tree work while applying the patch's intended security hardening for `web.fetch` / `web.pdf.read`.
- Verify the landed behavior with the repo-required checks plus focused proof for the touched security surface.

## Constraints / Assumptions

- Treat the supplied patch as behavioral intent, not overwrite authority.
- Preserve unrelated in-flight work already present in the worktree.
- This is a high-risk security patch touching external fetch behavior and durable security docs.

## Key Decisions

- Use the supplied patch as the primary source of intent, but port it carefully if the tree has drifted.
- Keep the scope limited to the patch's web-tools hardening and matching durable docs.

## State

- Done.

## Done

- Updated all installed local `work-with-pro` skill copies to default to immediate polling instead of delayed wake checks.
- Collected the supplied replacement patch and confirmed the target repo already has unrelated in-flight edits outside the patch scope.
- Ported the supplied pinned-destination web-tools hardening into `packages/assistant-core/src/assistant/web-fetch.ts` on top of current drift, including explicit opt-in enablement, one-shot pinned Node requests, redirect/body cleanup, and expanded private-address blocking.
- Updated matching assistant tool descriptions, durable architecture/security docs, and the CLI harness coverage for the explicit opt-in catalog behavior and loopback blocking.
- Verified the landed slice with focused `@murphai/assistant-core` typecheck and the targeted CLI harness test file, then ran repo-wide `pnpm typecheck` and `pnpm test`.

## Now

- Close the active plan and create the scoped commit for the landed slice.

## Next

- Hand off the landed patch with the focused and repo-wide verification results, noting the unrelated hosted-web smoke cleanup failure that left `pnpm test` non-zero.

## Open Questions

- None.

## Working Set (files / ids / commands)

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-03-web-tools-security-audit-v2.md`
- `/Users/willhay/Downloads/murph-web-tools-security-audit-v2.patch`
- `packages/assistant-core/src/assistant/web-fetch.ts`
- `packages/assistant-core/src/assistant-cli-tools.ts`
- `packages/cli/test/inbox-model-harness.test.ts`
- `ARCHITECTURE.md`
- `agent-docs/SECURITY.md`
- `agent-docs/index.md`
Status: completed
Updated: 2026-04-03
Completed: 2026-04-03
