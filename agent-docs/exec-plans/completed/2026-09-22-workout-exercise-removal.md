# Remove one exercise from a live workout

Status: completed
Created: 2026-09-22
Updated: 2026-09-22

## Outcome and invariant

A member can remove one explicitly selected exercise through the existing workout CLI. The canonical workout remains authoritative; every remaining exercise, set result, order, and session field is preserved. Deletion requires the exact revision from the approved read and rejects stale or ambiguous requests.

## Ownership and evidence

The targeted workout use-case and CLI own this correction. Generic structural replacement deliberately rejects omitted exercises, and the targeted CLI has no removal operation. Extend the existing mutation lock and validated canonical write; no new state owner or native wire contract is needed.

## Product journey

Entry: an explicit request to remove an exercise from an exact workout. Read that workout, identify one exercise, and submit its observed lifecycle revision. On success, read back the retained workout. A stale revision, absent target, ambiguous name, or invalid selector makes no write. Empty sessions remain valid, and completed sessions retain their completion boundary. Native deletion controls are a separate presentation change.

## Tasks and proof

- Add a failing in-process CLI regression with canonical readback.
- Add the targeted use-case and CLI command, preserving sparse exercise orders.
- Cover stale revisions, ambiguous names, selector mismatch, replay, and the final exercise.
- Run focused CLI tests, affected package typechecks, and complexity review.
- Record remaining assistant journey and release verification separately from local proof.

## Decisions

Use the existing revision and mutation lock. Keep survivor order values unchanged so removal cannot silently retarget an old coordinate. Do not alter generic replacement safety.

## Verification

The regression failed before implementation because the remove command did not exist. After implementation:

- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/workout-live-command.test.ts`: 15 passed.
- `pnpm --dir packages/vault-usecases typecheck`: passed.
- `pnpm --dir packages/cli typecheck`: passed.
- `pnpm complexity:diff`: passed; no added complexity debt.
- `git diff --check`: passed.

CLI journey: Ready for local review. Canonical readback preserved every survivor and its results; stale revisions, ambiguous names, mismatched selectors, and replay made no write. Removing the last exercise retained the workout event.

Member-facing completion: Hold. Assistant skill guidance and a focused real-model deletion journey, changelog, final review, and release remain outstanding. This is a local implementation checkpoint, not a shipped feature.


## Workout editor diagnostic follow-up

The card attachment boundary silently falls back to a read-only card when its vault is absent, the live projection rejects the presentation, the hydrated card fails validation, or the reader throws. Preserve those safety boundaries and successful card delivery, but return bounded issue metadata through the existing assistant runtime issue owner. Do not capture error messages, arbitrary error codes, card contents, identifiers, or vault paths.

Implemented locally: distinct fallback reasons and an allowlist of reader error codes. Focused coverage verifies successful hydration emits no issue, missing-vault and reader failures retain the card with private-data-free diagnostics, and ambiguous projections retain their V4 delivery behavior.

Verification: assistant response-card tool tests passed (30 tests); assistant-engine typecheck passed. Production release and a subsequent hosted card confirming the diagnostic remain outstanding. This instrumentation does not establish the historical swallowed exception or repair previously delivered cards.


## Local editor replay and regression proof

A private local replay used the real message service, recovered conversation context, a temporary canonical vault, and `gpt-5.6-terra`. External delivery was disabled. Active cards produced by the local replay retained trusted editor state. The temporary replay harness was removed; private messages are not test fixtures. This does not reproduce the exact hosted image, resumed provider context, or concurrent input timing, and does not establish the historical fallback reason.

The existing synthetic live test for pending resistance and bodyweight sets omitted the explicit vault root and asserted presentation without requiring an editor. It now supplies that root and requires a valid action binding, editor version, expected exercise units, and pending set state. This closes a test gap; it is not a production runtime wiring change.

Verification:

- Focused `test:assistant:live` case `keeps resistance and bodyweight editor modes explicit before any load is logged` with `--model gpt-5.6-terra`: passed.
- `pnpm --dir packages/assistant-engine typecheck`: passed after the final test change.
- `git diff --check`: passed.

Hosted editor diagnosis remains open pending observation of the instrumented boundary in the hosted runtime. No release or external message delivery was performed for this replay.


## Active workout attachment must be editable

Outcome: newly attached active workout cards must include a verified editor. A failed projection returns a recoverable tool error and attaches no card.
Reaches: private active-workout replies with missing or unreadable vaults, stale presentation, ambiguous coordinates, hidden fields, or unsupported result families. Completed summaries and previously delivered snapshots retain their existing reader compatibility.
Proof: deterministic rejection and lossless canonical readback, corrected-card retry with V6 delivery, and focused real-Terra recovery through the normal assistant service. The tool may attempt one exact read and corrected attachment; persistent failure uses truthful ordinary text without changing saved data to satisfy the editor. No new retry loop or state owner.

The deterministic regressions fail against the previous success-without-editor fallback (12 failures), establishing the behavior being changed. The earlier diagnostics-only checkpoint is superseded by this requested rejection behavior.


Active-card change verification: 56 deterministic tests passed across the response-card tool, compact-table admission, response-card validation, and tool-validation digest suites. Both focused `gpt-5.6-terra` local-subscription journeys passed through the real local assistant service: one injected transient failure retried once and produced an editor binding; persistent failure attempted attachment twice total, attached nothing, and returned concise truthful text. Both journeys preserved the exact canonical workout and performed no external delivery. Reply review: Ready for these local journeys. Assistant-engine typecheck, complexity guard, docs drift, and diff whitespace checks passed. No hosted release has occurred; the historical hosted reader failure remains undiagnosed.


## Editable-only workout cards, including completed workouts

Outcome: every newly issued workout card supports direct corrections, including completed workouts. Remove producer and refresh downgrades to read-only cards and the native read-only workout detail view. Preserve saved completion time and duration during native corrections. Oversized or unrepresentable editor state produces an explicit failure, never a display-only replacement.

The static image remains an authority-free preview, not an alternative workout editor. Historical presentation decoding is retained only to recognize already-delivered links; opening a legacy link without a binding asks for a fresh card instead of showing an alternate read-only workout screen. The active and completed editable paths share the current typed wire and canonical mutation owner. Native readers must be released before completed editable payloads are enabled in production.

Proof: canonical completed correction and replay, completed/skipped wire round-trip, strict producer and refresh rejection without editor, native completed editing and repeated corrections, legacy unavailable state, focused Terra completed-card journey, and cross-owner review. No deployment is authorized by this implementation checkpoint.


Local completed-card result: the implementation removes new read-only card
production, V4 save/refresh downgrades, and the native read-only detail surface.
Both active and completed cards use verified V6 editors. Native corrections
preserve completion time and duration. Save/refresh receipts carry the same V6
card envelope directly, so a successful correction cannot strand the editor at
the transcript URL ceiling. Historical URL-shaped receipts remain readable only
with an editor binding. The native and action bounds now agree on 16 exercises,
16 sets each, and 512 mutations; authenticated ingress/outcome budgets cover the
larger payloads. These findings came from the required independent deep review;
its final targeted pass reported no remaining concrete findings.

Verification: 44 focused contract tests, 107 canonical/use-case tests, 32 Web
route/mailbox tests, 33 assistant card-tool tests, and 13 operator card tests
passed. The real local `gpt-5.6-terra` completed-card journey passed with no
external delivery and exact canonical preservation. Contracts, operator-config,
vault-usecases, assistant-engine, and Web typechecks passed. The prepared runtime build, complexity
guard, and docs drift check passed.

Native validation: XcodeGen, full SwiftFormat lint, and changed-source parse
passed. A temporary compiled macOS executable using the actual native model and
session sources plus the three new regression bodies passed completed/skipped
decoding, oversized authenticated results, and successive completed corrections.
This is model/session execution, not an iOS UI test. `swift test` could not import
XCTest; `xcodebuild test -scheme MurphCompanion -destination 'platform=iOS Simulator'`
failed because the active developer directory is Command Line Tools rather than
full Xcode. Simulator and physical Messages proof remain outstanding. Native
support for completed V6 and direct-envelope results must precede backend
producer rollout. No commit, release, or real message delivery was performed.


Implementation checkpoint closed for release review. User authorization now
includes PR publication, requested ReviewGPT, merge, and deployment. Backend
PR #3654 pairs with native PR cobuildwithus/murph-ios#167. CLI command tests
(15) and typecheck plus changelog archive tests (10) pass. Generated CLI command
schema/type/hash changes are included. Release execution remains a separate
verified outcome: native build/signing and physical Messages proof must precede
backend producer rollout. No production deployment is claimed by this plan.
Completed: 2026-09-22
