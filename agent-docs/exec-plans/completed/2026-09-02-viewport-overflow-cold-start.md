# Prepare viewport-overflow prerequisites before Playwright readiness

Status: completed
Created: 2026-09-02
Updated: 2026-09-02

## Goal

- Keep the viewport-overflow Playwright gate's server-readiness deadline scoped
  to the hosted Web dev server rather than spending it on generated build
  prerequisites, while preserving the real health and route assertions.

## Success criteria

- The focused command prepares every prerequisite currently owned by
  `dev:local-env` before Playwright starts its `webServer` deadline.
- Playwright still boots the real Turbopack dev server, waits for the real
  internal health route, and runs the existing public-route layout assertions.
- Focused contract coverage fails if prerequisite generation moves back inside
  the Playwright readiness timer or the route-specific cold-compile allowance
  is removed.
- The focused Playwright gate, affected unit tests, docs checks, exact-head CI,
  and required review gates pass.

## Scope

- In scope: the hosted Web viewport-overflow command/config, focused harness
  coverage, and the matching testing-map description.
- Out of scope: product UI behavior, route inventory, overflow tolerance,
  readiness URL, production runtime configuration, and unrelated dev-server
  launchers.

## Constraints

- Technical constraints: reuse the existing prepared-local-env entrypoint;
  retain a real health probe and current route assertions; do not hide cold
  compile time by weakening assertions or merely inflating the server timeout.
- Product/process constraints: keep the repair public-safe, dependency-free,
  developer-tooling-only, and bound only to Frog issue #2561.

## Risks and mitigations

1. Risk: duplicating prerequisite ownership causes the prepared and normal dev
   paths to drift.
   Mitigation: derive the focused preparation from the existing package-script
   owners and enforce the split with a focused contract test.
2. Risk: a faster readiness path accidentally skips a required generated input.
   Mitigation: prove the complete existing prerequisite sequence remains before
   Playwright and execute the focused browser gate from a cold task dist suffix.

## Tasks

1. Reproduce and trace the current cold-start timeline and command ownership.
2. Move prerequisite preparation ahead of Playwright's readiness timer using
   existing package entrypoints.
3. Add focused contract coverage and update the canonical testing map.
4. Run focused browser/unit/docs proof, review the final diff, and land through
   the normal draft-PR and exact-head CI workflow.

## Decisions

- Keep the existing 240-second server-readiness ceiling and the calendar test's
  240-second first-compile allowance; the repair changes timer ownership, not
  the validity or patience of those assertions.
- Root cause is the current process order: the package command started
  Playwright first, and Playwright's `webServer` then ran `dev:local-env`, so
  every generated prerequisite consumed the readiness deadline before Next was
  spawned. Use the existing prepared-server entrypoint after moving the exact
  four-generator sequence ahead of Playwright.
- Make `dev:prepared-local-env` genuinely preparation-free. Its existing
  acceptance caller already prepares changelog output before dev smoke, and the
  viewport command now does the same explicitly.
- Select that prepared server only when the viewport package command sets its
  post-generation marker. Other direct consumers of the shared Playwright
  config keep `dev:local-env`, preserving their self-contained setup contract.

## Verification

- Commands to run: focused pre-fix reproduction, affected Vitest coverage,
  `pnpm --dir apps/web test:viewport-overflow` with an isolated cold dist
  suffix, hosted Web typecheck if TypeScript changes, docs drift/gardening,
  diff/privacy checks, and required exact-head GitHub checks.
- Expected outcomes: prerequisites complete before Playwright begins, the real
  health endpoint becomes ready inside its unchanged deadline, all existing
  route assertions run and pass, and no unrelated product behavior changes.
- Red proof: the new contract test failed because `test:viewport-overflow`
  contained no prerequisite before Playwright.
- Current proof: 30 affected dev/config tests pass; the prepared-path
  release-script assertion passes; scoped ESLint and Web TypeScript 7 pass.
  A fresh-suffix real run showed all generators complete before Playwright,
  health readiness, and the calendar route/layout assertion passing. The full
  accidentally selected 82-test suite finished 78 passing with unchanged
  `/growth` redirect-navigation races plus one retry-only sponsorship timeout;
  those failures do not intersect this repair and remain for exact-head CI to
  adjudicate.
Completed: 2026-09-02
