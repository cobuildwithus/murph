# Settings sign-in and cancelled invite recovery

Status: completed
Created: 2026-10-23
Updated: 2026-10-23

## Goal

Restore the Settings consent-control entry and distinguish cancelled invites without changing closed status enums.

## Scope and owners

Settings uses its existing auth-required component, auth completion owner and health consent control. Invite preview derives cancellation from the canonical game event. No schema, dependency, runtime or shared QA stack changes.

## Evidence and decisions

The signed-out Settings branch redirected ordinary visitors to the homepage. The invite preview mapped every void to expired without checking the cancellation event. Remove that redirect and derive an optional reason from one bounded event read. Only cancellation discloses the inviter first name; terms and private invitee labels remain absent. Old clients retain expired status. Plain native Settings entry must resume even for members at checkout stage.

## Product UX

- Outcome: sign in and reach Health data; understand an invite was called off.
- Reaches: signed-out and signed-in free/paid members, cancelled/expired/open/used invite holders, old clients.
- Proof: page rendering, auth completion return, consent-control tests, PostgreSQL lifecycle tests and production signed-out entry. Existing section URL is `/settings#data-privacy`.

## Tasks

1. Implement additive contract and Settings recovery; publish the contract to the shared handoff.
2. Run focused tests, PostgreSQL game suites, web typecheck and guards; inspect rendered states.
3. Commit with repository wrappers, open and ready PR, run requested deep review and ReviewGPT eragon concurrently with CI.
4. Merge when gates pass; verify exact-SHA production admission, health and signed-out Settings. Record evidence in the external status file.

## Verification

Local page/auth/consent/preview tests: 172 pass. Game PostgreSQL service/API/negotiation: 45 pass. Changelog rendering: 4 pass. Web typecheck, complexity and log guards pass. Six existing Settings complexity hotspots are unchanged; no broader refactor is justified.

Requested Astra read-only deep review completed. Accepted and fixed all three findings: Settings now uses authentication-only page access; its sign-in does not demand renewed health consent; cancellation attribution follows the event actor. Targeted tests cover each fix. Phone and desktop presentation inspected at 390/1280px. Final browser replay: 2 pass, signed-out Settings returns HTTP 200 and shows its sign-in prompt at both widths. Docs guard passes. PR #4343 owns CI, ReviewGPT and deployment completion. ReviewGPT eragon and exact-head CI will run on the pushed candidate; deployment evidence belongs in the external status handoff. Production is fix-forward only.
Completed: 2026-10-23
