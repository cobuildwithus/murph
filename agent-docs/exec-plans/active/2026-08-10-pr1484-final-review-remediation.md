# PR 1484 final ReviewGPT remediation

Status: active
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
- Focused tests, typechecks, lint, docs drift, and package-boundary proof pass
  locally; the pre-remediation reconciled head also passed complete GitHub CI.
- Pending: push the webhook remediation, complete ReviewGPT round three and
  exact-head CI, run the parent final review, archive this plan, and mark the PR
  ready without merging.
