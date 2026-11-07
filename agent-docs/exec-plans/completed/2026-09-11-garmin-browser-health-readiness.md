# Separate wearable tunnel readiness from connect navigation

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

- Distinguish actual remote-browser transport readiness from connect-page
  navigation so a reachable slow page receives its normal browser timeout.

## Success criteria

- A real Chromium and HTTP-server proof admits immediate healthy transport and
  exactly one connect navigation that takes longer than five seconds.
- Non-200 health and an exited owned tunnel cannot admit connect navigation.
- Existing browser tests and Web typecheck pass. Diagnostics remain content-free.

## Scope

- In scope: wearable browser navigation owner, existing Chromium smoke proof,
  its verification paragraph, and task-local friction evidence.
- Out of scope: provider calls, credentials, workflow changes, provisioning,
  dispatch, publication, and claims about the original hosted failure's cause.

## Constraints

- Preserve the 60-second tunnel cap, five-second probe attempts, owned-process
  checks, provider and canonical-data assertions, cleanup, and enclosing budgets.
- Use the real remote page for health navigation, with its existing session
  cookie and the existing fixed no-store unauthenticated health route.
- Root approved the complete local candidate and authorized a scoped commit,
  bounded push, and draft PR. Root retains Ready, final review, and hosted-run ownership.

## Risks and mitigations

1. A local HTTP client could falsely prove remote transport.
   Mitigation: issue health navigation through the same Chromium page as connect.
2. Slow transport or non-200 responses could become false success.
   Mitigation: require HTTP 200 under the unchanged bounded loop and child checks.
3. Navigation failures can include credentials or URLs.
   Mitigation: expose only fixed stage/error text for these navigation stages.

## Tasks

1. Add the real-browser regression and demonstrate its failure before the fix.
2. Separate health readiness from ordinary connect navigation in the current owner.
3. Run focused regression, existing browser coverage, and Web typecheck.
4. Inspect privacy and scope, obtain parent review, and publish the approved
   candidate as a draft PR through the scoped completion wrapper.

## Decisions

- Reuse the existing headed Chromium smoke lane; add no dependency or workflow.
- The observed hosted failure's underlying cause remains unproven until a
  protected hosted run supplies the separated transport/navigation outcome.

## Verification

- Before correction, the real Chromium proof had two expected failures: the
  slow connect response hit the transport timeout, and unhealthy health was
  bypassed. The exited-child case passed.
- With `MURPH_E2E_HEADED_BROWSER_SMOKE=1`,
  `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage
  apps/web/test/hosted-headed-browser-smoke.test.ts
  apps/web/test/hosted-local-junction-wearable-browser.test.ts` passed all
  65 tests, including all 12 real Chromium smoke cases.
- The four new Chromium cases passed again after the fixture environment type
  correction. They use a real HTTP server and Chromium without Playwright
  routing or request interception. The tunnel's lifetime uses an owned local
  Node child; the tests do not prove Kernel SSH or exercise a provider.
- Web generated-input preparation completed. The first full typecheck caught
  a missing `NODE_ENV` in that child's fixture environment; after correction,
  `pnpm --dir apps/web typecheck:prepared` passed.
- `pnpm complexity:diff` passed with unchanged complexity debt; existing
  provider configuration and authorization hotspots were untouched.
- `pnpm docs:drift`, `pnpm docs:gardening` (zero issues), and
  `git diff --check` passed. Added source and task evidence were reviewed for
  private paths, identifiers, credentials, and provider payloads.
- Independent source review passed after correcting the exact-health-URL
  documentation wording. Parent reviewed all six authored files and approved
  the actual browser proof, privacy, scope, and preserved provider invariants.
- Internal test-harness correction only: no member-visible changelog or product
  rendering change. No hosted Kernel execution or Garmin acceptance is claimed.
Completed: 2026-09-11
