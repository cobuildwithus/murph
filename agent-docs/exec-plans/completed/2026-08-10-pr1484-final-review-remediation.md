# PR 1484 final ReviewGPT remediation

Status: completed
Created: 2026-08-10

## Goal

- Close the final ReviewGPT loop for PR 1484 without merging it.
- Ensure an invalid member-owned provider application cannot authorize any
  stored-token return while repairable application state cannot block
  disconnect, consent-withdrawal cleanup, or account deletion.

## Invariants

- Every token-export result validates the exact connection-bound provider
  application inside the token-return transaction.
- Repairable missing, stale, malformed, or permanently undecryptable private
  application state never selects operator credentials.
- Strava cleanup may use only the stored access token for its credential-free
  deauthorization request before the existing local purge owner runs.
- Transient database, secure-box, root-key, and KMS failures keep propagating.
- No new queue, scheduler, persisted state, or background owner is introduced.

## Scope

- In scope: agent token export and refresh authority, provider disconnect and
  consent cleanup, account-deletion provider revocation, focused tests, and the
  matching reliability contract.
- Out of scope: merging PR 1484, changing provider credential storage, adding
  repair automation, or broadening baseline maintenance work.

## Verification

- Focused Web tests for agent export/refresh, provider-application resolution,
  disconnect, consent withdrawal, and account deletion.
- Focused device-syncd Strava and package-boundary tests.
- Web and device-syncd typechecks, targeted Web lint, docs drift, and diff
  hygiene.
- Final ReviewGPT correction round on the exact pushed head concurrently with
  required GitHub checks, followed by mergeability proof and draft removal.

## Progress

- Accepted the final round-one high-severity finding.
- Implemented exact token-return authority and repairable cleanup behavior.
- Accepted round two's material shared-webhook authority finding and added the
  existing durable-admission guard for application-bound connections.
- ReviewGPT round three returned `PASS` with `REVIEW_COMPLETE` for the exact
  substantive head after verifying every accepted correction and finding no
  remaining qualifying failure or complexity collapse.
- Complete GitHub CI passed on that reviewed head. The latest `main` then
  merged cleanly without changing the reviewed provider-application behavior.
- Reconciled-head proof passed: 121 hosted-wake tests, Web typecheck, targeted
  lint, docs drift, diff hygiene, and the parent final review.

## Completion

- The final ReviewGPT loop is closed with all accepted preliminary, round-one,
  and round-two findings resolved.
- The implementation keeps one Web-owned encrypted and revisioned application
  fact flowing through existing OAuth, token, cleanup, webhook, and scheduled
  reconciliation owners; it adds no service, queue, scheduler, or repair owner.
- The plan archive is the only remaining repository change. Its exact pushed
  head must pass GitHub CI and mergeability proof before draft removal; the PR
  must remain unmerged.
Updated: 2026-08-10
Completed: 2026-08-10
