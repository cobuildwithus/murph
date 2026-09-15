# Reduce OpenAI stream silence recovery to 30 seconds

Status: active
Created: 2026-09-15
Updated: 2026-09-15

## Outcome and invariant

OpenAI stream silence reaches native recovery after 30 seconds instead of 90.
Continuing provider events and local tool execution may take longer. Native Codex
owns fallback and retries; Murph retains accepted work, effect dedupe, and abort.

## Evidence and scope

The existing 90-second config and real pinned native synthetic stall prove the
wait. Earlier local subscription experiments completed eight Terra low turns;
the longest data gap was 9.377 seconds. Sol high and extra-high partial runs had
11.576 and 12.847 second gaps through their local test budgets, without final
answers. These small WebSocket samples do not establish production latency tails
or live HTTPS fallback safety. The original production delay remains unattributed.

Change the existing config owner and its diagnostics. Preserve Venice and custom
inference at 90 seconds. OpenAI operator requests, children, and compaction share
the OpenAI provider config. No new watchdog, retry loop, state, or dependencies.

## Product UX and risk

Patch. Replay silence before and after acknowledgement, continued data beyond
30 seconds, slow local tool work, fallback after a completed tool, and resumed
follow-up. Review the final answer and exact tool counts. No live member delivery
or production testing. Long genuine provider silence can now interrupt a response;
the same limit applies to HTTPS fallback, so this is not a 30-second reply SLA.
Existing diagnostics expose acknowledgement, data receipt, native fallback, and
the selected provider window. Fresh config adoption is required during rollout;
old and new containers may coexist without schema or protocol changes.

## Tasks

1. Scope config and telemetry to each existing provider; extend exact config tests.
2. Run focused native transport/tool/stream regressions including full 30-second
   local proof, runtime config/startup tests, and relevant typechecks.
3. Update the durable timeout contract and a narrow public release note.
4. Review the full diff, privacy, recovery, and complexity; open a draft PR.
5. Admit the stable head to CI and ReviewGPT, disposition findings, close this
   plan, and report the ready PR with exact-head checks and remaining limits.

## Verification

- Full native 30-second proof: 13 passed, two older optional experiments skipped.
  Silence before acknowledgement recovered at 30,002 ms; after acknowledgement
  at 30,170 ms; after partial text at 30,117 ms. Every case returned one exact
  final answer and completed the next resumed HTTPS turn. A completed tool was
  not repeated during continuation fallback (30,078 ms). Quiet 22-second work,
  35-second reasoning events, and a 35-second local tool all completed.
- Runtime config: 54 passed, seven opt-in cases skipped. Startup: 30 passed.
  Eight selected config/operator-auth/compaction checks passed with explicit
  local opt-in. The one initial diagnostics assertion failure was a test-call
  typo, corrected and rerun successfully.
- Final reasoning event-shape and partial-text checks passed after fixture review.
  Assistant Engine and Assistant Runtime typechecks passed. Complexity and
  docs drift passed; no new source complexity debt.
- Web release-note rendering: 10 passed; Web typecheck passed. PR #3468 is
  open. ReviewGPT and exact-head CI pending. Prior live-model measurements remain the live-provider evidence;
  no prompt, tool schema, model choice, or reply policy changes.
- Reused Frog entries for the documented changelog command's root-relative test
  discovery/generation issue; use repository-root Vitest and prepare the catalog.

## Parent review

The same provider-settings function supplies TOML and safe diagnostic numbers.
Known OpenAI IDs receive 30 seconds, including dev subscription/local test IDs;
other IDs retain 90. The custom provider section retains its one request retry
and zero stream retries. Native source at the pinned release shows the timer
around each data-stream read and WebSocket send, and the same bounded fallback
owner for sampling and streaming compaction. No new work is awaited on the hot
path, and existing authority, abort, lease, delivery, and persistence owners are
untouched. Mixed deployment changes timing only; fleet adoption is not locally
proven. Parent Product UX verdict: Ready for this provisional transport policy,
with genuine silence over 30 seconds and live HTTPS tails an explicit risk.
