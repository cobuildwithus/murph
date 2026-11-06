# Start attachment turns before remote persistence

Status: completed
Created: 2026-09-16
Updated: 2026-09-16

## Goal and evidence

Admit a downloaded, locally prepared attachment to Codex without awaiting remote
media and receipt uploads. Codex consumes local files; the shared hosted inbox
importer currently waits for backup and rolls back local files on upload failure.
Remote attachment backup is best effort, as authorized for this task.

## Design and protected boundaries

Keep local writes and evidence in their current owners. Defer only mailbox
attachment capture backup. Retain the existing canonical lock during backup to
preserve receipt order against later canonical writes. Track completion through
the existing runtime drain; add no queue, schema, or dependency. Backup failure
leaves the local capture intact for a later snapshot. Process loss before backup
and checkpoint can lose this copy. Delivery and other canonical writes retain
their existing guarantees. Wire formats stay unchanged across version skew.

## Product UX

- Outcome: begin interpreting an attachment as soon as it is locally usable.
- Reaches: shared Telegram and Linq/iMessage mailbox path, images and files.
- Proof: hold an upload pending and reach assistant admission with readable
  bytes; reject backup and retain bytes; verify subsequent receipt ordering.
- Done when: focused timing/failure tests and runtime typecheck pass, and parent
  review confirms unchanged attachment input and delivery authority.

## Tasks

1. Defer mailbox attachment backup using existing runtime ownership.
2. Prove admission, failure, and receipt ordering with synthetic fixtures.
3. Update the protocol owner and member release note.
4. Verify, review the full diff, and make a scoped commit.

## Verification and review

- Runtime: 257 tests across workspace runner, mailbox conversation import, and
  entrypoint receipt suites passed. After the final publication-order change,
  the 176 affected runner/receipt tests passed again; all four held-upload image
  and document cases passed after the final proof assertions.
- Core: all 45 operations-thresholds tests passed, including missing-prefix,
  idempotency, conflict, duplicate-ID, malformed-audit and other-ledger guards.
- Inbox: 12 normalization and persistence/quarantine tests passed.
- Typechecks passed for assistant-runtime, core, and inboxd.
- Scenario integrity passed for 205 scenarios, 12 sample inputs, and 29 golden
  output directories. This checks manifests, not live scenario execution.
- Changelog: generated fragments, then ran the repository-root changelog page
  test; all 10 tests passed. Reused existing Frog reports
  `20260911184822-documented-changelog-test` and
  `20260912202546-changelog-focused-test` for the documented command mismatch.
  No new friction entry was needed.
- Complexity guard passed for all three changed source files with no increased
  debt. Existing hotspots remain outside the new backup policy; no new abstraction
  or unrelated refactor is justified. Whitespace and authored-content privacy
  review passed.

Product UX: Ready for the local candidate. Synthetic media PUT and receipt PUT
remain held while assistant admission reads the normalized image or document.
Failed upload retains the exact local bytes and releases ownership. Successful
backup publishes its receipt status before a later canonical save, and both
receipts remain in one chain. A skipped earlier inbox backup does not invalidate
later capture recovery. Prompt, tools, image normalization, and provider input
shapes are unchanged; the proof targets timing and persistence rather than a
stochastic model response. No live production delivery was attempted.

The existing canonical lock still serializes later canonical saves and later
capture writes behind an unfinished backup. This change removes that wait from
starting the current locally prepared attachment turn; it does not make all
workspace writes concurrent. Audio still requires its existing parser evidence.

Parent review covered background completion ownership, lock release on failure,
receipt publication ordering, immutable capture replay, deployment skew, and
privacy. The changed replay rule permits gaps only for individually validated
inbox capture records and existing audit records; other ledger guards remain.
A rollback to an older reader requires a current-reader snapshot first.

This task authorizes a local scoped commit. PR publication, its required final
ReviewGPT/CI gates, and deployment are outside this task's delivery boundary.

Completed: 2026-09-16
