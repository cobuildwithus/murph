# Rename legacy meal dish names through hosted vault writes

Status: active
Created: 2026-11-02
Updated: 2026-11-02

## Outcome and invariants

Existing Meals show short natural dish names. Preserve the original description in
notes and preserve nutrition, occurrence, attachments and identity. Canonical vault
events remain authoritative; the ordinary checkpoint refreshes projections.

## Evidence and owners

The CLI validator currently checks length and prefixes only; title edits bypass it.
The legacy projection cleanup never writes canonical titles. Extend the shared
contracts naming policy, canonical add and event-edit boundaries, the hosted member
action consumer and the existing Ops admission and encrypted mailbox owners.

## Implementation and state

Use a fixed one-time, Ops-gated meal-name repair action, bounded per invocation.
The existing mailbox owns acceptance, retries and checkpointed outcomes. Portable
runtime operation progress owns resume cursors and counts, never meal truth. A
model leaf receives only a meal name and note and has no tools or delivery rights.
Validate its proposed name before a revision-checked canonical update. Preserve
old name details mechanically in the note. No new provider, queue or health table.

## UX journeys and proof

- Legacy ingredient lists, long titles, prefixes and place labels become short
  dish names; notes retain their details.
- Already valid names remain unchanged. Invalid proposals and concurrent edits
  are skipped without other field changes. Restart/replay preserves counts.
- Typed, photo, edit and post-question writes share deterministic validation.
- Deterministic policy, canonical preservation, replay and Ops authorization tests;
  relevant typechecks; one focused synthetic real-model journey on gpt-6.1-sol.
- Parent review, ReviewGPT concurrent with exact-head CI, merge, Web/runtime deploy.
- Run owner first and verify Meals API, then bounded member batches. Report counts
  only. No member messages or private content in logs, source or PR evidence.

## Deployment and removal

Deploy compatible Web readers before the runtime consumer; do not enqueue the new
action until both deployed versions are verified. Remove the temporary Ops/job
entrypoints after all eligible members have terminal counts and verification.
Preserve the shared naming policy. No force pushes or unrelated photo edits.

## Progress

- Clean supplied branch confirmed at origin/main. Its checkout failed storage
  admission; the sanctioned helper created an authorized task checkout from the
  primary repository. Dependencies installed there successfully.
- Shared detector/validator covers named add/import and canonical title edits;
  unnamed raw attachment intake retains its existing review placeholder.
- Ops-only encrypted member actions reuse hosted scheduling/checkpoints. Five
  model proposals and 100 scanned records per batch; portable progress handles
  retry, checkpoint replay and conflicting edits. Original detail stays in notes.
- Deterministic naming, write-path, canonical preservation/projection, restart,
  conflict and Ops/client-scope checks passed. Focused live gpt-6.1-sol journey:
  five tool-free proposals, five valid natural dish names. Product UX: Ready.
- Relevant typechecks and complexity guard passed. Candidate review found no
  unaddressed state-owner or privacy changes. Existing auth preflight succeeded.
- External review, exact-head CI, merge, deploy and count-only execution pending.
