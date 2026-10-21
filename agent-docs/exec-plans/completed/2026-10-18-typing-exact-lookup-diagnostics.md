# Observe active-turn exact input lookups and first-fetch CPU

Status: completed
Created: 2026-10-18
Updated: 2026-10-18

## Goal

- Make the existing hosted pass log say, per active-turn admission, whether the
  exact input lookup ran, how many inputs it was asked for and returned, and
  which existing filter step excluded the rest.
- Persist the two process CPU scalars the fetch observer already computes for
  the fetches it already records.
- Observation only. No behavior, order, policy, origin, threshold or window change.

## Success criteria

- One admission's exact-lookup observation reaches only that admission's
  existing route-query row, under overlap, reverse settlement, skipped exact,
  unsupported or custom sources, throws and cancellation.
- "Not called" and "unknown or not reported" are distinct from a reported zero.
- Real composed same-pass proof: a held group follow-up (plain, native reply,
  after a real `finish_without_reply`) is admitted into provider request 1 of
  the same pass. Request ordinals are [0,1], with no failure or retry and one
  combined delivery. The diagnostic is attributed to the right admission.
- A reachable policy exclusion (affirmative reaction) and an other-thread
  control keep their existing outcomes and report the excluding step.
- No new rows, row types, state owners, network calls or reads.

## Scope

- In scope:
  - engine input-source contract: an optional observation on the route query and
    optional reason counts on the exact batch;
  - `reply.ts` `listAutoReplyActiveTurnInputs`: build the observation from its own
    exact call and pass it to its own route call;
  - runtime `turn-input.ts`: reason counts recorded while the existing exact
    lookup filters execute;
  - `maintenance.ts`: log the observation on the existing input candidate query row;
  - Cloudflare `fetch-transport-collector.ts`: copy the existing CPU scalars;
  - docs: the log database section and the Cloudflare README fields paragraph.
- Out of scope:
  - any admission/selection/grouping/replyable change;
  - typing, window, delivery or callback changes;
  - new cgroup, GC or pre-fetch instrumentation;
  - historical incident conclusions.

## Constraints

- Technical constraints:
  - finite codes and counts only; no IDs, actors, anchors or text;
  - the redacted-JSON key budget (96) and forbidden key substrings;
  - the existing 20-row input-query log cap is unchanged (no added rows).
- Product/process constraints:
  - the change must be observation-only;
  - release order follows the current queue (behind #4197, then #4194);
  - coordinator candidate review comes before Ready/ReviewGPT.

## Design and ownership proof

- Association. `listAutoReplyActiveTurnInputs` (`reply.ts`) is the only caller of
  `listInputCandidatesByIds` (repo search) and runs strict, then exact, then route
  sequentially inside one call.
  - It builds `{called, requestedCount, returnedCount, exclusionReasonCounts?}`
    from its own local `exact` result and passes it on its own route query.
  - Pairing is by lexical data flow inside one invocation: no shared mutable
    state, last-call slot, cache, scheduler or cross-package framework.
  - Overlapping admissions, nested or unrelated source calls, and reverse
    settlement cannot cross-attribute.
  - Early return (no channel/binding) and skipped route discovery emit no route
    row, so the observation is absent rather than invented.
  - A throw or abort in exact propagates as before, and route is never called.
- Missing-observation semantics:
  - `called=false` with `requestedCount=0`: no pending notified IDs.
  - `called=false` with `requestedCount>0`: the source has no exact lookup.
  - `called=true`: `returnedCount` is the batch length. `exclusionSummary` is
    present only when the source reports it, so null means unknown, not zero.
  - Rows without the observation, such as pass-start candidate listings, carry
    no exact fields.
- Reasons. They are recorded by the runtime exact lookup while its existing steps
  run (read by ID, replyable filter, exact-successor walk, candidate filter), in
  their existing order and evaluation. The strict path is unchanged, and no
  grouping or replyable policy is re-implemented.
  - Grouping exclusions are one code (`not_grouped_with_anchor`). Sub-reasons such
    as reaction or route would duplicate engine policy, so they are not split.
- CPU. `observeHostedRuntimeFetchTransport` already computes `process.cpuUsage`
  deltas over each observed fetch. The collector only maps two more scalars onto
  the same three existing prefixes (first typing, first conversation mailbox,
  per-pass mailbox).
  - No new read, timer or I/O.
  - The values count all process threads. They narrow on-CPU vs off-CPU
    hypotheses for the fetch window only, do not attribute a main-thread cause,
    and do not cover pre-fetch time.
- Ownership: branch `fix/typing-exact-lookup-diagnostics-20261019` from main
  df2e9ec4ea in a clean reused task checkout (its prior PR #4177 is merged). No
  open PR, including #4194, touches these files.

## Risks and mitigations

1. Risk: the diagnostic changes admission results.
   Mitigation: the observation is built after exact returns and is only read by
   the logger. The reason recorder is a pure callback in already-executing branches.
   Tests assert identical admission outcomes.
2. Risk: rows exceed key or format limits.
   Mitigation: four keys plus two per prefix, with an existing summary encoder and
   parser tests.
3. Risk: an incorrect interpretation.
   Mitigation: docs state the semantics and limits; no latency claim.

## Tasks

1. Contract types, the `reply.ts` observation and the route query field.
2. Runtime exact-lookup reason recording.
3. Maintenance row fields.
4. Collector CPU mapping.
5. Focused tests: association/overlap, reasons, row fields, collector, and real
   composed same-pass W1-W4 plus reaction and other-thread controls.
6. Docs, Frog check, changelog decision, typecheck, complexity, commit, draft PR.

## Decisions

- Prefer the existing route row over a new row (no cap displacement).
- Keep a single grouping reason code.
- Include the CPU mapping: it is two existing scalars on existing rows (17/32 keys
  in the collector tests; the real invocation row stays far under the 96-key cap)
  with no new read.
- Changelog: none. These are observation-only diagnostics with no member-visible
  change and no latency claim.
- Frog: no repository friction entry. A shared-clone fetch refspec left
  `origin/main` stale until an explicit refspec fetch; that is machine-local state
  and is reported in the handoff.

## Verification

- `pnpm typecheck` in assistant-engine, assistant-runtime and apps/cloudflare: pass.
- Engine: reply-event-path, automation-runtime and local-service-live-input,
  362/362. Covers overlapping admissions with reverse exact settlement, skipped
  lookup, unreported reasons, a throwing lookup, and a source without exact lookup.
- Runtime: turn-input, maintenance, group-draft-window-admission (new),
  workspace-entrypoint-foreground-input and mailbox-conversation-import, 334/334.
  Also mailbox-import 45/45 and fetch-transport-log 3/3.
- Composed same-pass proof: plain and native-reply follow-ups, after a provider
  answer or a real `finish_without_reply`, are staged after request 0 and admitted
  into request 1 at the end of the 4 s window. Ordinals [0,1], no reply failure,
  one combined delivery, and exactly one exact-lookup row [1,1,none].
  Controls: an affirmative reaction stays out with `not_grouped_with_anchor:1`; an
  other-thread message is never offered to the exact lookup.
- Cloudflare: fetch-transport-collector + mailbox-port 20/20, container-entrypoint 83/83.
- Mutations (each restored), all caught:
  - a skipped lookup reported as zero;
  - the requested count taken from the wrong set;
  - a misnamed cursor reason;
  - reordered successor checks;
  - CPU copied from the loop scalar.
- `pnpm complexity:diff` (base df2e9ec4ea): pass, no debt change.
  `pnpm docs:drift` and `verify:workspace-boundaries`: pass.
Completed: 2026-10-18
