# Respect intentional usage pauses in runtime progress alerts

Status: completed
Created: 2026-10-20

## Outcome and invariant

The progress monitor should distinguish an imported assistant notification held
by the current canonical usage allowance from actionable runtime failure. Keep
usage limits, durable mailbox contents, and model-free stall alerts unchanged.

## Owner and evidence

The monitor currently excludes usage-denied conversation heads only. The
reconciliation owner already permits deterministic system work while blocking
assistant execution. Synthetic proof will cover an imported assistant-owned
notification retained at the contiguous frontier while later device work runs.
Production observations remain private and are not copied into this artifact.

## Smallest change

Reuse the shared system-mailbox ownership classifier and the canonical read-only
usage gate. Check only fully imported assistant-notification heads, cap allowance
reads per scan, and retain alerts on unavailable decisions or exhausted budget.
Keep the exclusion as aggregate monitor diagnostics; add no schema, scheduler,
checkpoint state, acknowledgement, or execution authority.

## Verification and risks

- Prove allowance-denied notification suppression and re-alerting after allowance
  restoration through the real monitor entrypoint.
- Preserve deterministic notification/device heads, unknown or partial imports,
  invalid chronology, and allowance-read failures as alertable.
- Prove bounded serial allowance reads.
- Run focused unit and PostgreSQL monitor proof, Web typecheck, and diff review.
- Web-only rollout; no wire/schema changes or runner rollout required. Until
  deployed, the existing monitor can continue issuing the same reminders.
- Operator-only alert correction; no member-visible behavior or changelog entry.

## Progress

- Implementation and parent diff/privacy review complete.
- All 46 monitor unit tests and all 13 PostgreSQL monitor tests passed.
- The new PostgreSQL regression fails on the unpatched source with an erroneous
  stalled-system alert, and passes with the candidate.
- Web typecheck and complexity guard passed; maximum changed complexity is 16.
- A fresh isolated local database supplied current-schema proof; the older shared
  test database was unsuitable. No shared database schema was modified.
- Final ReviewGPT round 1 passed on candidate `6213e52803b8` with no qualifying
  findings. The accepted GPT-6 Pro review used the Hercules lane, full guarded
  snapshot, matching file/blob evidence, and an attested completed response above
  the required three-minute threshold. The earlier 126-second capture was rejected
  and did not count as a review round.
- Parent final review found no further changes necessary. The reviewer traced
  allowance, sponsorship, model-free ownership, delivery-only behavior, read
  bounds, and incident rearming; no runtime or contract changes follow review.
- Web, database, billing, viewport, and repository CI checks passed on the reviewed
  candidate; final-head CI remains the release gate after this documentation-only
  closure. Production deployment remains separate from local completion.
Updated: 2026-10-20
Completed: 2026-10-20
