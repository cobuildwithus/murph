# Physical-Note Recovery Resolution

## Goal

Restore the existing physical-note recovery promise so an explicit recovery
request can reconcile an aged unresolved send through Lob instead of remaining
permanently pending because the provider lookup request is malformed.

## Evidence

- Production control data shows one aged unresolved legacy note, later requests
  blocked behind it, and repeated explicit recovery results that stayed pending
  without a retry time.
- The Web recovery service is already designed to clear an aged proven absence
  atomically with its blockers and stored recovery result.
- Murph hand-builds a bracket-style metadata query in Axios request options,
  while the pinned Lob SDK exposes metadata as the list operation's typed
  metadata argument and serializes that object for the documented `metadata`
  query parameter. Provider failures are deliberately mapped to indeterminate,
  so the malformed request becomes an endless safe-pending result.

## Constraints

- Recovery must never create or recall a provider effect.
- Recent or genuinely indeterminate evidence remains pending; only accepted or
  aged proven-absence evidence may terminalize the guard.
- Keep the Web-owned member lock, atomic note/blocker/recovery settlement, and
  accepted-message authority unchanged.
- Keep private member, feedback, provider, and row identifiers out of repository
  artifacts and review evidence.

## Product UX

- Effort: Patch.
- Outcome: A member asking to resolve an older uncertain physical note receives
  an accepted or clear outcome when Lob has conclusive evidence, instead of a
  permanent pending loop caused by Murph's request shape.
- Reaches: Existing private-direct and authenticated-group recovery journeys
  with an aged unresolved note and a later blocked send.
- Proof: A provider-faithful request-shape regression plus the existing aged-
  absence service and PostgreSQL atomicity scenarios.

## Plan

1. Route Lob metadata lookup through the pinned SDK's typed metadata argument.
2. Update the provider request-shape regression to the SDK/API-owned encoding.
3. Run the focused Lob runtime, physical-note service, and applicable
   PostgreSQL/typecheck proof.
4. Replay the affected Product UX journeys, complete required review gates,
   and ship the scoped PR candidate.

## Verification

- Lob runtime and physical-note service: 109 focused tests pass.
- PostgreSQL recovery atomicity: the focused aged-absence scenario passes.
- Web typecheck passes.
- Changelog generation and the 9-test archive rendering suite pass.
- ReviewGPT Product UX/coverage specialists pass with no findings and no patch
  artifact; the Product UX verdict is Ready.
- ReviewGPT final round 1 passes with no findings.
- Candidate CI reached 17 passing checks. One unchanged Cloudflare timeout test
  failed only under full-suite load and passed three consecutive focused local
  reproductions; its narrow rerun was requested. Final exact-head CI follows
  the documentation-only plan-closure commit.
Status: completed
Updated: 2026-08-26
Completed: 2026-08-26
