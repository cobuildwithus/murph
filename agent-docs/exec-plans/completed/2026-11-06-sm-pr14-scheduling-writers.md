# Restrict scheduling writers to their own mutations

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Outcome and ownership

A scan may only advance the cursor of the channel entry it read, and a scheduled
completion may only archive the one-shot revision and occurrence that ran. Enable
and disable writers own channel membership. The canonical registry owns the
archive decision, under its own lock. Runtime claims and pending intents stay
with the cron runtime store.

## Scope and decisions

Scans propose cursors that merge into freshly read state under the existing
runtime write lock. The merge checks the observed `enabledAt`, refuses a fresh
cursor behind the scan's start, and never moves a cursor backwards. `enabledAt`
is derived from a seed cursor, so two enablements can share it: the baseline
check is what keeps a reseed behind the scan from being skipped.

Two narrow core operations compare active status, revision and occurrence on the
record loaded inside the registry lock, then archive that fresh record. Occurrence
compares instants, because a false mismatch would refire a reminder. On mismatch
the existing finalizer branch settles the old claim and pending intent, so the
current source's `schedule.at` drives eligibility. `completedOccurrence` is now
private to that operation, and completion keeps attached follow-up children.

The occurrence projection reads `pendingDeliveryIntentId` with `!= null`. No
retained file is rewritten, no persisted format changes, and no wire or Web
surface is touched. Reminder-create identity (s4 N7) is deferred.

Two behaviours are deliberate. An edit that leaves `at` unchanged stays active and
can run again with the edited content, as an edit made before the source read
already did. A manual run of a paused one-shot leaves it paused, which matches
reconciliation and the rule that only an active one-shot archives.

`saveAssistantAutomationState` keeps its test callers; production no longer calls
it.

## Proof and progress

- Red runs on the unmodified base, all exit 1: the enabled channel was lost, a
  disabled channel came back, a re-enabled seed was overwritten, a same-`enabledAt`
  reseed skipped inputs, inline and delayed completion removed or reverted moved
  reminders, a scheduled log archived its moved occurrence, and omitted-field
  projections reported pending.
- New proofs use real core, real stores and real staged inputs. Only the provider
  and final delivery are stubbed. They run through the next actual occurrence, so
  each race proof ends in a real due claim, delivery and archive.
- Parent review removed a tautological occurrence pre-check from reconciliation,
  because the pending-aware resolver returned the value it was compared against.
  The registry comparison now carries that decision.

## Verification

Commands, counts and exit codes for the final head are in the PR body. Package
Vitest with `--no-coverage`, plus each affected package's `typecheck` script.

## Deployment

Core, engine and the in-container `vault-cli` ship together in one runner image,
because the runner bundle assembles them from one workspace closure. Old
finalizers can still perform the stale write until drained. There is no file
conversion in either direction.
