# Retire exact export packs after successful generated ZIP delivery

Status: active
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- After a generated ZIP is confirmed sent, retire only the exact unchanged
  derived export packs that the ZIP creator explicitly identified as included.
- Keep the delivery journey unchanged and make missed cleanup harmless residue,
  not a second delivery or maintenance state machine.

## Success criteria

- `send_vault_file` can attach a bounded list of included export-pack ids only
  to an assistant-generated ZIP.
- The host replaces available matching ids with manifest receipts before
  persisting the delivery, skips invalid cleanup claims without blocking the
  attachment, and later refuses a pack whose generation changed.
- A successful outbox transition attempts the existing export-pack removal
  operation; failed, denied, expired, or unsent deliveries leave packs intact.
- Cleanup failure never changes a persisted successful delivery, triggers a
  resend, or adds durable retry work.
- The implementation adds no ZIP reader, scheduler, daemon owner, lock service,
  receipt file, cursor, queue, or restart recovery path.
- Focused tests, package typechecks, exact-head ReviewGPT, and required CI pass.

## Scope

- In scope: the generated-file tool contract, its existing outbox media record,
  one export-pack manifest receipt/removal seam, post-success cleanup, focused
  contract and behavior tests, and the matching durable vault contract.
- Out of scope: inspecting arbitrary ZIPs, deleting generic `exports/**`,
  background convergence, crash recovery, cross-process serialization, or
  changing delivery approval/retry behavior.

## Constraints

- Technical constraints: only path-safe pack ids under the reserved
  `exports/packs/<packId>/` subtree qualify; the current manifest must still
  match the receipt captured before approval; cleanup is bounded and best
  effort after durable `sent` persistence.
- Product/process constraints: preserve the existing request, approval,
  attachment, and delivery UX; keep the source diff proportional; use the
  worktree/PR lane, preliminary specialist ReviewGPT, final ReviewGPT, and
  exact-head CI.

## Risks and mitigations

1. Risk: model-supplied ids name packs that were not included in the ZIP.
   Mitigation: expose this field only for generated ZIPs, describe it as an
   exact inclusion claim, validate ids at the host boundary, and limit deletion
   to the already-derived reserved pack subtree.
2. Risk: a same-id pack is rebuilt while approval or delivery is pending.
   Mitigation: persist the pre-approval manifest SHA-256 and refuse cleanup when
   the live manifest changed.
3. Risk: optional deletion fails after provider success.
   Mitigation: persist `sent` first, contain cleanup failure, and deliberately
   accept leftover derived files instead of retry/recovery machinery.
4. Risk: an unavailable or mismatched optional claim blocks the primary send.
   Mitigation: omit that claim from persisted receipts and continue approval;
   malformed tool input remains a hard boundary error.
5. Risk: ReviewGPT expands the mechanism back into the old architecture.
   Mitigation: accept only findings with a concrete current invariant break and
   prefer refusal or harmless residue over locks, replay, or new state owners.
6. Risk: private cleanup receipts cross the strict hosted provider boundary.
   Mitigation: project vault-file media onto transport fields only; the original
   outbox intent remains the sole cleanup-authority owner.

## Tasks

1. Trace and document the minimal creation-to-delivery ownership contract.
2. Add the manifest receipt/removal seam and generated-ZIP tool metadata.
3. Invoke bounded best-effort cleanup after durable `sent` persistence.
4. Add focused success, refusal, mutation, and non-success tests.
5. Run focused verification and inspect source/test/docs line shape.
6. Commit, push, open the replacement PR, and complete ReviewGPT plus CI.

## Decisions

- Deletion authority is declared when the ZIP is handed to `send_vault_file`,
  rather than inferred later by parsing archive bytes.
- The cleanup receipt lives on the existing vault-file media record, so approval
  and retry naturally preserve it without another persisted owner.
- Hosted side effects deliberately omit the receipt. Provider delivery needs
  transport fields only and re-reads the original intent for local cleanup.
- Restart recovery is intentionally absent. A crash can leave regenerable
  derived residue; it cannot lose the delivered attachment or canonical data.
- Manifest identity is the proportional stale-generation guard. This change
  does not introduce a stronger concurrency system than explicit pack pruning
  already has.

## Verification

- Commands to run: focused assistant vault-file/outbox tests, focused
  vault-usecases and CLI export-pack tests, affected package typechecks,
  `git diff --check`, exact-head ReviewGPT, and required GitHub Actions.
- Expected outcomes: only a confirmed generated ZIP send removes unchanged
  claimed packs; changed or non-success cases retain them; all checks pass with
  no unresolved accepted review finding.
