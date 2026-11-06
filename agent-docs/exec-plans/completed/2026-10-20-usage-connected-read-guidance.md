# Reduce connected context instruction reads

Status: completed
Created: 2026-10-20
Updated: 2026-10-20

## Goal and invariant

Reduce the connected-app instructions loaded by recurring Journal work while
preserving account ownership, opt-outs, source privacy, untrusted-content rules,
reminder location, and all provider write boundaries.

## Design and scope

Move the existing read, selection, group, and location sections unchanged into
one connected-app reference. Both owning skills and the system routing use it.
Keep writes, account changes, exports, and other built-in services in the main
skill. No runtime eligibility gate, cache, schema, new tool, or policy owner.
The earlier no-work gate was rejected because authoritative emptiness requires
additional source and canonical-plan work.

## Product UX

Replay private morning capture and silent reminder reconciliation, including
opt-outs and missing accounts; preserve ordinary connected-app writes and group
restrictions through composed routing proof. Affected members receive the same
saved plans, repairs, and silent outcomes. No UI changes.

## Tasks and verification

1. Extract shared sections and update exact routing; verify packaged references.
2. Prove composed routing and retained policy with focused tests and typecheck.
3. Measure representative complete initial provider inputs at base and head;
   separately measure skill-result bytes, which are not initial-input tokens.
4. Run a focused real morning journey and review exact effects and silence.
5. Review diff/privacy/complexity, close plan, commit and open draft PR.

## Risks

A surviving broad skill directive could erase savings. Test production routing
and inspect live reads. Missing installed references could break execution;
verify package assets. Extraction must not weaken email-write or group policy.

## Evidence

- Composed routing: 12 focused connected-app prompt tests passed.
- Assistant-engine typecheck passed; docs drift and complexity guard passed.
  Existing source hotspots remain unchanged at 28 and 25; no new branches.
- Packaging dry run includes the shared reference. All four moved policy
  sections match their base sections verbatim.
- Morning skill plus read reference: 37,850 to 31,231 UTF-8 bytes, down 6,619
  (17.49%). This measures instruction-file results, not billing tokens.
- Complete scripted provider capture against base `14be5174d566`:
  individual 166,363 to 166,628 bytes (+265, +0.1593%);
  group 145,032 to 145,046 (+14, +0.00965%). Identical fixtures include assembled
  instructions/messages, native tool guidance and schemas; exclude only the
  transport cache key. Exact target-model tokenizer unavailable; no estimate.
- Focused real-Codex morning repair/retry journey passed using gpt-6-luna,
  xhigh reasoning, local subscription authentication. The first pass made four
  supported repairs and preserved seven other reminders; replay made zero new
  repairs and zero inspections. Both returned silent skip. The actual run read
  the shared reference without broad write/export instructions. UX: Ready.
- Candidate diff/privacy review passed. Parent owns Ready, CI and final review;
  no merge or deployment is authorized in this lane.
Completed: 2026-10-20
