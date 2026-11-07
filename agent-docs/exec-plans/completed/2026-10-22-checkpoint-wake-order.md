# Make checkpoint wake projection proof deterministic

## Outcome
Correct the test fixture ordering without changing production scheduling or weakening its two-pass and single-checkpoint assertions.

## Evidence
The original real-timer fixture can finish before its wake callback. A controlled late-callback reproduction yields the same one-pass assertion failure seen in CI. An immediate first-phase notification also misses the intended loop boundary, so the correct synchronization point still needs source tracing.

## Plan
- [x] Inspect ownership and reproduce the timer-order dependency with synthetic evidence.
- [x] Obtain a minimal ReviewGPT test correction using the existing runtime/harness boundary.
- [x] Run the whole checkpoint-race test file, package typecheck, and relevant guards.
- [x] Prepare the test and public-safe Frog entry for the scoped implementation commit; final ReviewGPT and exact-head CI remain merge gates.

## Handoff
Original automation session owns completion. This is test-only work; it changes no production artifact or deployment behavior.

## Result and verification
ReviewGPT supplied a test-only correction using the first phase afterCheckpoint hook, which runs after the foreground watcher joins. The outer loop subsequently absorbs the projection and consumes the queued wake. The test retains its slow second pass and strengthens intermediate projection and event-order assertions. All 20 tests in the checkpoint-race file and the assistant-runtime typecheck pass. Original controlled late-callback proof failed with one rather than two passes; an early synchronous notification also failed and was discarded. Complexity and documentation guards are recorded with the candidate. Final external review, CI, and merge remain the original session's completion responsibility after this implementation commit.
Status: completed
Updated: 2026-10-21
Completed: 2026-10-21
