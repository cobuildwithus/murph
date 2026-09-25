# Re-resolve billing browser controls during hydration

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Let the hosted billing browser harness find the current hydrated control when React replaces server-rendered markup, then perform one normal browser click.

## Success criteria

- Actual React and Chromium prove retained and replaced production Family buttons both open the confirmation with exactly one click.
- A never-hydrated control fails within the configured timeout without a click.
- The hermetic billing gate runs those regressions without Stripe authority; existing live provider and canonical billing outcome assertions stay intact.
- Focused support/workflow tests, relevant typecheck, complexity review, and parent candidate review pass before PR handoff.

## Scope

- In scope: shared test-driver hydration polling, real-browser fixture/regressions, existing hermetic CI job, testing owner documentation, and task friction record.
- Out of scope: production UI, billing routes, provider operations, secret/env changes, protected workflow dispatch, and diagnosing an unobserved specific hydration trigger.

## Constraints

Keep one ordinary Playwright click. Poll current semantic locator resolution under the driver's configured timeout. Preserve actual React event attachment and all live billing business assertions. Do not fabricate React props or publish DOM, provider payloads, URLs, credentials, or browser traces.

## Risks and mitigations

1. Hydration can replace a captured element: resolve the locator during each bounded sample and prove real React recovery.
2. A regression could click before hydration or retry an external effect: require a real handler, assert zero clicks before hydration, and perform/assert one normal click afterward.
3. Existing CI artifacts identify stages but not the underlying hydration trigger: describe the independently reproduced helper defect without claiming it caused a particular hosted run.

## Tasks

1. Reproduce the stale-element failure with real React/Chromium. Done during read-only triage.
2. Replace the fixed handle with bounded current-locator polling and add real production-control regressions.
3. Wire the regressions into the existing hermetic billing job and update its documentation.
4. Run focused proof/typecheck/complexity, inspect the complete diff, request parent candidate review, and commit/open a draft PR.

## Decisions

- Keep the existing React click-handler predicate; change only which live node it observes.
- Reuse the installed Vite builder for an in-memory actual React/production Family control fixture; no added dependency, fake provider, app server, or durable build artifact.
- Keep the stage-only live diagnostic artifact unchanged. The regression directly proves the bounded helper correction; additional production-run diagnostics are a separate question.

## Verification

- `MURPH_E2E_BILLING_BROWSER_SMOKE=1 pnpm --dir apps/web test:prepared test/hosted-billing-browser-hydration.test.ts test/hosted-billing-live-support.test.ts`: 27 passed, including all three actual React/Chromium scenarios.
- `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/check-hosted-stripe-billing-ci.test.ts scripts/install-playwright-chromium.test.ts`: 34 passed, including removal of the browser proof and its activation flag.
- `pnpm --dir apps/web typecheck:prepared`: passed after normal fresh-checkout generation.
- `node scripts/run-typescript.mjs package -p tsconfig.tools.json --pretty false`: passed for the workflow guard and its mutation tests.
- `pnpm complexity:diff --base 3d0075d32c9b19037bd49a106062454ea95e5eea`: passed; the workflow guard retains debt 3 and maximum 23. Its sole hotspot, inspectHostedStripeBillingProviderBoundary, is unchanged. Test paths are excluded by the configured source scope; manual inspection found no new state owner or complex branching.
- `pnpm hosted-billing:ci-guard`, `bash -n scripts/install-playwright-chromium.sh`, and `git diff --check`: passed.
- The first fixture run exposed mismatched browser bundle NODE_ENV/JSX settings; the final fixture explicitly bundles production React with automatic production JSX and disables env-file loading. No production source change was needed.
- Parent candidate review passed after inspecting the driver, workflow, guard, complete real React fixture and browser regressions. Protected live Stripe matrix remains parent-owned after merge and is not local evidence for this change. The existing stage-only artifact cannot establish whether node replacement caused a specific hosted CI run.
- Internal-only harness change; no member-facing changelog or production deployment action.
Completed: 2026-09-10
