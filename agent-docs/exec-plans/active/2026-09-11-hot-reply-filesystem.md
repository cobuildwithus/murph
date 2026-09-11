# Skip pending discovery for staged foreground input

Status: active
Created: 2026-09-11
Updated: 2026-09-11

## Outcome and invariants

Let a known staged foreground batch reach the assistant without rediscovering
pending work from the filesystem. Preserve current-input reads, causal completion
ordering, replay recovery, and explicit maintenance selections.

## Owner and evidence

The workspace assistant phase already receives exact staged input IDs. It still
calls inspect-only pending discovery, which reads the pending index, automation
state, and waves of input files plus terminal receipts. That discovery cannot
invalidate the fresh-batch flag that already chooses foreground execution.
Derive its immediate wake from the existing phase clock instead. Retain discovery
when no fresh batch exists, and retain explicit pending-wake overrides.
No new state, cache, abstraction, service, or protocol.

## Product UX

- Outcome: Less filesystem work before existing hot replies.
- Reaches: Fresh direct and group inputs, causal completions, restored backlog,
  and background maintenance.
- Proof: Composed assistant-phase tests preserve exact input selection and
  completion cutoff while forbidding pre-lane pending-index discovery.

## Tasks and proof

1. Prove redundant discovery with a failing focused regression.
2. Replace that read with the already-known fresh-input wake; update owner docs.
3. Run foreground, scheduling, delivery, pending-input tests and runtime typecheck.
4. Review complexity, add a scoped changelog entry, commit and open draft PR.
5. Complete final ReviewGPT and exact-head CI; close this plan.

## Failure and deployment

Only fresh-batch discovery is removed. Background and restored work retain their
existing authoritative input and terminal-evidence reads. Current input still
passes assistant admission. No wire or persisted shape changes; old/new Web and
warm runtimes remain compatible. Production latency benefit remains unmeasured
until deployment.

## Verification

- New regression fails on base and passes after deletion: no pending discovery
  before fresh assistant dispatch, exact current-input completion cutoff retained.
- Foreground, scheduling, delivery, managed automation, device-sync and pending
  input suites: 356 tests passed across six files.
- Assistant-runtime typecheck passed. Complexity guard passed with unchanged
  debt (334) and maximum (152); factored a repeated foreground-yield condition.
- Parent review checked the complete diff and causal completion, preferences,
  first-group initialization retry, delivery barriers, cleanup and backlog paths.
  Product UX: Ready. Existing mocks now allow only causal preparation ahead of
  fresh input instead of assuming an empty pending scan bypasses it entirely.
- No prompt, tool, routing, context assembly, or model-dependent outcome changed;
  deterministic composed-owner proof covers this optimization.
- Release note, final ReviewGPT and exact-head CI pending.

## Work removed

A fresh pass no longer reads the pending index and automation state or performs
its bounded scan of up to 50 event records plus terminal-evidence checks (waves
of eight). Exact current-event timestamp reads and causal system preparation
remain. No network calls, database work, retries, cache, configuration, or
persisted state added. Existing timeout, abort, and background-discovery owners
remain. Filesystem savings are proven by control-flow/call-count evidence;
production milliseconds require a post-deploy trace.
