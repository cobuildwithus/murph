# Preserve foreground admission through background checkpoint completion

Status: active
Created: 2026-09-13
Updated: 2026-09-13

## Goal

Preserve prompt conversation admission when a foreground wake races independent
system-work completion or a checkpoint. Keep PR #3090's workspace-owned imports
concurrent with assistant turns and retain canonical publication authority.

## Outcome and protected invariants

- Outcome: existing foreground replies do not depend on a second wake.
- Reaches: warm background owners, checkpoint completion, empty hints, blocked
  assistant execution, and imports overlapping multiple foreground turns.
- Proof: deterministic completion/wake races and composed runtime admission,
  delivery, retained background work, and recovery scenarios.

## Owner and evidence

The workspace system-work owner owns independent attempts; runtime wake signals
are hints and the canonical mailbox owns accepted input. Investigate these owners
and checkpoint return ordering before selecting the patch. Production observations
identify the handoff boundary but do not prove a specific source branch. Keep all
production identifiers, rows, and exact private scenarios out of artifacts.

## Scope and approach

1. Review PR #3090 and current wake/checkpoint owners.
2. Reproduce a lost or delayed foreground wake with synthetic deterministic proof.
3. Reorder or preserve existing observations at the smallest owner boundary;
   add no queue, scheduler, persistent state, or authority bypass.
4. Cover completion races, empty hints, failure/shutdown, checkpoint admission,
   and continued device imports. Run affected typecheck and complexity checks.
5. Review the full candidate, update the durable contract and changelog if needed,
   complete applicable external review, and commit the scoped result.

## Risks and mitigation

A wake is not authorization: qualification must still use the existing mailbox
and access checks. Foreground preemption must not discard committed background
work or cancel a download at every reply. Checkpoints keep canonical receipt and
fence ownership. No protocol or stored-format change is planned; unchanged
consumers remain compatible. Production deployment is separate from local proof.

## Verification

- Before: the composed promotion test reached the assistant without importing
  its qualified conversation. Both completion-race cases dropped their wake.
- After: promotion during device completion and checkpointing consumes its
  existing batch before assistant admission, with one qualifying conversation
  fetch. Completion success, empty hints, and failure retain/qualify wakes.
- Runtime proof: five focused suites cover 216 cases. The first run passed 214
  and exposed two older fixtures that prohibited conversation import; both now
  require real input staging before their foreground sentinel. Their complete
  32-case system-preemption suite passes. The other four suites passed unchanged.
- Runtime typecheck and complexity guard pass. Runtime debt remains unchanged;
  the independent owner remains below the complexity threshold (maximum 18).
- Changelog rendering (10 cases), Web typecheck, docs drift, and docs gardening
  pass. Parent candidate review passes privacy, ownership, failure, and scope
  checks. Pending: applicable final review and exact-head CI. No model behavior,
  prompt, tools, or reply policy
  changed; deterministic admission and composed provider-shaped delivery are
  the direct proof for this scheduling correction.
- Known tooling friction reused: documented app-local changelog Vitest invocation
  selects no files; the repository-root equivalent owns discovery. Existing Frog
  entries cover this issue; no duplicate was created.

## Findings and decisions

- PR #3090 intentionally permits workspace-owned independent imports to overlap
  conversations. A fresh foreground wake must not await those imports.

- Confirmed source cause: the foreground promotion prefetch introduced in PR
  #3090 was stored but never passed to the first foreground pass. That pass
  reused the initial system-only import. The correction passes the qualified
  batch through the existing importer and leaves subsequent reads unchanged.
- An independent completion/wake race also consumed a notification without
  qualification. The existing waiter now joins its delivery and retains it on
  completion failure. It adds no external I/O or persisted state.
