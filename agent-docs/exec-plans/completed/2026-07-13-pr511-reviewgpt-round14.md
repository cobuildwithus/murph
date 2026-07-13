# PR 511 ReviewGPT Round 14 Fixes

## Goal

Resolve both accepted ReviewGPT round-fourteen findings for PR 511:

1. Bind each accepted conversation mailbox row to the exact AI-allowance
   period admitted in the append transaction, so overlapping historical
   periods cannot change replay gating or spend attribution.
2. Keep invalid or corrupt conversation mailbox rows nonterminal: stop the
   conversation lane without advancing its import watermark or synthesizing a
   consumed replay sequence.

## Constraints

- Reuse the existing mailbox row and usage-period owner; add no queue,
  scheduler, replay ledger, or lifecycle manager.
- Backfill a legacy row only when one existing allowance period uniquely
  contains its acceptance timestamp. Leave ambiguous or unproved rows null and
  fail closed for inactive replay.
- Preserve poison-item quarantine and forward progress for the system lane.
- Preserve current-access processing for ordinary invocations and exact-row
  replay authority for inactive invocations.

## Working Set

- `apps/web/prisma/schema.prisma` and one additive migration
- accepted-conversation mailbox append, replay gating, and usage accounting
- hosted mailbox store projections and focused web tests
- assistant-runtime mailbox import/replay selection and focused tests
- hosted runtime protocol documentation

## Verification Plan

- Prove new and duplicate accepted rows carry one exact period key.
- Prove overlapping periods cannot redirect replay gating or accounting and
  ambiguous legacy rows fail closed.
- Prove conversation route/payload/import failures do not advance or emit a
  consumed sequence, while system poison items still make progress.
- Run focused owner tests and typechecks, the required security/privacy and
  coverage-write audits, full diff-aware verification, a scoped commit and
  push, then repeat exact-head ReviewGPT until no accepted findings remain.

## Progress

- Bound accepted mailbox rows to an exact allowance-period start and threaded
  the paired acceptance sequence through replay usage callbacks.
- Made ambiguous legacy binding fail closed while allowing unique legacy rows
  to repair in the acceptance transaction.
- Kept nonterminal corrupt conversation rows pending without local watermark
  or synthesized consumed-floor progress; system poison handling still
  quarantines and advances.
- Restored terminal-local replay acknowledgement only when the exact freshly
  imported row has complete terminal evidence, without exposing it to the
  assistant again.
- Security/privacy audit: no evidence-backed medium-or-higher finding.
- Coverage-write audit: no remaining evidence-backed gap; added three
  fail-closed web proofs. The exact diff suite cleared the runtime regression
  and hit only a load-sensitive CLI timeout whose isolated file passed 8/8.
- Focused replay selection plus workspace entrypoint: 230/230 passed.
- Baseline integration follow-up: the four initially failing web files now
  pass 70/70 after updating test transaction fixtures and migration inventory.
- Full acceptance verification confirmed all 4,394 web tests and every
  Round-14 owner suite. Two unrelated package tests failed only under the
  repo-wide parallel load: the CLI workout file passed 23/23 in isolation and
  the setup-assistant wizard file passed 6/6 in isolation.
- Web, Cloudflare, assistant-runtime, hosted-execution, and generated Prisma
  typechecks passed; docs drift, diff whitespace, and identifier privacy scans
  passed.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
