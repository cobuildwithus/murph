Goal (incl. success criteria):
- Fix post-rebase verifier failures on PR #263.
- `apps/web verify` should pass on the rebased branch.

Constraints/Assumptions:
- Keep changes limited to the failing migration baseline and passkey ref lint.
- Do not alter the hosted Codex auth architecture while fixing verifier fallout.

Key decisions:
- Update the hosted Prisma migration baseline for the new cleanup migration.
- Move passkey user ref synchronization out of render to satisfy React refs lint.

State:
- Complete.

Done:
- Diff-aware verifier isolated failures to `apps/web verify`.
- Updated the hosted Prisma migration baseline for the cleanup migration.
- Moved passkey user-ref synchronization into an effect.
- Focused tests, `apps/web verify`, docs drift, diff check, and redaction scan passed.

Now:
- Ready to commit and push.

Next:
- Push and rerun ReviewGPT on the rebased PR.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`
- `apps/web/src/components/settings/hosted-passkey-settings.tsx`
Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
