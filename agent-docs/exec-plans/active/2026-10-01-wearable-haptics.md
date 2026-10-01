# Companion wrist reminders

Status: active
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
  one existing automation with no early buzz and invokes once when due; uncertain
  Garmin delivery invokes once and gives an uncertain reply without retry.
- The exact migration was applied to temporary local PostgreSQL tables inside a
  rolled-back transaction; foreign keys and member-delete cascades pass.
- Native signed simulator unit suite passes (652 tests); focused lifecycle and
  delivery tests pass after independent review fixes. Protocol fixtures and Swift
  formatting pass. Simulator screenshots cover both vendors and Stop ordering.
- Hardware effects are deliberately untested; phone UI remains reserved by the
  other session. Delivery requires the app open and band connected when due.
- Changelog content generation and all ten archive rendering tests pass.

## Remaining

Complete parent candidate review, scoped commits, draft PR evidence, routed final
ReviewGPT and exact-head CI. Full target-tokenizer input counts are unavailable;
complete provider-request byte captures are being recorded with that limitation.
Physical-device validation and deployment are separate, unperformed steps.
