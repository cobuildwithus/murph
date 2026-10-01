# Junction webhook contention and diagnostics

## Outcome and protected invariants

Reproduce concurrent payload-bearing webhook preparation against local PostgreSQL,
preserve every accepted payload and its authenticated revision, and report enough
content-free diagnostics to distinguish transport selection and stale state.
Consent, connection/source epochs, root authority, trace completion, and the
clean-to-dirty mailbox handoff remain atomic at their existing owners.

## Owner and hypothesis

Web webhook ingress owns transport selection. The dirty store seals payloads before
the final admission lock and requires an exact dirty-marker snapshot. Concurrent
valid ingress can advance that snapshot before either bounded preparation attempt
commits. Prove this using synthetic events before changing the owner.

## Smallest correction to investigate

Retain existing encryption and compression outside locks. For only monotonic
ingress revision advancement with unchanged acknowledgement and authority, locally
rebind the already-compressed, authenticated envelope to the current revision under
the existing dirty-row lock. Preserve payload identity, schema, root checks, and
full replan on acknowledgement or authority drift. Add no state, queue, dependency,
schema migration, or retry owner. Compare this with existing rejection behavior.

## Proof and completion

- [x] Deterministic local reproduction, including two stale preparation attempts.
- [x] Focused correction with decrypt/readback, wake, acknowledgement, root, and
  consent regression proof; verify no KMS or compression enters locked work.
- [x] Bounded diagnostics for transport decisions, replan causes, and recovery;
  prove private payloads, identifiers, and arbitrary error details stay absent.
- [x] Focused tests, relevant typecheck, complexity check, and parent diff review.
- [x] Update the durable owner; close and commit through the final task wrapper.

## Boundaries

Local implementation and tests only. No production mutation or deployment.
The separately observed overdue dirty frontier is not assumed to share this cause.
The existing ciphertext schema and readers remain compatible across deployment.

## Evidence

- Before the change, a synthetic sibling transaction after each actual webhook
  preparation reproduced `HOSTED_DEVICE_SYNC_PREPARATION_STALE` through the
  production two-attempt retry owner against local PostgreSQL.
- After the change, that scenario commits on the first preparation. Twelve
  simultaneous prepared payloads all commit at distinct authenticated revisions.
  Initially missing and clean markers converge without duplicate mailbox wakes.
- Readback decrypts every payload at its persisted revision and rejects a wrong
  revision. Separate real secure-box encryption proof rejects changed connection
  AAD, forged capabilities, and reverse revision movement without additional KMS
  calls. Compression instrumentation proves rebind performs neither compression
  nor decompression.
- Dirty acknowledgement, owner, missing-marker, and metadata drift remain
  retryable. Existing PostgreSQL consent-withdrawal and deletion ordering proof
  passes. Root drift retains its exact diagnostic category and bounded retry.
- Route and retry tests prove finite transport/drift reason logging and exclusion
  of synthetic private body, header, exception, and unknown reason content.
- Web typecheck passes. Complexity guard passes: dirty-store maximum 34 to 29;
  other modified source owners do not add complexity debt. No broader refactor
  is justified by the changed path.
- Consolidated focused proof: 373 tests passed in 12 files, including opt-in real
  PostgreSQL cases and changelog rendering. Documentation drift/gardening and
  whitespace checks pass. All fixtures are synthetic; the local database was
  initialized from the current Prisma schema using its ordinary CLI.
- Final review removed a redundant companion dirty-row lock after an initially
  missing marker converges. The affected 34 store tests, typecheck, and complexity
  guard pass after that adjustment.
- No new dependencies, schema, persistent state, environment variables, or
  provider calls. Rebind adds one local authenticated open/seal per payload,
  serially (at most two webhook resources or one companion resource). No extra
  datastore calls on an existing-marker rebind; convergence from missing to
  existing adds the same single dirty-row lock and reread as ordinary preparation.

## Product and deployment disposition

Patch-sized reliability improvement. Journeys: pending webhook burst, first-dirty
race, clean-to-dirty race, root rotation, acknowledged/replaced state, revoked
consent, and deletion. Local admission outcome is Ready; actual provider redelivery
and production deployment are not claimed. No assistant prompt/tool/reply changes.
The changelog entry describes only fewer delivery retries; no new notification.

Ciphertext schema, payload ids, AAD fields, public responses, and retry budget stay
compatible. Existing readers can read rebound ciphertext using its stored revision.
No coordinated Web/Worker deployment order or migration is required. After release,
inspect bounded 5xx and exhausted-drift counts with the transport decision and
same-invocation rebind/recovery logs. An attempted rebind is not itself commit proof.

Scope ends at a tested local commit. No PR, remote review, CI, merge, or deployment
was requested or performed; release review and CI remain future release gates.
Status: completed
Updated: 2026-09-08
Completed: 2026-09-08
