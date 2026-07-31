# Group recovery terminal-failure remediation

Goal (incl. success criteria):
- Fix the accepted ReviewGPT round-3 finding where a provider-correlated
  terminal failure permanently consumed a group-line recovery identity.
- Keep exact webhook replays at one provider attempt while allowing a genuinely
  new member intro to use a fresh attempt after terminal failure.
- Preserve tuple-wide convergence while any attempt is live or successful.

Constraints/Assumptions:
- Reuse `HostedLinqDelivery`, the existing transport transaction, provider
  idempotency, and the existing finite-attempt pattern.
- Add no schema, queue, cron, state machine, retry owner, or reconciliation.
- Keep current authority, participant, assignment, line-health, and capacity
  revalidation at provider dispatch.
- Keep raw contacts, group identifiers, and provider prose out of durable
  diagnostics and public artifacts.

Key decisions:
- Give one broken-group identity a small finite sequence of delivery attempt
  keys, selected only after a provider-correlated terminal failure.
- Persist only safe digests for the broken-group and source-event identities so
  the same event cannot advance twice; revalidate participant identity live.
- Treat any nonterminal or successful attempt as the tuple-wide convergence
  point; only a different source event may advance past terminal failure.

State:
- ReviewGPT round 3 produced one accepted material UX finding.
- Static inspection confirmed the terminal receipt retains provider correlation
  while the prior transport returned `already_completed`.
- The existing delivery/transport owners now use five explicit indexed attempt
  keys. Exact event replays cannot advance, a new event can advance only after
  a provider-correlated terminal failure, and any live or successful attempt
  converges the broken-group identity.
- Direct transport regressions cover source-event identity, live/success
  convergence, participant identity, assignment, line health, and capacity.
- Verification passed:
  - focused seven-file Vitest selection: 293 tests
  - Web TypeScript typecheck
  - Web lint: 0 errors (22 unrelated pre-existing warnings)
  - canonical `pnpm test:diff` through Crabbox
  - canonical `pnpm verify:acceptance` through Crabbox

Open questions (UNCONFIRMED if needed):
- None.

Working set (expected):
- `apps/web/src/lib/hosted-onboarding/linq-group-line-recovery.ts`
- `apps/web/src/lib/hosted-onboarding/linq-delivery-store.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-transport.ts`
- focused Linq recovery tests
- user-facing messaging protocol docs if the delivery invariant changes
- this plan

Status: completed
Updated: 2026-07-29
Completed: 2026-07-29
