# Native phone and Telegram messaging setup

Status: active
Created: 2026-10-06
Updated: 2026-10-06

## Goal

Members link their first phone or Telegram account inside either native app and
continue through canonical onboarding without a second Murph browser login.

## Scope and order

Murph is the source of truth. Implement its additive native protocol first,
then iOS and Android consumers in isolated worktrees. Android starts at the
unchanged PR 51 head. Open one PR per repository; no merge, deploy or publication.

## Decisions and boundaries

- Reuse the existing credential owner and first-messaging exception. Preserve
  canonical conflicts, fresh primary proof, established approval, SMS limits,
  atomic writes, session fences and channel wake. Account settings remains the
  fallback for protected accounts; stale sessions require primary login.
- Current main accepts a canonical phone before Linq thread materialization.
  Reuse its readiness projection rather than the task's older thread-only note.
- Telegram uses a random five-minute link in the encrypted auth verification
  store. Authenticated private bot ingress records proof; the original native
  member/session consumes it through the credential owner. No bot-link login,
  member creation, raw session storage or new table.
- Native drafts and tokens remain in memory. Sign-out/member changes reject late
  completions. Both clients recheck readiness after proof and Telegram return.

## Product UX

Feature effort. Journeys: email signup to phone/code/continue; Telegram Start and
return; wrong number/code, conflict, rate limit, stale session, protected account,
network failure, duplicate submission and sign-out during a request. Browser
fallback and Sign out remain reachable. Use matching cream/slate native layouts,
existing country selection and code inputs, and synthetic screenshots.

## Verification

- Isolated local PostgreSQL, synthetic SMS and crypto ports: 133 tests pass across
  canonical credential/Telegram, transport and Telegram route suites.
- Web typecheck and complexity guard pass; existing unrelated webhook hotspots
  are unchanged. No new database work for ordinary Telegram messages.
- Android full verification passed with CI public placeholders; iOS build and
  712 app plus 195 extension tests passed. A Simulator AX startup timeout affected
  UI-test runner initialization; retrying on a dedicated simulator.
- Remaining: final native fixtures/evidence, source review, PRs, exact-head CI and
  required ReviewGPT. Real SMS, Telegram and physical-device delivery unverified.
