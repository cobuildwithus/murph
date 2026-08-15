# Bound residual database read shapes

Status: completed
Created: 2026-08-11
Updated: 2026-08-12

## Goal

- Prevent bounded public, recovery, billing-replay, group-email, invite, and
  WHOOP workflows from scanning unrelated database history or graph rows before
  their application limits apply.

## Success criteria

- Every retained index matches a current predicate, join, and ordering path.
- Group-email and message-volume reads have migration-backed index contracts.
- Stripe completed-event replay uses receipt-owned exact activation pointers.
- Referral, preference, and WHOOP work starts from a narrow current owner or a
  query-aligned partial index, without creating a generic mailbox-lag
  scheduler.
- Focused unit/PostgreSQL tests, Prisma validation, typecheck, lint, migration
  checks, privacy checks, ReviewGPT review, and a clean scoped commit pass.

## Scope

- In scope: group-email/message-volume, Stripe replay, usage-referral,
  preference/vault handoff, and WHOOP query families; additive schema and
  concurrent/partial index migrations; exact owner pointers; focused proof.
- Out of scope: unrelated retention cleanup, runtime-log isolation, provider
  calls under transaction locks, broad index tuning, reverse-string indexes,
  and behavior already owned by open pull requests.

## Constraints

- Technical constraints: preserve authority, ordering, idempotency, retry, and
  mixed-deploy behavior; bound database work at maximum admitted cardinality;
  prefer existing owners and composite uniqueness over new lifecycle machinery.
- Product/process constraints: no user-visible behavior change; current-main
  base; ReviewGPT supplies attachment-based patch intent; draft publication is
  allowed, but do not merge or mark ready before all gates pass.

## Risks and mitigations

1. Risk: an index shifts write cost without removing a real scan.
   Mitigation: trace the exact query and require deterministic SQL shape or
   representative PostgreSQL plan proof before retaining it.
2. Risk: a new pointer becomes a second outcome owner or breaks mixed deploys.
   Mitigation: keep the existing receipt/owner row authoritative, make changes
   additive-first, and preserve a bounded legacy transition where required.
3. Risk: mailbox recovery broadens into a generic scheduler.
   Mitigation: seed each pass from the existing narrow owner fact and use only
   exact composite mailbox identities or pointers.

## Tasks

1. [complete] Trace current queries, schema, migrations, tests, and open-PR
   overlap.
2. [complete] Ask ReviewGPT for scoped patch attachments and inspect every
   hunk.
3. [complete] Implement query-aligned indexes and receipt/owner-based bounded
   reads.
4. [complete] Add deterministic migration/query contracts and focused behavior
   tests.
5. [complete] Finish the trusted ReviewGPT correction loop, inspect/redact
   the final diff, close the plan, and publish the closing plan commit.

## Decisions

- Keep this lane independent from the retention/runtime-log and hot-collection
  lanes; both confirmed they will avoid these files and behaviors.
- Do not use reverse or suffix-expression indexes for Stripe activation lookup.
- Treat indexes as rejected unless the current query can use their leading
  columns, predicate, and ordering.
- Exclude Linq invite-delivery reads because open PR #1642 owns that path.
- Reject fixed raw scan-factor caps for recurring recovery owners: without a
  durable cursor they can permanently starve valid work behind poison rows.
- Use the usage-referral row as the notification recovery owner and retain the
  mailbox item only as an exact composite join target.
- Reuse the canonical seven-day participant lease and 14-day mailbox live-row
  floor before the handoff recovery limit so expired structural owners cannot
  starve current work.
- Retain all nine new indexes because representative PostgreSQL plans use their
  leading columns, predicates, and ordering under realistic bounded query
  shapes.
- Treat simultaneous new-member WHOOP over-admission as unchanged base
  behavior: the series preserves the existing start-time admission point,
  bounds its membership read, and fixes a rejecting-path reconnect race without
  adding speculative reservation state.

## Verification

- Focused Web suites pass across group/email volume, WHOOP capacity, referral
  and handoff recovery, Stripe activation replay, legacy trial replay, and
  webhook reconciliation. The correction-only handoff tests and production
  migration guard also pass.
- Web typecheck, prepared typecheck, scoped lint, Prisma schema validation,
  documentation drift, hosted billing guards, diff checks, and privacy checks
  pass.
- A fresh disposable PostgreSQL database applied all migrations. Every new
  index was valid and ready, and representative bounded queries selected the
  intended index under the ordinary planner. The disposable database was
  removed after proof.
- ReviewGPT findings for Stripe retry pointers, split-read WHOOP false
  rejection, referral PostgreSQL fixtures, legacy trial replay, and two
  pre-limit handoff starvation paths are corrected and focused-tested.
- Final ReviewGPT round 1 returned an attested terminal pass on the immutable
  first-reviewed production head after more than 30 minutes in the exact
  existing thread. It revalidated the complete finding/disposition ledger and
  found no qualifying production defect. Later changes are isolated tests and
  explanatory documentation, so they require focused proof and exact-head CI,
  not another substantive final round.
- The preliminary coverage specialist accepted two proof gaps. Current-schema
  Family replay now proves ordered persistence and the maximum six-pointer
  sequential wake path in one mailbox query without a Stripe refetch. A fresh
  182-migration PostgreSQL database executed the production preference-handoff
  sweep and canonical access recheck, proving that two expired participant
  leases or two retention-old Clinical Records rows cannot consume the bounded
  page ahead of a live candidate. The disposable database was removed.
- Exact-head pull-request CI passed the full Web verification, build/typecheck,
  release package coverage, CLI host, billing, layout, fixture, artifact,
  frontend, and deployment gates after the coverage-only corrections.
Completed: 2026-08-12
