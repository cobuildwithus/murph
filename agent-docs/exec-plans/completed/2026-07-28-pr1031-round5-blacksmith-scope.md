Goal (incl. success criteria):
- Correct PR #1031's round-5 ReviewGPT finding without expanding the architecture.
- Static Git snapshot metadata must exist for the SSH executor and must never alter a clean Blacksmith candidate's diff scope.
- Success means a production-dispatch regression proves a clean Blacksmith candidate remains clean and the canonical repo-tool verification passes without invoking the paid provider.

Constraints/Assumptions:
- Do not run paid Blacksmith verification.
- Preserve the SSH executor's immutable Git reconstruction contract.
- Add no cleanup owner, diff exception, provider state, or compatibility layer.
- The five-round ReviewGPT cap is reached; fix the accepted finding, record the retrospective, and require an explicit user decision before round 6.

Key decisions:
- Make static Git metadata an explicit candidate-snapshot option selected only for the SSH executor.
- Cover Blacksmith through the dispatcher with a fake provider that inspects the admitted candidate.

State:
- Completed.

Done:
- Reproduced the mechanism statically: the shared remote candidate factory unconditionally writes `.murph-static-git-snapshot`, while only the SSH entrypoint consumes it.
- Added a production-dispatch regression that initially failed because a clean
  fake-Blacksmith candidate reported the untracked metadata directory instead
  of `noChanges: true`.
- Moved metadata generation behind the dispatcher's explicit SSH selection.
  The existing SSH regression still proves the metadata is present, while the
  new Blacksmith regression proves an empty Git status and the real diff-scope
  selector's no-change result.
- Focused dispatcher coverage passed 23 tests.
- Canonical local `pnpm test:diff` passed 30 repo-tool files and 460 tests.
- Parent review found no new cleanup owner, diff exception, paid-provider
  behavior change, or SSH reconstruction regression.

Now:
- Archive this completed plan and push the corrected exact head.

Next:
- Wait for exact-head CI.
- Update the PR evidence and round-cap retrospective without starting ReviewGPT round 6.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- scripts/verification-dispatch.mjs
- scripts/verification-dispatch.test.ts
- PR #1031
Status: completed
Updated: 2026-07-28
Completed: 2026-07-28
Completed: 2026-07-28
