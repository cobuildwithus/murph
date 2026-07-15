# Single-member Pulse Trial extension

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Replace the expired July Pulse Trial campaign workflow with one operator tool
  that previews and adds seven trial days for an explicitly entered member ID.

## Success criteria

- `/ops/trials` contains one member-ID form and one result table, with no fixed
  cohort, provider sweep, batch pagination, cutoff, campaign key, or cleanup
  action.
- Preview reads the member's current local and Stripe subscription state and
  shows the exact seven-day change before Apply is enabled.
- Apply rejects stale previews, serializes against other billing mutations, and
  extends either a live Pulse Trial from its current end or a lapsed paused
  Pulse Trial for seven days from Preview without charging the member.
- Paid, canceled, incomplete, mismatched, or non-Pulse subscriptions are shown
  as ineligible and never mutated.
- Provider and local trial windows reconcile in the same locked operation, and
  a retried Apply does not add another seven days.

## Scope

- In scope: the hosted ops trial extension service and route, the `/ops/trials`
  client, focused route/service/UI tests, and current ops documentation.
- Out of scope: automatic cohort processing, provider-wide subscription search
  or cleanup, changing trial enrollment/conversion policy, bulk extension, and
  database schema changes.

## Constraints

- Stripe remains authoritative for subscription identity, status, price, and
  trial end.
- Preserve current paid billing and the one-subscription owner invariant.
- Reuse the existing hosted member Stripe mutation lock and contact-privacy
  keyring; add no new database state, scheduler, queue, dependency, or config.
- Keep provider identifiers out of the client-visible preview payload and logs.

## Risks and mitigations

1. Risk: reviving a paused subscription could create an invoice.
   Mitigation: use Stripe's existing-subscription trial update with
   `proration_behavior: none`; require the returned state to be `trialing` at
   the exact target end before local access is restored.
2. Risk: an operator could Apply after billing changed since Preview.
   Mitigation: carry one short-lived signed preview proof and re-read both
   local and Stripe state under the member billing mutation lock.
3. Risk: a timeout after Stripe succeeds could add seven more days on retry.
   Mitigation: derive one idempotent operation key from the previewed state,
   mark the resulting subscription with that key, and reconcile an already
   applied provider result instead of extending it again.

## Tasks

1. Replace the campaign service with member-scoped eligibility, signed
   preview proof, locked provider mutation, and local reconciliation.
2. Narrow the route body and response to one member ID and one Preview/Apply.
3. Replace both campaign cards with one existing-component form and result
   table.
4. Replace campaign tests and documentation with lapsed/live/paid/stale/retry
   coverage and single-member operator instructions.
5. Run focused and routed verification, required frontend and coverage audits,
   then finish the plan with a scoped commit and exact-head PR gates.

## Decisions

- A live `trialing` subscription extends from its current provider trial end.
- A lapsed `paused` subscription receives seven days from Preview time, because
  extending its historical end would not restore seven usable days. The proof
  expires after 15 minutes so the displayed window remains accurate.
- Other provider statuses are ineligible. In particular, `active` is not
  converted back to a trial because it may represent paid billing.
- Keep Preview as a required safety step, but reduce its proof to one opaque
  member-scoped token rather than campaign snapshots and continuation tokens.

## Verification

- Focused service, route, and client Vitest: 3 files and 26 tests passed.
- `pnpm test:diff` selected the complete hosted-web verifier: dependency and
  architecture guards, TypeScript, dev smoke, lint, 5,032 tests, and the
  production Next build passed. Lint retained 13 unrelated warnings and no
  errors.
- `git diff --check`, stale campaign-surface search, and identifier scan passed.
- Required `coverage-write` completed with added live/lapsed, non-mutation,
  proof, lock, provider-failure, reconciliation, and route coverage.
- Required `frontend-review` findings were fixed and re-reviewed to closure:
  pending member identity is locked, stale results are rejected, result updates
  are announced, and unchecked provider state is labeled accurately.
- Isolated frontend startup and hosted-local worktree doctor passed. Desktop and
  mobile screenshots were unavailable because the browser controller reported
  no connected browser backend. Full hosted-local startup was independently
  blocked by the assistant-engine CLI-manifest timeout before the web app began.
- After the exact pushed PR head exists, start ReviewGPT concurrently with CI
  and resolve every substantive finding.
Completed: 2026-07-14
