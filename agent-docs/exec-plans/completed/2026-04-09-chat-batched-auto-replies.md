# Goal (incl. success criteria):
- Make Murph batch adjacent inbound chat messages from the same conversation into one auto-reply turn so a user can send several messages and get one reply that considers them together.
- Preserve the existing "newer messages arrive for the next available turn" behavior by only grouping messages already pending before the current reply turn is selected.

# Constraints/Assumptions:
- Keep the change scoped to assistant auto-reply grouping and cursor behavior.
- Do not change delivery, outbox, or provider execution semantics.
- Preserve existing album/email grouping semantics unless the broader chat batching cleanly subsumes them.

# Key decisions:
- Start with the existing assistant auto-reply grouping seam in `packages/assistant-engine/src/assistant/automation/grouping.ts`.
- Treat consecutive inbound captures from the same source/account/thread/actor lane as one reply group across messaging channels, while keeping channel-specific metadata handling intact.

# State:
- in_progress

# Done:
- Read required repo workflow, architecture, verification, product, and reliability docs.
- Located the current grouping seam and confirmed ordinary chat messages are not grouped today.
- Switched grouping to one source-agnostic same-conversation predicate and added focused regression coverage.
- Added a small command-surface contract note for coalesced auto-reply turns.

# Now:
- Run verification, complete the required audit pass, and land only the scoped assistant batching changes.

# Next:
- Commit the scoped diff once verification and audit are green.

# Open questions (UNCONFIRMED if needed):
- None.

# Working set (files/ids/commands):
- `packages/assistant-engine/src/assistant/automation/grouping.ts`
- `packages/assistant-engine/test/assistant-automation-support.test.ts`
- `docs/contracts/03-command-surface.md`
- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:smoke`
Status: completed
Updated: 2026-04-09
Completed: 2026-04-09
