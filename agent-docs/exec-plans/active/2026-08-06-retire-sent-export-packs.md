# retire-sent-export-packs

Status: active
Created: 2026-08-06
Updated: 2026-08-06

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
- Hosted checkpointing and local assistant-daemon startup both recover a sent
  export pack whose immediate best-effort retirement was interrupted.
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
   the existing sent attachment and retry only inside the existing hosted
   checkpoint and local-daemon startup residue pass; add no queue, receipt
   file, or schema version.

## Tasks

1. [completed] Prove the current generated ZIP, outbox, and export-pack
   ownership paths and define the narrow retirement proof.
2. [completed] Implement bounded ZIP pack discovery from the sent attachment.
3. [completed] Extend terminal generated-delivery cleanup with unchanged-pack
   retirement and fail-closed checks.
4. [completed] Add focused success, retry, refusal, mutation, archive, and path
   safety proof; update durable contracts.
5. [completed] Run focused verification and parent candidate review.
6. [in progress] Resolve accepted preliminary ReviewGPT findings, push the
   remediation, and complete final ReviewGPT plus exact-head CI.

## Verification

- `pnpm --dir packages/operator-config exec vitest run test/assistant-cli-contracts.test.ts`
- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-generated-export-pack-retirement.test.ts test/assistant-runtime-residue.test.ts test/assistant-vault-file-send.test.ts`
- `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-invocation-bridge.test.ts`
- `pnpm --dir packages/operator-config typecheck`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/assistant-runtime typecheck`
- `git diff --check HEAD`
- Real-archive compatibility: the bounded reader matched one exact live pack
  after extracting only the pack into a temporary proof vault; the temporary
  copy was removed and the source archive remained unchanged.
- Pending final exact-head ReviewGPT and CI.
