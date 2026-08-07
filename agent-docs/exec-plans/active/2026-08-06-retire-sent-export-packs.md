# retire-sent-export-packs

Status: active
Created: 2026-08-06
Updated: 2026-08-07

## Goal

- Retire derived `exports/packs/<packId>/` residue only after a generated ZIP
  containing that exact pack has been delivered successfully.

## Success criteria

- A terminal generated ZIP send derives the exact valid export packs contained
  in the archive without trusting its filename or generic `exports/**` paths.
- Active, denied, expired, failed, missing, malformed, or changed deliveries
  never remove an export pack.
- A terminal successful send removes only unchanged, manifest-valid derived
  pack directories and continues to use the existing generated-delivery
  cleanup lifecycle.
- An active direct-file outbox obligation at or beneath a pack defers removal,
  and intent persistence cannot race behind a completed pack deletion.
- Retirement is bounded and abortable, retains the terminal ZIP while work
  remains, and visits each archive and pack once per sweep so an earlier
  deferred item cannot starve later eligible work.
- Hosted idle cleanup and one ephemeral assistantd maintenance owner recover
  sent export-pack work without running optional archive inspection on the
  serial send or request-result paths.
- Assistantd cleanup is coalesced, starts only after the listener, yields to
  authenticated foreground requests, and resumes after request completion and
  outbox drains without persisted cursor state.
- Existing generated delivery retry, approval, checkpoint, and cleanup
  behavior remains unchanged for other files.
- Focused proof, exact-head ReviewGPT passes, and required CI complete with no
  unresolved accepted findings.

## Scope

- In scope: generated ZIP inspection, runtime-derived retirement proof,
  generated-delivery cleanup, focused tests, and the durable vault/security
  contract.
- Out of scope: deleting arbitrary ZIPs, user-owned files, generic
  `exports/**`, canonical vault data, changing export-pack creation semantics,
  or introducing a second cleanup service.

## Constraints

- Deletion authority must come from the exact delivered archive, a valid pack
  manifest, and unchanged live bytes; extensions and path shape alone are
  insufficient.
- Cleanup must fail closed on malformed archives, symlinks, inventory
  disagreement, changed bytes, or non-terminal delivery state.
- Reuse the generated-delivery staging, outbox terminal state, and quiescent
  residue pass without adding persisted state.

## Risks and mitigations

1. Risk: archive-controlled paths authorize deletion outside the derived pack
   root. Mitigation: accept only normalized `exports/packs/<safe-id>/` entries,
   reject traversal and nested ids, and resolve every path through the vault
   boundary.
2. Risk: a pack changes between delivery and cleanup. Mitigation: derive exact
   file receipts from the hash-bound sent archive and require an identical
   symlink-free live inventory immediately before removal.
3. Risk: denied or failed delivery removes the only prepared artifact.
   Mitigation: require a trusted outbox record with terminal `sent` state for
   the exact generated archive ref.
4. Risk: retirement adds a competing lifecycle. Mitigation: derive proof from
   the existing sent attachment and retry only inside the existing quiescent
   generated-delivery owner; add no queue, cursor, receipt file, or schema
   version.
5. Risk: ordinary terminal-outbox retention removes the only cleanup authority
   before a deferred pack converges. Mitigation: retain an exact sent ZIP
   intent while its staged archive ref still exists, then return it to ordinary
   age and count pruning after the archive is removed.

## Tasks

1. [completed] Prove the current generated ZIP, outbox, and export-pack
   ownership paths and define the narrow retirement proof.
2. [completed] Implement bounded ZIP pack discovery from the sent attachment.
3. [completed] Extend terminal generated-delivery cleanup with unchanged-pack
   retirement and fail-closed checks.
4. [completed] Add focused success, retry, refusal, mutation, archive, and path
   safety proof; update durable contracts.
5. [completed] Resolve preliminary ReviewGPT recovery and coverage findings.
6. [completed] Resolve final ReviewGPT round 1 active-ownership,
   interruptibility, continuation-evidence, and shared-ZIP-owner findings.
7. [completed] Resolve final ReviewGPT round 2 archive starvation, local
   continuation, authority-retention, and complexity findings with one
   quiescent owner.
8. [completed] Resolve final ReviewGPT round 3 cross-archive starvation and
   local-owner findings with a one-snapshot sweep and one coalesced assistantd
   maintenance task.
9. [completed] Resolve final ReviewGPT round 4 materialization/prune locking
   and permanent oversized-pack deferral findings.
10. [completed] Resolve final ReviewGPT round 5 physical-directory alias and
    external reconstruction lock-scope findings.
11. [completed] Resolve final ReviewGPT round 6 stale same-ID generation
    publication during unlocked reconstruction.
12. [completed] Resolve final ReviewGPT round 7 same-manifest completion and
    case-only active-file ownership findings.
13. [completed] Resolve final ReviewGPT round 8 case-aware outbox creation and
    complete external stored-pack lock-scope findings.
14. [in progress] Resolve final ReviewGPT round 9 intermediate-generation
    admission during complete external stored-pack reads; then push the exact
    remediation head and complete final ReviewGPT plus exact-head CI.

## Verification

- `pnpm --dir packages/operator-config exec vitest run test/assistant-cli-contracts.test.ts`
- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-generated-export-pack-retirement.test.ts test/assistant-runtime-residue.test.ts test/assistant-vault-file-send.test.ts`
- `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-invocation-bridge.test.ts`
- `pnpm --dir packages/operator-config typecheck`
- `pnpm --dir packages/core typecheck`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/assistant-runtime typecheck`
- `git diff --check HEAD`
- Real-archive compatibility: the bounded reader matched one exact live pack
  after extracting only the pack into a temporary proof vault; the temporary
  copy was removed and the source archive remained unchanged.
- Shared ZIP integration-ingest and cancellation tests; active direct-file
  ownership, deletion/persistence ordering, 21-pack continuation, and abort
  recovery tests.
- Focused quiescent-owner proof covers missing and unsafe earlier archives,
  stale, terminally oversized, and active earlier pack candidates, cross-archive
  progress, terminal-authority retention, authenticated request preemption,
  outbox-drain recovery, coalescing, shutdown, and abort recovery.
- Physical-identity helper, integrated alias, and external reconstruction lock
  scope tests; typechecks for `vault-usecases`, `assistant-engine`, and CLI.
- Same-ID newer-generation interleaving rejects the stale canonical rebuild and
  preserves every newer pack file; missing-pack retirement still cannot be
  resurrected and physically distinct external reconstruction remains lock-free.
- Same-manifest reconstruction interleaving refuses to overwrite a complete
  newer pack, and case-aware ownership covers both comparison policies plus a
  real mixed-case direct-file lifecycle on a case-insensitive vault.
- Fully case-varied direct pack-file creation revalidates under the selected
  vault's case policy after a concurrent deletion wins the shared lock.
- Complete external stored-pack reads do not hold the assistant runtime lock,
  reject a concurrent canonical change, and leave the destination untouched.
- Manifest-first canonical publication cannot expose a stable intermediate
  generation to an external copy because both metadata boundaries share the
  writer lock while payload transfer remains outside it.
- Exact-head CI passed at the round 9 candidate head.
- Pending final round 10 ReviewGPT and exact-head CI.
