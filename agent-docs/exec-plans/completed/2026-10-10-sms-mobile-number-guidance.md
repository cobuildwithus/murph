# Explain unsupported SMS destinations

Status: completed
Created: 2026-10-10

## Outcome

A member whose SMS destination is explicitly rejected as a non-mobile number
receives an actionable number correction instead of temporary-outage guidance.

## Scope and proof

- Reuse the existing Twilio Verify error classifier and public auth error.
- Restrict the change to numeric provider code 21614 on HTTP 400 during send.
- Preserve verification, ownership bindings, quotas, success and outage paths.
- Use ReviewGPT for implementation and the final pushed candidate review.
- Prove synthetic provider-to-HTTP failures before and after; run focused tests,
  Web typecheck, privacy/docs/complexity guards and required exact-head CI.
- Leave the functional PR for human merge; no production effects are authorized.

## Product UX

Outcome: unsupported SMS destinations receive a clear correction.
Reaches: shared browser, settings and native SMS send paths; verification is unchanged.
Proof: actual adapter plus HTTP error serializer, synthetic success and failure controls.

## Ownership

The paused WhatsApp plan changes channels and has no implementation authority.
The auth-retirement PR changes legacy readers. Neither owns this error mapping.
Unrelated onboarding edits remain in their original checkout.

## Progress

- Public provider contract and existing source establish the missing classification.
- Existing Twilio, connected-app and vault-share owner suites: 122 tests pass.
- Implementation requested from ReviewGPT with public source and synthetic inputs only.

- ReviewGPT authored the exact classification and extracted existing diagnostic formatting.
- New before-proof: 2 positive cases fail, 65 controls pass. After: 67 transport,
  6 client and 10 changelog tests pass. Web typecheck and local guards pass.
- Parent candidate review: Ready; no added I/O, state, retry or privacy exposure.
- Final ReviewGPT PASS on 4095485236779506a287a000cc5a7d0de3222a59;
  no qualifying findings and no accepted unresolved findings.
- Exact candidate CI: 36 passing checks, three correctly skipped optional lanes;
  all required aggregates pass. Current-base merge-tree proof passes.
- Parent final review: Ready. Only explanatory plan/index closeout remains;
  functional source and regression proof stay byte-identical to reviewed head.
- Human merge only. No production OTP, configuration, or deployment action.
- Required final-head CI remains a gate after the explanatory closeout push.
Updated: 2026-10-10
Completed: 2026-10-10
