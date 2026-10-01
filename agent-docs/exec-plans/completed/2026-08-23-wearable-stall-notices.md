# Wearable delivery-stall notices

Status: completed
Created: 2026-08-23
Updated: 2026-08-24

## Goal

Text recently engaged members once when a connected push-primary wearable
source has stopped delivering data long enough to warrant a simple recovery
prompt, starting with Garmin while preserving a small provider-policy seam for
future evidence-backed additions.

## Success criteria

- Canonical `DeviceConnectionSource` freshness remains the only stall truth.
- Garmin members receive at most one direct Linq exact-text notice per silence
  episode after 72 hours, with no recovery notice or escalation.
- The notice reuses active-access, recent-inbound, direct-route, mailbox,
  idempotency, runtime-signal, and provider-entry egress owners.
- Copy has at least 20 deterministic variants and gives the provider-specific
  companion-app recovery step without claiming the source disconnected.
- The design adds no scheduler, database model or migration, provider callback,
  delivery service, recovery state machine, dependency, or environment flag.
- Focused tests prove eligibility, episode identity, suppression, replay, copy,
  and the exact existing delivery contract.

## Constraints

- Keep detection provider-aware. Do not infer that webhook silence means stale
  data for polled or phone-mediated providers.
- Reuse sources already loaded by the bounded runtime-apply owner; do not add a
  fleet scan or per-source database fanout.
- Keep database transactions short and database-only. Materialize and signal
  after the connection mutation transaction, with a final canonical recheck.
- Require active access, a recent inbound within the existing engagement
  window, and an established direct Linq thread. Never open a cold conversation.
- Exact-text notices must remain model-free while preserving producer-owned
  engagement admission and existing provider-entry line-health checks.
- Do not copy production identifiers, logs, or distinctive member scenarios
  into code, tests, docs, changelog, prompts, or PR text.

## Product UX journeys

- Eligible Garmin member: receives one short message saying recent Garmin data
  has not come through, suggesting Garmin Connect and device charge/sync checks,
  with one low-pressure question and no link.
- Quiet but ineligible member: receives nothing when access is inactive, no
  recent inbound exists, no established direct thread exists, or egress blocks.
- Repeated stale passes: preserve one frozen message and one delivery identity.
- Recovered source: receives no success message; a later distinct stall may
  create one new episode notice. A queued check is revalidated and suppressed
  at provider entry if data resumes before delivery.
- Other wearable provider: unchanged until its transport semantics and observed
  false-positive rate justify an explicit policy entry and copy.

## Tasks

1. [x] Ask ReviewGPT Pro for a complete scoped implementation patch. Three
   source-backed attempts failed to return readable repository output or a
   usable artifact, so implementation continued locally instead of accepting
   unverified output.
2. [x] Implement the smallest scoped design in this task worktree using the
   provider policy, runtime apply, mailbox, engagement, and route owners.
3. [x] Run focused tests, typecheck, lint, diff/privacy checks, and direct
   episode replay proof.
4. [x] Add the member-facing changelog entry and complete the required
   preliminary specialist and final ReviewGPT gates on the exact PR head.
5. [x] Resolve accepted findings, run the parent final review, close this plan,
   and prepare the final PR candidate. Exact-head CI and merge remain the
   post-archive delivery gates.

## Verification

- Focused `packages/device-syncd` staleness-policy tests.
- Focused Hosted Web runtime-apply/materializer, copy-bank, mailbox ownership,
  and route/engagement tests.
- Affected package and Hosted Web typechecks plus scoped lint.
- `git diff --check`, repository privacy/path inspection, exact-head ReviewGPT
  gates, current-base merge-tree proof, and required GitHub checks.

Completed local proof: 9 focused device-sync policy tests and package build; 2
hosted-execution identity tests; 4 assistant-runtime frontier tests; 170 focused
Web tests; Web typecheck, scoped lint, clean-source Web typecheck with generated
device-sync output removed, and diff/privacy checks. Preliminary ReviewGPT
findings were resolved. Final ReviewGPT round 2 passed on the immutable
remediation head with no remaining qualifying issue. The archived commit is the
candidate for the final exact-head ReviewGPT, CI, merge-tree, and merge gates.
Completed: 2026-08-24
