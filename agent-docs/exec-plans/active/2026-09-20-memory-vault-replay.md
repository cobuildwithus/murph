# Memory maintenance replay and spare profile space

## Outcome

Verify the shipped maintenance builders against an authorized isolated export,
then add synthetic conversation evidence to prove useful edits, factual fidelity,
replay, and subsequent personalization. Private data remains outside tracked
files and public evidence.

## Proven gap and smallest fix

Fixed per-section reservations can omit an entire section whose first record
exceeds its reservation even when every record fits the total budget. First
honor the existing reservations, then reuse spare bytes for whole records while
preserving each section's newest-first prefix. No new state or dependencies.

The dense live replay also skipped wording-only cleanup after handling recent
conversation changes. The managed policy now explicitly finishes the review of
remaining records after those writes, and distinguishes duplicate additions from
cleanup of repeated wording.

A dense follow-up reply also ignored a saved response format under the generic
one-next-step guidance. Limit optional follow-ups, while explicitly applying
relevant saved formats to the requested answer itself.

A subsequent private replay retained an explicitly withdrawn temporary fact as
a negative history note. The seed now limits date preservation to wording-only
compaction and explicitly forgets clear withdrawals without a useful replacement,
matching the existing authoritative maintenance rule.

## Verification

- Reproduce spare-space omission with independent synthetic records before fix.
- Run current-state and maintenance boundary tests, typecheck, and complexity.
- Live Codex: unmodified exported history, synthetic corrections/withdrawals,
  faithful compaction, explicit helping preference, no unrelated changes, replay,
  and a fresh conversation using the preference.
- ReviewGPT after the final source head is pushed, concurrently with required CI.

## Product UX

Record Ready/Hold from actual live effects and replies; do not force a mutation
when the evidence contains no durable new information. Preserve whole facts,
conditions, dates, uncertainty, canonical authority, and silent maintenance.

## Evidence so far

- Original exported conversation window: two silent read-only maintenance passes;
  no supported new durable facts. Private data stays outside public artifacts.
- Spare-space regression failed before the fix and passes afterward. The profile
  includes all available records when their complete text fits the total budget.
- Private export plus synthetic conversation: Ready on gpt-5.6-terra through local
  subscription. One show, two exact-version updates, one explicit withdrawal,
  and one procedural addition; unrelated canonical fields unchanged. A replay
  performs show only. Fresh reply uses the two-option procedure without tools.
- The permanent live regression adds independent synthetic baseline records so
  preservation and cleanup remain covered with a dense memory document.
- Earlier dense replays missed compaction; the final policy completes both
  reconciliation and cleanup. Assertions retain required effect counts.
- Corrected an incidental word-form assertion to accept both choose and choosing;
  exact effects, replay stability, and the two-option final reply remain required.
- Fixed a test comparison to exclude derived sourceLine offsets: inserting a
  record moves later lines without changing their canonical facts or timestamps.

- Final local proof: 293 focused tests, assistant typecheck, complete private/group
  provider-input capture, complexity guard, and docs checks pass. Both the dense
  synthetic live journey and private export replay are Ready on the final policy.
- Review and required exact-head CI remain pending on the follow-up candidate.

Status: active
