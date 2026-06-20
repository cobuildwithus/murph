# PR 225 ReviewGPT Round 11 Fix

## Goal

Fix the round 11 ReviewGPT finding: mixed-version Cloudflare-first deploys must
not delete raw hosted email messages when old web rejects a newly enlarged
email-ingress envelope with HTTP 400.

## Constraints

- Preserve the no-truncation hostedmail fix.
- Keep raw-message cleanup only for truly definitive client errors.
- Add focused Worker ingress proof that HTTP 400 append failures retain raw
  message storage.

## Verification Plan

- Exclude HTTP 400 from definitive hosted email append cleanup.
- Add a Cloudflare Worker ingress regression for append HTTP 400.
- Run focused Cloudflare tests and affected verification.

## Progress

- Round 11 finding received from ReviewGPT.
- HTTP 400 append failures no longer count as definitive cleanup.
- Added a Worker ingress regression for long-envelope HTTP 400 append rejection
  retaining the raw hosted email blob.
- Deep review found the remaining definitive-status cleanup path was race-prone
  for deterministic raw-message keys. Removed append-failure raw cleanup
  entirely.
- Added encrypted recovery refs next to raw hosted email blobs so retained
  append-failure messages can be recovered without exposing raw message ids in
  object paths.
- Extended the hosted email raw-message lifecycle backstop to 24 hours and made
  worker deploy apply the checked-in lifecycle rules before `wrangler deploy`.
Status: completed
Updated: 2026-06-20
Completed: 2026-06-20
