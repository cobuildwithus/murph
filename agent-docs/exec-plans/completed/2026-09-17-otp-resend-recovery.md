# OTP resend recovery

## Outcome
Allow one immediate retry when requesting a sign-in code and retain broader abuse controls.

## Scope and evidence
The admission loop charges the long contact budget before checking the one-send
minute limit. A denied rapid resend therefore consumes capacity without delivery.
Move that short-window check before the contact budget and allow two sends per
minute. Keep IP request and verification budgets unchanged. The native code-entry
recovery fix lives independently in the companion repository; no wire change.

## Product UX
Patch. Reaches browser and native phone/email sign-in, including reauthentication.
Replay initial send, immediate resend, denied rapid retries, and code verification.
Provider rejection can still consume a send attempt; no delivery guarantee is added.

## Validation
Eleven focused admission/delivery tests pass, including browser/native limits,
phone/email cooldown rejection, and unchanged verification budgets. Web typecheck
passes. Complexity stays at 17 with no hotspots. Parent diff review found no
additional issue. Product UX Ready for the bounded admission behavior; provider
SMS receipt and physical-device AutoFill are outside this server-only proof.
Required exact-head CI and ReviewGPT remain PR completion gates.
Status: completed
Updated: 2026-09-17
Completed: 2026-09-17
