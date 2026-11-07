# Exact event correlation for typing alerts

Status: completed
Created: 2026-10-19
Updated: 2026-10-19

## Goal

- Preserve real typing alerts while correlating reaction inputs with existing
  same-chat typing and reply evidence through the exact provider event.

## Success criteria

- Synthetic PostgreSQL proof covers reaction activity, isolation, expired
  coverage, exact event origins, and unchanged strict thresholds.
- Focused tests, Web typecheck, complexity check, and scoped commit complete.

## Scope

- In scope: the Web typing-alert query, synthetic regressions, and owner docs.
- Out of scope: alert thresholds, group draft admission, runtime transport,
  deployments, and speculative fixes for transport latency.

## Constraints

- Reuse mailbox dedupe identity and the provider event's existing indexed key.
- No schema, persisted state, foreground calls, or new dependencies.
- Keep all fixtures synthetic and all evidence public-safe.

## Risks and mitigations

1. Incorrect chat correlation could suppress real alerts.
   Mitigation: exact event identity plus existing member, time, and chat checks.
2. Derived identity could diverge from the provider-event owner.
   Mitigation: fixtures use the canonical TypeScript key builder.

## Tasks

1. Reproduce reaction coverage and later-event origin failures.
2. Replace message-based lookup with exact event lookup; remove repeated current
   chat discovery by carrying its projection from the existing observation.
3. Validate query behavior and access cost, update the owner, review, and commit.

## Decisions

- The provider event stores the reacted-to message identity; the reaction mailbox
  uses the reaction event identity as its synthetic message identity. Joining
  those message keys cannot recover the reaction's chat.
- The same exact event lookup also prevents later edits or delivery receipts
  from changing an older input's latency origin.
- This is internal operational alert correctness, so no public changelog entry.
- Web-only deployment uses existing columns and accepts old producer records.

## Verification

- Run the focused PostgreSQL typing-alert suite with a loopback test database,
  related latency monitor tests, Web typecheck, and complexity diff.
- Required outcomes: new regressions fail before the fix and pass after it;
  ordinary slow inputs, expiry, and cross-member/chat isolation remain covered.

## Results

- All three new PostgreSQL regression cases failed against the old query, while
  its fourteen existing cases passed. All seventeen pass after the correction.
- The focused PostgreSQL typing, latency monitor, and latency cron suites pass:
  77 tests across three files. The PostgreSQL suite passed again after adding
  coverage for an already-hashed event identity.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm --dir apps/web exec eslint src/lib/hosted-runtime-latency/typing-alert-monitor.ts test/hosted-runtime-typing-alert-postgres.test.ts` passed.
- `pnpm complexity:diff` passed: source maximum remains 5, with no hotspots.
- A bounded read-only query-plan probe of the exact-event/prior-typing joins
  used existing indexes without full-table scans. It is diagnostic evidence,
  not a maximum-load benchmark. The existing 1,005-candidate pagination test
  remains green.
- Parent review confirmed member/chat isolation, expiry and reply cutoff,
  event-key parity, receipt fallback, and no new foreground work or state.
- Removed redundant current-chat discovery and latest-message-event sorting.
- No runtime scheduling, provider, delivery, or external authority contract
  changed. This is a local commit of the internal alert-query correction;
  deployment and broader transport investigation remain separate work.
Completed: 2026-10-19
