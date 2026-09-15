# Reduce OpenAI stream silence recovery to 30 seconds

Status: completed
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
  open. ReviewGPT passed; final-head CI remains the PR completion gate. Prior live-model measurements remain the live-provider evidence;
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


## Final review and handoff

ReviewGPT round 1 passed on bffccbc095477e99ed26b5dbc537c919c0248d4d:
https://chatgpt.com/c/6aa95ebd-5eb0-83ea-a939-c97353eb2738

The managed Eragon lane selected and verified gpt-6-pro. Exact preceding-turn
identity, response hash, completion marker, full sensitive snapshot metadata,
and all 12 patch files were checked. Observed response-wait updates spanned at
least 225 seconds before capture, exceeding the 180-second minimum. Response
SHA-256: b0ff1d663f023b2d5160d76aad04af25acc83f65c9d4db068e6eeec534d6ae08.
No Critical, High, or material Complexity Collapse findings; zero accepted or
unresolved findings. The review inspected source and test validity but did not
independently execute dependencies/native fixtures in its archive environment.

Parent final review agrees: provider scope and retry counts are preserved;
partial output and completed-tool fallback remain native-owned. Explicit known
risk of useful silence exceeding 30 seconds remains part of the authorized
provisional policy. No production test, deployment, or merge was performed.

At review completion, 32 CI checks passed, four package coverage checks remained
pending, and none failed. The verified base was
de4edbaecf37cdc91ab01c7933a0fc012e8fb9f2 with merge-tree result
50e0a76156bec1eb89c07143b3ff61b1722246f2. This final commit only closes the
historical plan; the reviewed production/test/JSON tree is unchanged. Final
exact-head CI and refreshed mergeability are tracked on PR #3468. Keep its
worktree while the PR is open. No additional substantive review is needed for
this explanatory closeout under the review-loop exemption.
Completed: 2026-09-15
