# Companion wrist reminders

Status: completed
Created: 2026-10-01
Updated: 2026-10-01

## Goal

Let Murph send an immediate buzz or stop to a connected WHOOP or Garmin through
the iOS companion. Existing runtime automations own delayed reminders.

## Scope and boundaries

- Source of truth for commands, authority and tool contracts: this repository.
- Downstream Bluetooth execution and Settings: the companion repository.
- Implement contracts and delivery first, then the native consumer, then verify
  synthetic assistant and device journeys together.
- Foreground delivery first. No watch alarm writes, new scheduler, push service,
  health telemetry, vendor SDK, production mutation, or physical haptic testing.
- Real phone UI checks wait for the other session's explicit handoff.

## Design

Use the existing device tool with a narrow haptic operation. Bind effects to a
private accepted input or runtime automation occurrence, never model-supplied
member identity. Keep one live session per member/vendor and short-lived durable
commands. Claim before Bluetooth I/O; never retry an ambiguous claim. Dedupe
runtime retries by originating input/occurrence and operation. Receipt means a
protocol acknowledgement, not proof the wearer felt a vibration.

## Tasks

1. Add strict shared contracts, bounded session/command storage and authenticated
   companion/internal endpoints.
2. Wire the runtime port and device tool; preserve existing scheduler behavior.
3. Add the foreground native consumer with session/sign-out/consent fencing.
4. Verify authority, expiration, duplicates, receipts, disconnection, both vendors
   and delayed tool selection using synthetic fixtures.
5. Run relevant typechecks, coverage, assistant journey, review and scoped commit.

## Evidence

- Full workspace typecheck, Web lint, Prisma validation/generation, public package
  build and complexity guard pass. Existing complexity debt decreases by four.
- Focused proof: 12 Web service/route tests, 32 engine device tests, six Worker
  transport tests, and 55 runtime device integration tests pass.
- Both live assistant journeys pass with synthetic effects: delayed WHOOP saves
  one existing automation with no early buzz and queues once when due without claiming delivery; uncertain
  Garmin delivery invokes once and gives an uncertain reply without retry.
- The exact migration was applied to temporary local PostgreSQL tables inside a
  rolled-back transaction; foreign keys and member-delete cascades pass.
- Native signed simulator unit suite passes (652 tests); focused lifecycle and
  delivery tests pass after independent review fixes. Protocol fixtures and Swift
  formatting pass. Simulator screenshots cover both vendors and Stop ordering.
- Hardware effects are deliberately untested; phone UI remains reserved by the
  other session. Delivery requires the app open and band connected when due.
- Changelog content generation and all ten archive rendering tests pass.

## Provider input evidence

A complete first-request capture through the real Codex App Server with a
credential-free scripted Responses endpoint compares identical synthetic
individual/group fixtures. Base is an exact device description/schema ablation
against 4b6c3432a8e2752b50c8590df34c732e32d57378; prompt builders are unchanged.
Only `prompt_cache_key` is excluded from decoded provider-visible JSON.

- Individual: 156214 → 157776 UTF-8 bytes (+1562, +1.00%). Instructions are
  unchanged at 90835 bytes; authored tool inventory is 60308 → 61444 bytes.
- Group: 130504 → 130504 bytes. Instructions are 65897 bytes and tool inventory
  38839 bytes at both revisions; the production planning owner disables device
  tools for groups.
- Exact target-model tokenizer is unavailable. No token estimate is reported.

## Final review and handoff

Final ReviewGPT round 1 passed on
`c14dffc6e35c978231b62efda5de71dcb6e8d845`. The Mountain lane selected GPT-6 Pro,
confirmed the full source attachment, and captured the exact committed turn and
`REVIEW_COMPLETE` response after 608 seconds. The reviewer checked all changed
blob hashes and reverse patch application and ran 13 independent service checks.
No Critical, High or material Complexity Collapse finding qualified. Parent
review accepts the result; physical and PostgreSQL-concurrency limits remain
explicit. The first browser launch failed before submission and produced no
substantive review.

CI then identified stale export/migration/member-relation test inventories and
an unindexed durable reference. Only those isolated tests and the documentation
index were corrected after the reviewed head. Ten package inventory tests, ten
schema/migration tests, the affected typechecks and doc gardening pass. No
production behavior, schema or contract changed after review, so the documented
non-production review exception applies.

Both final live assistant scenarios pass on the current default model. The WHOOP
reply reports queued/unacknowledged delivery; Garmin reports uncertainty with
one request and no retry. A prior overbroad wording assertion was corrected,
then both complete live scenarios were rerun successfully.

The companion implementation and local independent review are complete in
[murph-ios #173](https://github.com/cobuildwithus/murph-ios/pull/173). Final exact-head
CI is tracked by [murph #3949](https://github.com/cobuildwithus/murph/pull/3949).
No deployment or real phone/Bluetooth action occurred. Real WHOOP vibration is
excluded; phone UI checks await the other session's handoff. Hardware validation
is not implied by protocol fixtures, simulator evidence or the backend review.
Completed: 2026-10-01
