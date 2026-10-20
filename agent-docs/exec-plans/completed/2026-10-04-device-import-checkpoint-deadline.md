# Respect foreground checkpoint deadlines in device import alerts

Status: completed
Created: 2026-10-04
Updated: 2026-10-04

## Goal and protected behavior

Honor the active foreground runtime's checkpoint publication deadline when
device work is awaiting that checkpoint. Preserve detection of expired,
runnable no-progress, unowned, and unrelated pending work.

## Owner and evidence

The Web device-import monitor currently knows only a fixed publication grace.
The runtime already publishes its changing foreground checkpoint deadline in
ingress latency evidence. Read that existing evidence with the active owner,
attempt and generation checks; retain connection-scoped checkpoint ownership.
No new durable state, provider behavior, runtime protocol or scheduler is needed.

## Scope and decisions

- Web observation, classifier, synthetic tests and the reliability contract.
- Bound the existing workspace read and latest foreground evidence per member.
- Missing or invalid evidence preserves current conservative classification.
- Grace is not progress; only accepted checkpoints credit or clear work.
- Internal operator alert correction; no member-facing changelog.
- Web-only change with legacy evidence fallback; deployment is separate.

## Tasks and verification

1. Add regressions for active deadline, expiry, attempt/connection isolation,
   malformed evidence, and checkpoint acceptance.
2. Extend the existing read and classifier; prove the SQL on local PostgreSQL.
3. Run focused Web tests, Web typecheck, complexity check and parent diff review.
4. Update the reliability owner and close with a scoped commit.

## Evidence

- Four synthetic classifier regressions failed before implementation.
- Focused classifier and monitor suites: 65 passing tests.
- Local PostgreSQL proof: active owner/attempt/generation binding, latest trace,
  missing evidence, future and expired observation windows, subject isolation,
  empty input, and maximum 1,000-member selection all pass.
- Web typecheck and complexity guard pass; no changed source exceeds the
  complexity threshold. Parent review preserves aggregate-only reporting and
  separate primary/runtime-log databases, with no added datastore round trips.
- No member changelog: this changes internal operational alert classification.
- No production mutation or deployment; external PR review and exact-head CI
  belong to a later PR delivery step.
Completed: 2026-10-04
