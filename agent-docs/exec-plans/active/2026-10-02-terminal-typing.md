# Release abandoned prepared typing after terminal input

## Outcome and invariant

A terminally suppressed conversation input must not keep an unclaimed typing
session alive or deny typing to a later legitimate reply. Accepted turn typing,
its provider authority, and deliberate maximum-session cooldown stay intact.

## Evidence and owners

Privacy-safe timing evidence identifies a prepared session accepted after a
terminal non-reply, five minutes of refresh, then missing typing on later replies.
The importer starts preparation; channel activity owns claim/handoff/cleanup;
the existing committed terminal-input callback owns final non-reply truth.
ReviewGPT will author all test and implementation patches. No production mutation.

## Work

- [x] Have ReviewGPT author a synthetic composed regression and prove failure.
- [x] Request the smallest correction through existing lifecycle owners.
- [x] Inspect the patch; verify races, successful handoff, abort and cooldown.
- [x] Run focused proof and applicable typechecks; assess hot-path cost.
- [x] Commit/push and open a draft PR with aggregate evidence and release limits.
- [ ] Run applicable external review; report exact-head CI limitations honestly.

## Product and deployment

Effort: Patch.
Outcome: typing reflects real work without delaying final replies.
Reaches: eligible Linq inputs in the resident runtime, including terminal suppression.
Proof: composed synthetic import, terminal commit, provider typing lifecycle and later reply.
Replay suppression-before-acceptance, suppression-after-acceptance, legitimate
handoff, and a later same-target input. Wire/schema shapes should remain unchanged.
Behavioral fix stays draft; no merge or deployment by this task. Existing release
owners must recycle runtime replicas before observing convergence.

## Reproduction evidence

ReviewGPT authored the test patch and its fixture correction. Both terminal
acceptance races commit real suppression without provider execution or handoff,
then fail at missing cancellation. Refreshes survive five minutes and the later
reply is denied typing by the orphan cooldown. Three controls pass: import abort,
turn abort after pending handoff, and the real maximum-session cooldown.
The initial textless fixture was rejected because import creates fallback text;
it was corrected through ReviewGPT before any runtime implementation request.

Focused command: `pnpm --dir packages/assistant-runtime exec vitest run --config
vitest.config.ts --no-coverage test/hosted-runtime-mailbox-conversation-import.test.ts
-t 'prepared Linq typing terminal lifecycle'`. Result on base runtime: two causal
failures, three passing controls. The first test patch also passed runtime typecheck.

Patch attachment capture friction is already owned by issue #3937. Inline capture
was verified against ReviewGPT's exact diff hashes and postimage blob identities.

## Candidate verification

ReviewGPT's implementation and compiler-only correction were applied against
verified diff hashes. Parent review confirms the original per-target map remains
the only owner. Committed input ID plus exact provider-function identity scopes
cleanup; handoff removes its cancellation authority. Pending cleanup fences new
typing until existing start/stop settle, without delaying reply execution.
Cancellation time prevents late transport settlement from manufacturing cooldown.

- Four preservation suites: 146 tests pass (import, attachment typing, handoff,
  channel activity). Existing terminal telemetry: three tests pass.
- Final focused lifecycle proof: all 11 tests pass, including no instrumentation,
  identity isolation, handoff races, late start/stop and real-session cooldown.
- Assistant-runtime typecheck passes after ReviewGPT fixed closure narrowing.
- Complexity guard passes: no increased debt or maxima across three source files.
  Existing import/maintenance hotspots remain; broader splitting is unrelated.
- Product UX: Ready for this transport patch's synthetic provider boundary.
  Handset visibility and production rollout are deliberately unverified.
- No prompt, schema, tool routing or initial provider-input surface changed for
  individual or group turns; real-model proof and tokenizer measurement do not
  address this deterministic cleanup invariant.

Wire/snapshot shapes and provider policy remain unchanged; old runtimes retain
old process-local behavior until replaced. A transport that never settles can
retain a typing claim until process replacement; the existing bounded provider
transport remains authoritative. Final reply execution does not await cleanup.
External exact-head review and required CI remain separate pending gates.

Draft PR #3980 owns this correction. Content-only release-note generation and
archive proof pass (10 tests); Web typecheck passes. Initial CI rejects draft
proof explicitly; the task requires retaining draft, so required CI is not green.
