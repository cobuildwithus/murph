# Hosted Run Hard-Cut Review Issue Dedupe

Status snapshot: 2026-04-20

This document dedupes the two latest hosted hard-cut review writeups into one
open-issues list.

It is a point-in-time review artifact, not a canonical architecture doc.
Current source-of-truth behavior remains in `ARCHITECTURE.md` and
`agent-docs/references/hosted-run-protocol.md`.

## Scope

- Source material: two supplied review snapshots describing the same hosted
  hard-cut state.
- Goal: collapse repeated findings into one list of remaining issues, with the
  repeated evidence and requested fixes merged.
- Excluded from the issue list: items both reviews already marked as fixed.

## Deduped Issue Summary

| Severity | Issue | Repeated in both reviews | Why it remains open |
| --- | --- | --- | --- |
| Critical | Cloudflare finalizes directly after commit without first claiming the run as `finalizing` | Yes | This can run side effects without valid finalize ownership and can leave web recovery state behind reality. |
| High | `assistant.cron.tick` is half removed and half still modeled in shared/runtime contracts | Yes | The repo is in an inconsistent middle state: web rejects it as ingress while shared/runtime code still exposes it. |
| Medium | Active Cloudflare/runtime code still carries wake-shaped naming after the run-centric hard cut | Yes | Not a correctness bug, but it preserves the old mental model and makes future regressions easier. |
| Medium | `nudgeHostedRun` is still a hollow wrapper instead of a real drain/scheduling seam | Mentioned in the first review only | The route contract is more complex than needed and the current helper does not own any real behavior. |
| Low | Live docs and active-plan residue still describe pre-cut or transitional behavior | Yes | The runtime shape is closer to final than the surrounding docs/process artifacts suggest. |

## Fixed Items Removed From The Open-Issue List

Both review snapshots agreed these were already fixed in the inspected
snapshot, so they are not repeated below as open work:

- runner requests are now `run` + `runDrain` shaped
- top-level `request.wake` compatibility is gone
- top-level `request.sharePack` runner compatibility is gone
- runtime now fails closed when `runDrain` is missing
- the web schema now uses `HostedIngressEvent`, `HostedRun`, and `HostedRunLog`
- live web routes no longer use the old `hosted-wake` executor surface
- `assistant.cron.tick` is no longer accepted as normal hosted ingress
- coalescing now mutates only pending or unacquired rows
- partial commits are rejected

## 1. Critical: Finalize Ownership Bypass After Commit

### What both reviews reported

Both reviews identified the same remaining blocker:

- web/store recovery is modeled as `committed_needs_finalize -> finalizing ->
  finalized`
- Cloudflare still calls finalization immediately after commit using the
  committed run plus the old token
- that path does not reacquire the run through the web-owned finalize claim

The repeated post-commit pattern called out in both notes is:

```ts
if (commit.needsFinalize) {
  await this.finalizeAcquiredHostedRun({
    acquired: {
      ...input.acquired,
      resumeFinalize: true,
      run: commit.run,
      runToken,
    },
  });
}
```

### Why this is a correctness bug

Web/store semantics already require finalization ownership to be explicit:

- `commitHostedRunTx` writes `committed_needs_finalize` when finalization is
  required
- resumable finalization is supposed to be claimed by reacquiring the run
- `finalizeHostedRunTx` only accepts a run in `finalizing`

That means the immediate Cloudflare finalize path is executing with the wrong
ownership model. Side effects can run before the run has been claimed as
`finalizing` with a fresh token.

### Failure mode

The duplicated failure sequence across the two reviews is:

1. Runtime prepares a snapshot plus delivery/outbox effects.
2. Web commit succeeds.
3. Web marks the run `committed_needs_finalize`.
4. Cloudflare immediately restores/drains side effects anyway.
5. Cloudflare calls finalize with the old commit token.
6. Web rejects or declines finalize because the run was never claimed as
   `finalizing`.
7. A later acquire can claim the same run and attempt finalization again.

Even when downstream delivery is idempotent, this violates the intended
invariant:

```text
No side effects unless the executor owns the finalizing run token.
```

### Required fix

The common requested fix is:

- remove the direct `commit.needsFinalize -> finalizeAcquiredHostedRun(...)`
  branch
- after commit, return control to the outer acquire loop
- let web reacquire the run as `finalizing` with a fresh token
- only then invoke finalization side effects

The stricter version recommended by the second review is:

- extend hosted-run acquire with `expectedRunId?: string`
- when `commit.needsFinalize` is true, reacquire that exact run from web
- only proceed if the reacquired run is:
  - acquired
  - `resumeFinalize === true`
  - the expected run id
  - `status === "finalizing"`
  - carrying a fresh `runToken`

### Guard rails requested by the reviews

Both reviews also recommended hard guards in Cloudflare:

- `finalizeAcquiredHostedRun` must reject any path where
  `resumeFinalize !== true`
- `finalizeAcquiredHostedRun` must reject any path where
  `run.status !== "finalizing"`

The first review proposed throwing. The second review suggested returning a
safe backpressured or protocol-violation result. The shared requirement is the
same: make it impossible to run finalization side effects from a merely
`committed_needs_finalize` run.

### Additional recovery gap called out once

The second review added one follow-up seam beyond the shared blocker:

- retryable finalization failures should explicitly release
  `finalizing -> committed_needs_finalize`
- stale-finalizing recovery is still useful, but it should not be the normal
  retry path

Suggested shape:

- add a dedicated release-finalize route, or
- extend finalize with a retryable-failure branch

The intended recovery model becomes:

```text
committed_needs_finalize
  -> acquire claims finalizing
  -> finalize succeeds finalized
  -> retryable failure committed_needs_finalize
  -> stale finalizing committed_needs_finalize
```

### Tests requested by the reviews

Both reviews asked for direct regression proof here:

- a web-store finalize-fence test proving the old commit token cannot finalize a
  `committed_needs_finalize` run
- a Cloudflare runner test proving `commit.needsFinalize` does not directly run
  finalization and instead waits for a later reacquire as `finalizing`

## 2. High: `assistant.cron.tick` Is In A Half-Removed State

### What both reviews reported

The web ingress queue now rejects `assistant.cron.tick`, which both reviews
treated as the correct direction.

But shared/runtime contracts still appear to model it in places such as:

- hosted execution event kind lists
- helper builders/parsers
- runtime event unions
- protocol/docs residue

At the same time:

- `HostedIngressEnvelope` excludes `assistant.cron.tick`
- `runDrain.events[].wake` is shaped as hosted ingress
- there is no clean live path where web appends and acquires
  `assistant.cron.tick` as hosted ingress

### Why it remains open

The repo is currently between two incompatible stories:

1. `assistant.cron.tick` is no longer hosted ingress and runtime timers should
   use `nextRuntimeWakeAt` / `runtime_timer`.
2. `assistant.cron.tick` still exists as a real hosted execution event kind.

Both cannot stay true at once without continuing to confuse the public contract.

### Preferred resolution from the reviews

Both reviews leaned toward the same end state:

- remove `assistant.cron.tick` from hosted public runtime/request contracts
- keep any wake-shaped timer concept internal-only if the runtime still wants
  one for logging or lane naming
- use `runtime_timer` or `manual_repair` trigger kinds instead of persisted
  hosted `assistant.cron.tick` ingress

The first review suggested keeping only a local/internal lane name if needed.
The second review tied the same decision back to the hosted-run protocol docs.

### Alternative noted by the first review

If explicit external/admin scheduling really needs `assistant.cron.tick` as a
durable public kind, then the repo must make that story fully real again:

- put it back in `HostedIngressEnvelope`
- stop rejecting it in web append paths
- classify and test it explicitly as hosted ingress

Neither review recommended staying in the current middle state.

### Proof requested by the reviews

Depending on the chosen direction:

- if removed: no shared hosted-execution public parser, builder, or public type
  should accept `assistant.cron.tick`
- if retained: web append and acquire paths must accept and classify it
  explicitly

## 3. Medium: Wake-Shaped Names Still Dominate Active Code

### What both reviews reported

Both reviews called out that the architecture is now mostly run-centric, but
active Cloudflare/runtime code still uses many wake-shaped names, for example:

- `RunnerWakeProcessor`
- `RunnerWakeScheduler`
- `HostedWakeDrainState`
- `HostedWakeDrainInternalResult`
- `syncHostedWakeBundleCacheToCursor`
- `scheduleHostedWakeRetryAlarm`
- `parseOptionalHostedWakeSeq`
- `maxHostedWakeSeqHint`
- `cleanupCommittedHostedWakesLocally`

The second review also added active-type names such as:

- `resolveHostedWake`
- `HostedWakeEffect`
- `HostedWakeExecutionMetrics`
- `HostedWakeTypingIndicator`

### Why it remains open

This is not the same class of bug as the finalize bypass, but both reviews made
the same point:

- the implementation shape is now run-centric
- the active names still teach future readers to think in wake-by-wake executor
  terms
- that increases the chance that old mental models and compatibility seams get
  reintroduced later

### Direction requested by the reviews

Both reviews recommended finishing the rename now while the system is still
greenfield.

Suggested examples from the two notes include:

- `RunnerWakeProcessor -> HostedRunProcessor` or `RunnerRunProcessor`
- `RunnerWakeScheduler -> HostedRunAlarmScheduler` or `RunnerRunScheduler`
- `HostedWakeDrainState -> HostedRunDrainState`
- `HostedWakeDrainInternalResult -> HostedRunDrainInternalResult`
- `syncHostedWakeBundleCacheToCursor -> syncBundleCacheToCursor`
- `scheduleHostedWakeRetryAlarm -> scheduleHostedRunRetryAlarm`
- `parseOptionalHostedWakeSeq -> parseOptionalIngressSeq` or
  `parseOptionalHostedRunTargetSeq`
- `maxHostedWakeSeqHint -> maxIngressSeqHint` or `maxHostedIngressSeq`

The exact names differ slightly between the two reviews, but the deduped issue
is the same: remove wake-first naming from the live run path.

### Cleanup that can happen with the rename

The first review also called out one likely dead helper:

- `cleanupCommittedHostedWakesLocally` appears to be a no-op and should be
  deleted rather than preserved as naming residue

## 4. Medium: `nudgeHostedRun` Is Still A Hollow Wrapper

### What the first review reported

Only the first review called this out explicitly, but it is a distinct leftover
cleanup item.

Current shape:

```ts
nudgeHostedRun() {
  return {
    accepted: true,
    alarmScheduled: false,
    alreadyRunning: this.wakeDrainLock !== null,
  };
}
```

The route then separately invokes hosted-run draining.

### Why it remains open

The current helper does not own any real nudge or scheduling behavior. It adds
a thin response wrapper while the actual work happens elsewhere.

That leaves the route contract more complicated than necessary and preserves a
wake-era split between "nudge" and "drain" even though the run-centric shape is
already thinner elsewhere.

### Direction requested by the review

The first review suggested collapsing to one of two honest shapes:

- `POST /run` directly drains and returns an accepted or draining result, or
- `nudgeHostedRun` becomes a real scheduling or alarm entrypoint

The preferred option in that review was the first one: fewer moving parts, no
hollow wrapper.

## 5. Low: Docs And Plan Residue Still Describe Transitional State

### What both reviews reported

Both reviews said the implementation is closer to the hard cut than the docs
and process artifacts suggest.

Repeated residue called out across the two notes:

- the live protocol doc still had wording that treated `assistant.cron.tick` as
  a hosted ingress kind
- active plans still looked open even though much of the hard-cut work had
  already landed
- some docs still used `HostedWake` language where the repo now wants
  `HostedIngressEvent + HostedRun + HostedExecutionCursor`

The second review named specific surfaces that still needed alignment:

- `hosted-run-protocol.md`
- `README.md`
- `docs/architecture.md`
- `packages/hosted-execution/README.md`

### Why it remains open

This is not a runtime blocker, but it is still operationally important:

- stale docs make the final architecture harder to reason about
- stale active plans make it harder to tell what is actually unfinished
- mixed terminology increases the chance of preserving accidental compatibility

### Direction requested by the reviews

The deduped requested cleanup is:

- make live docs match the actual run-centric hard-cut contract
- remove stale statements that still describe persisted `assistant.cron.tick`
  ingress
- close or archive active plans that are no longer truly active
- use `HostedIngressEvent`, `HostedRun`, and `HostedExecutionCursor` as the
  final vocabulary in live docs unless a point-in-time historical artifact is
  being discussed

## Recommended Implementation Order

The two reviews converge on this order:

1. Fix the finalize ownership bypass.
2. Add finalize-fence regression tests.
3. Resolve the `assistant.cron.tick` contract fully one way or the other.
4. Clean up wake-shaped naming and hollow wrappers.
5. Align live docs and close stale active plans.

## Bottom Line

After deduping the repeated findings, only one issue still stands out as a hard
blocker:

- Cloudflare must not run finalization side effects until web has explicitly
  reclaimed the run as `finalizing`.

The remaining items are still worth doing, but they are cleanup and consistency
work rather than the last correctness fence.
