# Defer device-import preparation during conversation admission

Status: active
Created: 2026-10-22
Updated: 2026-10-22

## Goal and evidence

A member message reached a hosted runtime that had cold-started for a
device-sync wake. The pass ran five CPU-heavy resource imports; the message
arrived during the first, the attempt promoted to foreground in place, and all
five imports kept running through admission. The event loop had no idle time
during the turn's mailbox fetch and first typing took about 2.8 seconds against
a 2.5-second threshold. Each import rebuilds a whole-ledger event identity index
before its canonical write.

History: #3090 deliberately moved device, clinical and environment work to the
fenced workspace so that downloads survive replies and imported data can become
readable during a turn (ARCHITECTURE.md hosted-concurrency paragraph, public
changelog, concurrent-device-import suite). Its latency proof covered held I/O
only. #3116 built pre-publication cancellation of import preparation, but the
workspace-system-work path never receives a foreground signal. A blanket
foreground yield would break #3090's guarantees, so the owner chose an
import-only scope.

## Scope and invariant

While a newly observed conversation row is being admitted (until that turn's
provider request starts, or its phase/pass ends, with a 30-second fail-open
cap), device-import preparation must not run: the import step waits before it
starts, and in-flight preparation aborts through the #3116 signal before
`runCanonicalWrite`, then retries the same downloaded snapshot in the same job.
Downloads, job ownership, attempts, partial progress, workspace attempts and a
publication already under way are unchanged. No new state, schema, queue or
persisted field.

## Decisions

- Defer in place instead of releasing the job: release forced re-downloads and,
  for multi-job passes, either redid completed payloads or required carrying
  acknowledgments on a pending mailbox item, which relaxes invariants the
  mailbox state relies on.
- One optional `snapshotImportDeferredCount` job-timing field makes production
  deferrals observable; deferred attempts are not counted as imports.
- Fail-open cap covers paths that observe a conversation row without a
  following foreground pass (for example imports that produce no assistant
  input).

## Verification

- Device-syncd service suite (defer during preparation, gate, held download,
  publication under way, wrapped errors, job-level yield/cancellation races).
- Assistant-runtime admission suite (warm and system_mailbox promotion,
  partial progress, provider/no-provider/failure/shutdown/abort closure,
  back-to-back rows, cap expiry) plus the unchanged concurrent-device-import,
  system-preemption, promoted-foreground-priority and system-mailbox suites.
- Core's existing device-import preemption suite for the publication boundary.
- Package typechecks, complexity guard, diff-scoped lane.
