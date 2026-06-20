# PR 225 ReviewGPT Round 10 Fix

## Goal

Fix the round 10 ReviewGPT finding: valid long hosted email reply envelopes must
fit through the hosted mailbox email-ingress callback body limit.

## Constraints

- Keep one shared callback body limit for raw-body reads and signature
  verification.
- Do not widen individual hosted email projection field bounds.
- Prove the actual route handler accepts a long valid hosted email ingress
  request body.

## Verification Plan

- Raise the signed callback body envelope budget enough for the bounded hosted
  email ingress payload.
- Add a route-level regression using a long serialized hosted email thread
  target plus allowed projection fields.
- Run focused web route tests and affected verification.

## Progress

- Round 10 finding received from ReviewGPT.
- Raised hosted mailbox email-ingress callback body budget to 64 KiB.
- Added route-level regression that sends a valid long hosted email reply envelope through `POST`.
- Proved the callback auth boundary receives the same 64 KiB budget and readable bounded body.
- Focused route test, `test:diff`, whitespace/privacy checks, and local audit passes completed.
Status: completed
Updated: 2026-06-20
Completed: 2026-06-20
