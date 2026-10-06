# 2026-10-06 Companion wrist reminders

## Summary

Release preparation for the runtime-visible wrist-reminder capability in iOS
1.1.22 (43). The Web and native implementations are merged. This record does
not claim real-device background delivery or App Review approval.

## What changed

- Web accepts installation-bound push routes and wearable links, then sends
  a bounded wake for an unclaimed wrist command. Command receipts remain the
  delivery authority; an accepted push is not a completed buzz.
- The companion can keep a Bluetooth link in the background and respond to a
  requested wake. Delivery remains subject to iOS scheduling and force-quit
  restrictions, as described in the
  [wearable contract](../../agent-docs/references/wearable-haptics.md).
- Production push configuration uses the existing `APNS_TEAM_ID`, `APNS_KEY_ID`,
  and `APNS_PRIVATE_KEY` inputs. Credential values stay outside the repository.
  Activation follows the normal Git-managed Web deployment and its exact-commit
  Temporal admission check.

## Verification

- The [Web implementation](https://github.com/cobuildwithus/murph/pull/4033)
  landed with required checks passing.
- Nine APNs sender unit tests and a focused sender typecheck passed with
  synthetic test inputs; no production credential was used in tests.
- The [native implementation](https://github.com/cobuildwithus/murph-ios/pull/175)
  and [release update](https://github.com/cobuildwithus/murph-ios/pull/178) are merged. Release CI,
  nine focused wearable-delivery tests, archive signing, and App Store export
  passed for the release candidate.
- Build 43 was uploaded and processed by App Store Connect, assigned to the
  internal testing group, and added to the 1.1.22 draft submission, which is
  Ready for Review but has not been submitted.

## Follow-up

- Confirm a production Web deployment created after push configuration was
  saved passes admission and becomes current.
- Verify registration and delivery on a real phone using the TestFlight build,
  including foreground, locked/background, disconnection, and denied-alert
  cases. Do not infer device delivery from simulator or provider acceptance.
- Complete reviewer sign-in access and the App Review submission after device
  evidence is available.
