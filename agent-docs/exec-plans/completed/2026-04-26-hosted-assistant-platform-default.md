Goal (incl. success criteria):
- Make hosted assistant env configuration authoritative for the platform-managed profile so production updates to `platform-default` take effect for users whose saved hosted assistant config was seeded before the latest env change.
- Success: whenever a valid hosted env profile exists, bootstrap upserts and activates `platform-default`; saved/member profiles remain stored but no longer stay active ahead of platform env.

Constraints/Assumptions:
- Keep this as the narrow reset-friendly fix; do not add per-session target migration or user-managed key UX yet.
- Preserve unrelated dirty work in the shared checkout.
- Do not log or fixture secrets, raw provider headers, contact identifiers, local paths, or personal identifiers.

Key decisions:
- Treat current hosted env as the hosted platform source of truth.
- Defer user-managed hosted assistant profile precedence until that product path exists explicitly.

State:
- Closed.

Done:
- Traced env forwarding, hosted bootstrap profile precedence, and assistant session target persistence.
- Patched hosted assistant bootstrap so any valid env profile upserts and activates `platform-default`.
- Added operator-config and assistant-runtime regression coverage for saved member profile promotion.
- Verified with focused package checks, scoped diff-aware verification, root typecheck, and diff checks.

Now:
- Close the plan and create a scoped commit if the shared dirty ledger allows a safe path.

Next:
- Production cleanup still needs manual reset of affected existing assistant session/runtime state.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: affected production users' existing assistant sessions will be reset manually rather than migrated by this code change.

Working set (files/ids/commands):
- `packages/operator-config/src/hosted-assistant-config.ts`
- `packages/operator-config/test/hosted-assistant-bootstrap.test.ts`
- `packages/assistant-runtime/test/hosted-assistant-bootstrap.test.ts`
- `agent-docs/exec-plans/completed/2026-04-26-hosted-assistant-platform-default.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
