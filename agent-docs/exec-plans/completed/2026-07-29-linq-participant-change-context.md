# Linq participant-change context

Status: completed
Started: 2026-07-29

## Outcome

When Linq reports that a participant was added to or removed from an existing
routed group, preserve a bounded, private description of that exact change for
Murph's next ordinary group turn. Include the provider-authenticated handle and
the group owner's optional unverified address-book label when that label is
authorized and available.

Participant changes remain context, not authored messages: they do not wake
Murph, create a mailbox item, send anything, or grant identity, membership,
consent, route, invite, or sharing authority.

## Scope

- Parse the documented Linq participant handle contract without persisting it
  in the provider-event ledger.
- Reuse the existing encrypted, bounded pending group-context owner on the
  routed thread.
- Stage additions and removals after provider-event deduplication.
- Preserve the existing anonymous addition bit as a fallback when detailed
  context cannot be staged.
- Render the pending text as weak group-event context on the next ordinary
  admitted group message.
- Update focused contracts, tests, architecture, security, reliability, and
  verification documentation.

## Verification

- Focused parser, webhook, route-store, hosted-execution, and assistant prompt
  tests.
- Canonical `pnpm test:diff ...`.
- `pnpm verify:acceptance`.
- Product-experience review, preliminary ReviewGPT prompt/coverage pass, final
  ReviewGPT gate, and exact-head CI.

## Progress

- [x] Recovered current `main`, prior participant-context history, and merged
  message-edit work.
- [x] Confirmed Linq's official participant event payload includes a full
  participant handle object for additions and removals.
- [x] Implement bounded participant-change staging and rendering.
- [x] Add regression coverage and update durable owner docs.
- [x] Complete focused tests, real-PostgreSQL concurrency coverage, signed
  hosted-local scenarios, canonical diff verification, and the full acceptance
  suite; resolve the preliminary product and ReviewGPT findings.
- [x] Open draft PR #1100 and prepare the final exact head for ReviewGPT and CI.
Updated: 2026-07-29
Completed: 2026-07-29
