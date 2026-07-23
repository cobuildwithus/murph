# Keep the authenticated home shell available during projection failures

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Keep `/home` recognizable and usable when independent dashboard projections
  fail, while preserving a truthful retry path when the authenticated session
  itself cannot be read.
- Remove the read-only page render from the mutating hosted-usage gate path.

## Success criteria

- `/home` reads usage through `readHostedAiUsageGate` and does not acquire the
  usage allowance beneficiary lock or repair allowance state.
- A failed optional home projection does not discard successful sibling
  projections or the core home content; the page shows one retryable partial
  load notice.
- Authenticated device-access, provider-config, and connection-read failures
  remain observable to `/home` instead of being converted into a false
  connect-device recommendation.
- Dashboard auth does not turn a known session-store outage into an anonymous
  dashboard snapshot or anonymous dashboard chrome, while public-page and
  public-sidebar auth keep their existing tolerant behavior.
- Checkout redirects and anonymous dashboard access retain their current
  behavior.
- Focused tests prove the read-only usage path, isolated projection failures,
  retry UI, and strict dashboard-auth failure.

## Scope

- In scope: hosted page auth, dashboard layout auth chrome, the home device-step
  projection, `/home` server projection composition, one shared home
  partial-load notice, focused tests, and the real component in `/design`.
- Out of scope: usage-accounting semantics, billing mutations, database schema,
  browser-vault loading behavior, other dashboard page loaders, and broad error
  infrastructure.

## Constraints

- Technical constraints: preserve redirect exceptions; keep all state with its
  current owners; use native settled-promise composition instead of a new
  loader manager.
- Product/process constraints: authenticated members keep the normal home
  content; errors are factual, calm, and retryable; no extra automatic
  messaging or user state.

## Risks and mitigations

1. Risk: swallowing a usage or billing failure could hide an important account
   state.
   Mitigation: show one visible partial-load notice whenever any server
   projection rejects, while retaining any authoritative notice that did load.
2. Risk: making dashboard auth strict could break the intended anonymous home.
   Mitigation: preserve a real `null` session as anonymous and rethrow only
   session-store failures; keep public/sidebar auth unchanged and represent a
   dashboard layout outage as its own retryable state.
3. Risk: retry UI becomes a new parallel recovery owner.
   Mitigation: the action only calls `router.refresh()` and adds no persisted
   retry state.

## Tasks

1. Add failing tests for dashboard-auth store outages and independent `/home`
   loader failures.
2. Split dashboard page and layout auth from the public tolerant fallback.
3. Switch `/home` to the read-only usage gate and settled independent loads,
   preserving authenticated device-step failures for that boundary.
4. Add the retryable partial-load component and design-catalog state.
5. Run focused and canonical verification, inspect the diff, close the plan,
   commit, push, and open the PR.

## Decisions

- Keep a real missing session anonymous. Only an unavailable session store is
  a dashboard load failure.
- Do not render dashboard sidebar account actions when dashboard session
  authority is unavailable.
- Use one compact partial-load notice rather than per-projection error copy.
- Preserve successfully loaded content instead of replacing the page body with
  a terminal error screen.
- Omit the device-connect action when its completion status is unknown instead
  of claiming the member still needs to connect.

## Verification

- Focused Vitest: 5 files and 63 tests passed for page auth, dashboard layout,
  home composition, browser-vault ownership, and device-step projection.
- Completion-dialog regression Vitest: 3 files and 55 tests passed after
  updating the home-page usage mock to the read-only owner.
- Canonical `pnpm test:diff`: dependency/workspace/privacy guards passed;
  Web typecheck passed; 494 files and 6,227 tests passed; lint passed with
  unrelated warnings only; dev smoke and production build passed.
- `pnpm test:frontend-design-proof`: 9 tests passed.
- The real partial and critical states are cataloged under
  `/design?tab=sections#home-partial-load-section`.
- Rendered screenshot proof is unavailable because browser discovery returned
  no available browser after the required troubleshooting check. The
  production build and deterministic component tests passed.
- Claude/Fable review was not retried after the parent lane reported usage
  credit exhaustion, per the repository stop rule.
Completed: 2026-07-22
