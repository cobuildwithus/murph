# Growth dashboard identity review remediation

Status: completed
Created: 2026-07-26
Updated: 2026-07-27

## Goal

- Keep group-participant WAU/MAU available and historically stable when valid
  email events coexist with group messages or a participant's current linked
  identity later changes.

## Success criteria

- Valid email conversation messages stored under a thread container contribute
  no group sender and do not abort the dashboard.
- New Linq/iMessage and Telegram group wakes carry the member id already
  authenticated by ingress, and growth aggregation prefers that immutable
  admission-time identity.
- Direct messages cannot carry the group-only sender member id.
- Legacy retained Linq/iMessage and Telegram wakes remain countable through
  current unique lookup resolution, with a privacy-safe opaque fallback when no
  current member exists.
- Ambiguous or malformed sender evidence still fails closed.
- Focused tests, canonical verification, exact-head CI, and ReviewGPT
  remediation review pass.

## Scope

- In scope: hosted execution conversation-message contracts/builders/parsers,
  Linq and Telegram group ingress, growth aggregation, focused tests, and
  matching durable protocol/security documentation.
- Out of scope: database schema migrations, persisted analytics tables,
  attribution of unauthenticated group-email senders, and raw sender-level
  analytics output.

## Constraints

- Store only the accepted internal member id; never expose it to the assistant,
  UI, logs, model input, or telemetry.
- Do not rediscover authority from mutable identity tables for new-format group
  events.
- Keep the optional wake field additive so older readers can safely ignore it
  during deployment skew.
- Preserve unrelated active webhook work and the existing group-access,
  routing, and mailbox invariants.

## Risks and mitigations

1. Risk: a producer supplies a member id on a direct message.
   Mitigation: reject the field in shared builders and parsers unless the
   message is non-direct and route-authorized.
2. Risk: legacy Telegram identity deletion makes the dashboard unavailable.
   Mitigation: use the existing keyed lookup candidate as an opaque fallback
   after a unique current lookup fails to match.
3. Risk: mutable current identity reassignment rewrites legacy history.
   Mitigation: stop this for all new events at ingress; retain the bounded
   compatibility lookup only for the existing thirty-day tail and document its
   expiry.
4. Risk: valid email wakes are mistaken for malformed group evidence.
   Mitigation: explicitly identify and omit valid email conversation wakes
   after shared parsing while continuing to reject unknown or malformed wakes.

## Tasks

1. Add and validate the optional admission-time sender member id in shared
   conversation-message contracts.
2. Populate it from the already-authorized Linq and Telegram group ingress
   paths.
3. Prefer immutable evidence in growth aggregation, omit valid email wakes, and
   add the bounded legacy fallback.
4. Add focused producer/parser/growth regressions and update durable docs.
5. Run required verification, push the exact head, update the PR, and complete
   ReviewGPT round 2.

## Decisions

- Reuse the encrypted mailbox wake as the existing retained source of truth
  instead of adding a second analytics store.
- Use the internal member id accepted at ingress as the canonical
  cross-container/cross-channel identity for new group events.
- Keep legacy lookup compatibility only for the rolling mailbox retention
  window.

## Verification

- Focused hosted growth suite passed with 27 tests, including stable
  admission-time member attribution, valid group-email omission, unmatched
  legacy Telegram fallback, and ambiguous legacy identity rejection.
- Focused Linq and Telegram ingress suites passed with 112 tests across the
  three touched Web test files.
- Hosted execution builder/parser coverage passed with 27 focused tests and
  the full package suite passed with 421 tests across 37 files.
- Assistant runtime privacy regression passed and proved that the internal
  sender member id is not projected into assistant input.
- Typechecks passed for hosted execution, assistant runtime, and Web.
- `pnpm test:scenario-integrity` passed with 204 scenarios, 11 sample inputs,
  and 28 golden directories.
- Canonical local `pnpm test:diff` passed all affected repository guards,
  typechecks, Assistant Engine (2,749 passed, 6 skipped), Assistant CLI (128
  passed), Assistant Runtime (1,896 passed, 2 skipped), and Assistantd (40
  passed) before an unchanged CLI integration test timed out. Isolated
  reproduction proved the timeout was a self-deadlock behind the verifier's
  shared artifact lock rather than a failure in the current diff.
- Canonical exact-head acceptance could not be admitted locally because another
  worktree held the exclusive shared-host slot for more than two hours. The
  bounded Crabbox attempt was blocked before provisioning because the installed
  Blacksmith delegate rejects the repository-required `--stop-after` flag; no
  remote run or billable Testbox was created, and the guarded command was not
  bypassed.
- Exact-head PR CI passed all 27 checks, including release build and typecheck,
  Web verification, package coverage, hosted and device-sync E2E gates,
  frontend design proof, Vercel preview, and horizontal-overflow proof.
- `git diff --check` and the task privacy scan passed.
- Parent final review found no additional correctness, privacy, compatibility,
  or product-flow issue. The additive optional encrypted wake field remains
  safe for split deployment because older readers ignore unknown fields.
Completed: 2026-07-27
