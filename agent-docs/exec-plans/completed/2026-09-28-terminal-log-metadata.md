# Expose bounded enum metadata in hosted-local failures

Status: completed
Created: 2026-09-28
Updated: 2026-09-28

## Goal and protected invariant

A terminal synthetic harness failure includes its runtime stage and event kind
without exposing log payloads, arbitrary error text, timestamps or identifiers.
Production logs are not inspected or changed.

## Existing owner and smallest correction

The status formatter currently discards all recent logs. Reuse the existing
closed runtime-control enums for level, component, phase and event code; select
only those constant values from at most the last eight entries. Preserve the
presence marker and existing raw-text redaction. Unknown enum values produce no
entry. No runtime logging schema, producer, endpoint or credential changes.
Reuse committed Frog report `20260917142016-hosted-local-terminal` without
inventing an issue binding while repository reconciliation is pending.

## Proof and completion

- Both terminal-failure paths and a bounded metadata/redaction regression fail
  before the formatter change. All 23 helper tests pass afterward.
- Regression coverage retains only the latest eight entries, excludes every
  non-allowlisted field and rejects unknown values in each selected enum.
- Raw-payload log guard and complexity pass; relevant typecheck, docs guards,
  parent review and exact-head CI complete the candidate proof.
- This changes diagnostic disclosure: independent required review and explicit
  human merge authorization remain necessary. No autonomous merge is allowed.

## Completion evidence

Cloudflare typecheck passes after its normal Prisma generation prerequisite.
All 23 focused tests pass, including both actual terminal-error paths; the three
new assertions failed before the formatter change. Parent privacy review found
no issues. Log and complexity guards pass. Required ReviewGPT and exact-head CI
remain external gates, followed by human merge authorization for this disclosure
change.
Completed: 2026-09-28
