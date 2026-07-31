# Group newsletter final-review remediation

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Close the final newsletter review findings without adding another queue,
  scheduler, retry owner, or persisted state.

## Success criteria

- A durable newsletter parent is reattached to canonical cron state after a
  restart or any post-write failure, before another provider turn can begin.
- Vault-share projections retain the open local date plus seven prior dates
  across timezone boundaries while remaining strictly bounded.
- Empty-edition composition never invents a cause, while later conversations
  may clearly report authorized current state.
- Focused tests, typechecks, exact-head CI, and correction-only ReviewGPT pass.

## Constraints

- Reuse only the existing outbox, canonical cron, projection, and prompt owners.
- Preserve Web-owned authorization, recipient fanout, bounded payloads, and
  generic outbox reconciliation.
- Keep production evidence and direct identifiers out of repository artifacts.

## Tasks

1. Derive a persisted newsletter parent from its occurrence-scoped outbox key
   before provider admission and after turn errors.
2. Retain eight date-keyed projection records with a calendar-safe cutoff and a
   request-body ceiling that admits exactly the legal bound.
3. Narrow empty-stat guidance to distinguish unknown historical cause from
   verified current permission or data availability.
4. Add focused restart, terminal settlement, timezone, integration, and prompt
   regressions.
5. Verify, close this plan with the remediation commit, push, and run
   correction-only ReviewGPT plus exact-head CI.

## Verification

- Focused assistant-engine newsletter, cron, prompt, and skill tests.
- Focused assistant-runtime projection, hosted-execution parser, and Web
  vault-share tests.
- Typecheck all four changed workspaces, run docs drift, and prove mergeability.
Completed: 2026-07-29
