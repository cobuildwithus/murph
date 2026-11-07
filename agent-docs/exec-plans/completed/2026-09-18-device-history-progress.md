# Credit persisted historical scan progress

Status: completed
Created: 2026-09-18
Updated: 2026-09-18

## Goal

Keep finite historical scans eligible for continued background execution when
empty provider dates advance a persisted continuation but import no records.

## Scope and constraints

Extend the existing provider result and service timing evidence consumed by the
hosted system-progress generation. Preserve ownership checks, foreground yield,
provider retry deadlines, bounded pass sizes, and checkpoint publication. No new
scheduler, persisted state, protocol field, or provider request is needed.

## Evidence and decisions

A synthetic empty historical scan advances sixteen complete dates and returns
a strict suffix, but the previous code emits no progress evidence. The new
provider regression failed on that missing evidence before implementation.
Ordinary queue commits alone remain insufficient: only a provider-proven strict
forward suffix of an unchanged finite resource window qualifies, and the service
publishes it only after the existing atomic owned job commit succeeds.

## Tasks

1. Reproduce empty-history progress loss and retain negative controls.
2. Carry provider coverage evidence through the owned service commit and hosted
   maintenance metrics to the existing checkpoint progress generation.
3. Run focused provider, service, runtime proof and both package typechecks.
4. Review privacy, failure paths, diff complexity, and delivery limitations.

## Product UX

Patch. Faster eligible historical continuation without new member action.
Replay empty history, unchanged/retry work, failed commit, and foreground yield.
Production timing remains unverified until the corrected runtime is deployed.

## Verification

- The empty-history provider regression failed before the fix on missing progress
  evidence, after proving sixteen requested dates and the exact forward suffix.
- Provider history suites: 151 tests pass across historical fanout, historical
  recovery, and extended-resource backfill, including pending upstream history.
- Service suite: 174 tests pass, including successful atomic successor publication
  and rejected account-revision commit with no credited continuation progress.
- Hosted maintenance suite: 131 tests pass, including generic queue-only negative
  control, credited continuation, foreground yield, abort, and timeout.
- Both device-syncd and assistant-runtime package typechecks pass.
- Docs drift, complexity diff, and whitespace checks pass. Hotspot debt and
  maximum complexity are unchanged; no unrelated hotspot extraction is needed.
- Parent review: provider evidence is a strict suffix of the same finite window;
  service authority is checked before atomic commit; existing checkpoint CAS
  publishes the generation. No new provider calls or foreground waits. Empty
  sparse jobs with no forward movement remain uncredited. Local Product UX Ready.

## Delivery boundary

Local correction and verification are complete. No production mutation, push,
PR, or deployment is included. A release still needs its applicable external
review and CI plus a member-facing changelog entry; production speedup has not
been measured. This does not credit generic full-job cursor rotation or partial
progress inside failed jobs, and does not change provider request granularity.
Completed: 2026-09-18
