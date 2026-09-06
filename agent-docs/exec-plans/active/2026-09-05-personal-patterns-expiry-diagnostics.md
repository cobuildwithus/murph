# Diagnose expired Personal Patterns occurrences

Status: active
Created: 2026-09-05
Updated: 2026-09-05

## Goal

Make expired Personal Patterns occurrences distinguishable from terminal run
failures, and expose the missing historical checkpoint wake evidence needed to
diagnose delayed scheduled work.

## Scope and evidence

Read-only triage established an expiry while model-free runtime work continued.
The existing logs do not prove which historical default wake was projected.
Do not infer a scheduling fix from absent diagnostic fields. Production row
contents and identifiers remain outside this plan and all test fixtures.

The existing runtime-progress diagnostics PR owns terminal invocation evidence.
This task instead extends snapshot lifecycle diagnostics and the existing cron
expiry event, and corrects the generic operator email. No scheduler, model,
notification eligibility, delivery effect, or persistence owner changes.

## Tasks

- [x] Inspect current owners, live metadata, and overlapping open work.
- [x] Preserve one occurrence-wide alert body/key while accurately describing expiry.
- [x] Record the existing consecutive failure count when an occurrence expires.
- [x] Record attempted checkpoint wake states and relative timing without raw values.
- [x] Prove fresh expiry, retry expiry, mixed alert outcomes, and snapshot lifecycle diagnostics.
- [x] Run relevant typechecks, lint, complexity and documentation checks.
- [ ] Review and commit the scoped candidate; complete applicable external review.

## Diagnostic contract

Snapshot lifecycle logs classify each requested wake as omitted, none, invalid,
due, or future. A signed millisecond offset is measured when the log details are
built; negative means overdue. It is not an orchestration decision or proof of
acceptance. The finished event's existing `webCheckpointAccepted` field supplies
that distinction. Default wake reason and progress-generation presence expose
legacy versus complete checkpoint shapes without logging either raw value.

The expiry event records only the existing prior consecutive failure count.
Zero means no retained failed attempts, not proof that a model never ran.
Operator email remains occurrence-wide and does not interpolate member-specific
counts, lateness, failure codes, or payloads into its idempotent body.

## Product UX and deployment

Internal operator diagnostics only; member-facing behavior and provider input
are unaffected. No changelog entry is needed. All log fields are additive and
old consumers ignore them. Web and runtime may deploy independently; the new
email explains fields which older runtimes omit. Existing delivered emails keep
their old wording and the occurrence idempotency key is deliberately preserved.
No production mutation is part of this task.

## Verification

- Invocation bridge: 74 tests passed, including omitted/absent/overdue/exactly
  due/future default wakes, malformed-value redaction, and failed snapshots.
- Cron expiry: two focused tests passed, proving zero and one retained prior
  failure while preserving original-occurrence expiry and no delivery.
- Operator email: eight tests passed, including mixed terminal outcomes sharing
  the same occurrence key and byte-identical email body.
- Assistant Engine, Assistant Runtime, and Web typechecks passed.
- Web ESLint, complexity diff, raw-log guard, documentation drift/gardening,
  diff whitespace, and identifier scans passed.
- Parent candidate review found no scheduling or retry changes, new awaited
  operations, arbitrary values in the new log fields, or checkpoint authority
  derived from diagnostics. Existing complexity hotspots remain unchanged.
- External review and any PR-required CI are pending publication.
