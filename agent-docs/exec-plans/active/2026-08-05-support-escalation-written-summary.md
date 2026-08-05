# Restore the written support issue

Updated: 2026-08-05

## Outcome

An explicit verified-private request for Murph human support records one
account-linked escalation while preserving Murph's concise, de-identified
product-only explanation of the issue for the support recipient. The explanation
is never copied from raw conversation text and remains bounded by the existing
feedback sanitizer and privacy contract.

## Owners and invariants

- Assistant Engine owns the model-facing feedback tool and verified-direct
  action-scope check.
- Hosted Execution owns the bounded reserved-prefix contract and shared
  sanitization.
- Web owns the member-linked marker, anonymous issue-detail row, daily cap,
  replay, and support email effect.
- Ordinary feedback remains silent and best-effort. Explicit support remains
  immediate, once-only, account-linked, and truthful about success or failure.
- The reserved prefix always selects the support owner; empty, malformed,
  wrong-kind, changelog-linked, group, and unverified requests fail closed.

## Tasks

1. Replace the lossy area/problem-only payload with Murph's bounded,
   de-identified product explanation after the reserved prefix.
2. Update direct tool, callback, privacy, replay, and prompt tests.
3. Restack the detailed-email PR so it reads the stored anonymous detail and
   includes that exact validated explanation beside the escalation metadata.
4. Run focused tests and typechecks, update both PR contracts, complete the
   required ReviewGPT correction gate and exact-head CI, then merge in stack
   order.

## Deployment

Merge the runner-policy PR first, then merge the Web email PR. Deploy the runner
before Web so the receiving formatter never sees an older unsupported payload.
Use the existing immediate container rollout and fingerprint smoke; no schema,
queue, migration, feature flag, compatibility state, or replay owner is added.
