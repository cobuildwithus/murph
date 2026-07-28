# Group Managed Automations

Last verified: 2026-07-26

## Purpose

This specification defines the ownership and execution boundary that lets
Murph-owned automations run in authenticated hosted group runtimes. No built-in
member-facing group social automation currently ships. The existing
`group-room-model` automation is silent internal maintenance.

## Managed ownership

Built-in managed automations have one immutable owner scope:

- `member` runs only in a personal/direct member runtime.
- `authenticated-group` runs only in a synthetic group runtime with a live,
  non-direct Linq/iMessage or Telegram route.

A built-in seed without an explicit scope defaults to `member`. Group email and
unsupported non-direct routes match neither owner. Caller-supplied custom seeds
with no scope retain their existing compatibility behavior; tags, slugs,
titles, and instructions never establish managed identity or hidden authority.

Dynamically generated experiment-lifecycle seeds retain their existing behavior
until their separately coordinated owner exposes an exact-identity resolver.
They must not be classified from tags, slugs, prompts, or broad casts.

## Reconciliation

Normal managed reconciliation installs only seeds whose exact owner scope
matches the current route. It archives every nonterminal built-in record whose
route no longer matches, including paused records; already archived records
remain archived.

The removed Sunday superlatives automation ID is a permanent retirement
tombstone. Normal reconciliation archives any persisted nonterminal record with
that exact ID. The tombstone is not a seed, schedule, prompt, activity policy,
or feature flag and cannot install an automation.

## Execution

A claimed static built-in occurrence must resolve by canonical `automationId`
to the current immutable seed. The live route must match the seed's owner
before lifecycle hooks, evidence reads, provider/model work, tools, or outbox
creation. The runtime rechecks that same authority before provider admission,
tools, delivery, and commit.

A claimed occurrence for a retired ID fails closed before lifecycle or model
work. Unknown IDs otherwise keep the existing user-authored automation
behavior; mutable automation fields cannot impersonate a current or retired
built-in.

The saved delivery route is only a hint. Live Web-owned group-route authority
must still resolve to the exact synthetic group runtime and non-direct
Linq/iMessage or Telegram route. Group email is excluded.

## Adding a future group automation

A future product feature may use this capability by adding a stable built-in
seed with `ownerScope: authenticated-group`. It should use the ordinary
scheduler and group delivery path unless a concrete feature requirement proves
another primitive necessary.

Feature-specific eligibility, evidence, identity, or participant-selection
rules belong with that feature and must be reviewed before it ships. They are
not part of the generic group-managed automation boundary.

## Current non-goals

- No Sunday superlatives seed, schedule, prompt, activity threshold, mailbox
  scan, evidence projection, control endpoint, or delivery behavior.
- No weekly participant call-out or random participant selection.
- No generic message-count policy, counter, scheduler, queue, cursor, or new
  durable state owner.
- No use of mutable automation metadata as policy authority.
- No compatibility migration for custom or dynamically generated automations.

## Verification

Coverage must prove:

- member seeds do not reconcile or execute on group routes;
- authenticated-group seeds do not reconcile or execute on direct routes;
- wrong-owner nonterminal records, including paused records, are archived;
- claimed built-ins revalidate exact current seed identity and live route at
  every authority-sensitive boundary;
- the retired Sunday ID is archived during reconciliation and cannot execute.
