# Runner autonomous self-wake floor

Status: completed

## Outcome and scope

Bound short, runner-published autonomous wake chains after a healthy burst while preserving member-awaited replies and retention deadlines. The runner image is the only deployment unit. Web, Worker, Temporal, the standby container, and the ten-minute foreground idle window remain unchanged. This floor does not cover webhook-driven starts, failures before the runner publishes a wake, or loops inside one invocation.

## Evidence and threshold

Read-only seven-day runtime-log aggregate ending November 10, 2026, grouped internally by member and UTC hour. A short self wake has `runtime.invocation_finished` `nextWakeAt` before log time plus five minutes, excluding `assistant_delivery` and `inbox_media_retention`; overdue wakes count. Exclude known November 5 and 10 loop-hour proxies with at least 25 invocations in that member-hour; November 2 is outside retention. No identifiers or payloads were selected. Among 893 nonzero member-hours: p50 1, p99 7.08, p99.9 11, maximum 11. A 20-wake allowance leaves nine above the observed maximum. The `assistant` reason is included conservatively because it can be autonomous or awaited; the log alone cannot classify it.

The `device-sync.pass_finished` `wakeReason=connected` tag appeared 815 times but is repeated by retained work, so it cannot alone identify a fresh connection. Excluding known-loop subjects leaves five distinct connected-tagged subjects; in the first hour after their first tag, short `device-sync.reconcile` self wakes had p50 0 and maximum 2, with at most seven total invocations. This is a small observational proxy, not complete device-connect backfill proof.

## Design and state owner

Keep one fixed-hour window: start time and count of committed short autonomous wake publications. Before the twentieth, preserve candidate times. At twenty, floor only the autonomous side to `now + 5 minutes` before choosing against foreground candidates. Reset after one hour; repair invalid or future starts. Retention and expiry deadlines bypass. The prior attempted hot-wake key and pending wake are invocation-local, so cannot hold the counter across cold restore. Use two additive aggregate-only keys in the existing workspace checkpoint `redactedStatus` (`hostedAutonomousWakeWindowStartedAt`, `hostedAutonomousShortWakeCount`), which is returned with cold-restored workspace state and accepted by the generic redacted-status parser (`packages/hosted-execution/src/parsers/runtime-log.ts:373`). Update them in the same checkpoint as the selected wake. A clean short autonomous return uses a status-only checkpoint with the existing snapshot reference; the composed test proves it creates no snapshot. Keep the canonical checkpoint's submitted wake equal to the persisted wake, including lost-ack recovery.

## Classification and paths to prove

- Foreground: pending assistant input and outbox delivery in `hosted-runtime.ts:1175`; selected current-turn continuation stays untagged at `workspace-assistant-phase.ts:9266`; external mailbox work and unknown `defaultOwned` provenance stay untagged. A member-awaited pass bypasses the floor (`hosted-runtime.ts:6018`).
- Autonomous: device-sync follow-up (`workspace-assistant-phase.ts:7732`) and `device-sync.reconcile` (`hosted-runtime.ts:1127`); cron/automation due when no foreground source ties (`workspace-assistant-phase.ts:2562,9266`); provider cleanup (`workspace-assistant-phase.ts:2617`); an exact due assistant wake just serviced with no member-awaited work (`hosted-runtime.ts:8634`). Do not infer from `assistant` alone.
- Normal assistant phase, system-mailbox mode and return, idle-maintenance checkpoint, and canonical status checkpoint all use the shared floor (`hosted-runtime.ts:1056,1274,3738,7506`). Retention-only keeps its deadline field (`workspace-runner.ts:2961`) and the return selector takes the earlier retention deadline (`hosted-runtime.ts:9889`). `runtime.invocation_finished` adds aggregate floor diagnostics only when applied (`hosted-runtime.ts:1568`).

The November 5 incident was a stale already-serviced `assistant` wake restored by a meal-thumbnail retry status checkpoint, rather than a new cron candidate (`hosted-runtime.ts` meal-media retry checkpoint; fix commit `96acaa5ebd`). Any replay of that incident must identify the serviced wake before the merge; reason-only classification would also catch member-awaited assistant continuations. The November 10 device retry is a device-sync candidate. `run-loop.ts` combines reply, routing, cron, and outbox wake times before returning `nextWakeAt`; the runner retains selected reply and outbox times but not the routing provenance. System-mailbox `defaultOwned` similarly combines foreground causal and autonomous items. Provenance must be retained or re-read at those owners before applying the floor.

## Failure modes and rollout

- A foreground candidate hidden under an `assistant` reason must never acquire the floor; replay pending reply, delivery retry, and signal arrival during a deferred autonomous wake.
- Invalid or future window state resets without indefinite delay. Old snapshots lack the field and use an empty window; old runners ignore the additive field in new snapshots.
- Reader-first runner image rollout is one binary. Roll forward if an older image erases its unrecognized field; do not assume a mixed-image counter is monotone. Observe aggregate `runtime.invocation_finished` floor fields after deployment.
- A clean invocation that republishes a short autonomous wake uses a status-only checkpoint and reuses the current snapshot reference. This adds one database checkpoint but no snapshot archive; it is off the member-awaited reply path. The focused test checks the snapshot call count is zero.

## Verification

Focused composed tests replay a 15-second device-sync cold-restore retry and an exact republished due assistant wake across 22 cold restorations, and a foreground arrival during a floored period. They verify the first 20 short wakes, five-minute floor, durable counter, and submitted/persisted/returned wake equality. A clean composed return reuses the snapshot reference without invoking snapshot creation. Candidate tests cover invalid/future/expired windows, foreground precedence, and retention exemption. Existing meal due-wake, device continuation, retention, pending-input idle maintenance, and background convergence tests pass. Run package typechecks and complexity diff; exact-head PR CI is pending. An old runner can parse additive redacted-status fields, but a mixed-image runtime replay has not been executed locally. No deploy, merge, or ReviewGPT in this task.
Updated: 2026-11-10
Completed: 2026-11-10
