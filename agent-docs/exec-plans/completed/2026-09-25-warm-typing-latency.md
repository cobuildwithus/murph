# Shorten warm message admission and typing latency

Status: completed
Created: 2026-09-25
Updated: 2026-09-25

## Outcome and invariants

Start Linq typing at durable input staging so accepted text does not wait for
mailbox progress publication and assistant preparation. Preserve recipient
binding, auto-reply eligibility, replay suppression, one per-chat refresh loop,
provider-acceptance telemetry, cancellation, and canonical receipt checkpoints.

## Evidence and scope

Production metadata located a delay before Worker route handling, plus a
canonical progress callback between input staging and assistant admission.
The empty system pass reused the mixed prefetch; it was not another HTTP fetch.
Do not remove the canonical receipt/watermark durability barrier or introduce a
new wake transport. Inspect Worker startup locally; platform queueing and live
improvement remain deployment evidence, not a local benchmark claim.

## Architecture

Reuse channel-activity's existing importer-to-turn typing handoff for all
eligible Linq inputs. Remove the attachment-only eligibility restriction and
rename the existing helper to reflect its scope. No new owner, dependency,
queue, persistent state, configuration, or provider operation is needed.
Typing remains asynchronous and best-effort; the assistant takes the existing
handle, including an unresolved initial request. Failure cannot block admission.

## Product UX plan

- Outcome: reduce silence before typing for accepted text messages.
- Reaches: direct and authorized group Linq messages, including active turns;
  self-authored, replayed and ineligible inputs retain suppression.
- Proof: composed staging-to-HTTP acceptance and turn handoff, blocked progress
  persistence, pending/failing provider calls, cancellation, and attachment
  evidence ordering. No prompt, tool, model context or reply policy change.

## Tasks

1. Prove early text typing with a regression that fails at the old boundary.
2. Reuse the existing typing owner and preserve receipt checkpoints.
3. Run focused deterministic tests, package typecheck, complexity and privacy
   review. Inspect Worker startup without production mutations.
4. Update the durable contract and changelog, close this plan and commit.

## Verification

Three new composed text cases failed before the change because no typing HTTP
request started during blocked import completion. The changed implementation
passes the private/group and pending-provider handoff cases. The initial focused
four-file suite passed 104 tests; subsequent expanded lifecycle and unchanged
canonical checkpoint proof passed 16 selected tests. The final broader run passed
152 tests and failed five foreground entrypoint tests. All five failures reproduced
with unchanged production source (15 passed, five failed); the typing-related five
files passed all 137 cases. The baseline gap is recorded in the task-owned Frog
entry. Package typecheck, the log privacy guard, changelog generation and ten
changelog rendering tests passed.
Complexity guard passed with unchanged existing import hotspots (41, 33, 26).
The change removes one eligibility condition and introduces no new abstraction.

Worker startup was profiled through Wrangler with container rollout disabled;
the local CPU profile was approximately 175 ms and was removed after inspection.
This does not establish the cause of production pre-handler delay or justify a
Worker configuration change. The standard profiling command needs Docker even
in dry-run mode; the documented no-container option permits this CPU-only probe.

The assistant verification skill was consulted: this change does not alter model
input, tools, reply/silence policy or prose, so a paid stochastic model run cannot
prove the deterministic indicator ordering. Composed HTTP and lifecycle evidence
own this change. Product UX: Ready for the tested synthetic paths; live latency
remains unmeasured. Runtime proof uses synthetic inputs and injected delivery providers.
No production content or identifiers are persisted. No deployment is authorized.

## Completion review

Parent diff review confirmed that only typing start timing and failure cleanup
change; model admission, canonical checkpoints and routing authority remain
owned by the existing paths. The composed tests exercise the actual importer,
HTTP adapter and runtime handoff. No new network request, database operation,
retry policy or serialized wait is added. Production latency remains unverified
until deployment; pre-handler platform delay is a separate unresolved contributor.
This task ends with a scoped local commit. PR creation, external review, CI and
deployment have not been performed.
Completed: 2026-09-25
