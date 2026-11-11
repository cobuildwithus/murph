# Simplify frontend state ownership and recovery

Status: active
Created: 2026-11-10
Updated: 2026-11-10

## Goal

Reduce authenticated Web to Settings and supporting account flows, deleting dashboard-only lifecycles and duplicated billing controllers while preserving session, payment and native data authority. Correct group recovery after a transient linking failure.

## Success criteria

- Retired Home and Training redirect to Settings; their Browser Vault provider, warm cache, polling and demand state are deleted.
- Existing connection return links still show confirmations; shared native replica APIs and export remain.
- Successful group recovery after sign-in retains authenticated access and returns to Messages.
- Onboarding represents only currently produced stages.
- Billing plan changes have one controller with existing presentation and safety.
- Focused regression suites, web typecheck and complexity proof pass.

## Scope and constraints

Worktree branch: codex/simplify-web-20261110. Base: 34d9f4edc1.
Frontend source, retired Web-only routes, focused tests, owner documentation and release notes are in scope. No production mutation, backend payment endpoint retirement, generic state-machine framework or new dependency. The parent owns ReviewGPT, Ready admission and merge. Billing UI edits are delegated within this same checkout; all other edits remain with the completion owner.

## Product UX

Effort: Product change. Result: Ready for parent review; the PR remains Draft.
Outcome: signed-in Web opens Settings and supporting account flows. Retired dashboard links preserve callback queries and lead to Settings. A member who signs in and retries group address recovery reaches the existing return-to-group screen.
Reaches: signed-out Settings, signed-in destinations, connection callbacks, initial authenticated recovery, signed-out active-account recovery, unfinished accounts and terminal cross-account conflicts. Public marketing, native replica readers, assistant conversations and phone voice processing are outside the frontend retirement.
Proof: Chromium verifies redirects and Settings rendering, plus account navigation and billing confirmation at 390px and 1440px. Component regressions exercise failed first linking and successful retry, asserting the Messages action; billing tests preserve confirmation, pending payment, errors, source-plan binding and callback behavior.

## Tasks

1. Revalidate source callers and prepare dependencies through the shared host slot.
2. Retire Home/Training and delete their provider, cache, all refresh modes and route planner; retain shared native/export transport.
3. Reorder group authentication publication before recovery and share recovery completion.
4. Remove unreachable activating stage, previews and obsolete tests.
5. Consolidate billing controllers onto the existing plan-change owner.
6. Align signed-in navigation and callback confirmations with Settings.
7. Run focused tests, web typecheck, complexity and scoped documentation checks.
8. Review privacy-safe diff, commit and prepare a draft PR for parent completion.

## Decisions

- User explicitly approved retiring Training and reducing Web to Settings. This supersedes the narrower provider refactor: delete the whole page lifecycle instead.
- Preserve account/route generation fences and durable payment identities.
- Snapshot consolidation is unnecessary after removing its provider. Shared decode/publication and auth cross-tab invalidation remain used. The browser-only HTTP wrapper, unused Settings onboarding completion endpoint and group-join dependency on the retired Home marker are removed. Native companion onboarding remains.

## Verification

- Reproduced the group-recovery bug with a new regression before the fix: successful explicit retry incorrectly rendered Finish setup. The reordered auth publication passes it.
- Final focused Vitest run: 38 test files passed, 1 skipped; 765 tests passed, 6 skipped. It includes all retained changed Web test files plus Settings, Next config, shared export, game vault profile, companion meals/numbers/demographics and onboarding lifecycle suites. The six skipped PostgreSQL companion-enrollment cases require the optional concurrency-test database; no database behavior changed.
- `pnpm --dir apps/web typecheck:prepared` passed on the final source.
- `pnpm complexity:diff --base 34d9f4edc1` passed.
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/changelog-page.test.tsx --maxWorkers=2` passed.
- Final browser command: `VIEWPORT_OVERFLOW_PORT=3281 NEXT_DIST_DIR_SUFFIX=simplify-web MURPH_PLAYWRIGHT_GENERATED_INPUTS_PREPARED=1 pnpm --dir apps/web exec playwright test --config=playwright.config.ts settings-entry.spec.ts --workers=1`; both tests passed. CPU-heavy checks ran through the shared host-verification slot.
- Chromium proof passed: six retired paths return Settings, Home callback query survives, signed-out Settings renders, and Settings navigation plus Edge-to-Pulse confirmation fit 390px and 1440px.
- No remote services, billing mutations or production secrets used. Shared native decoder and export regression suites are included in the final run.
- Storage guard reports four pre-existing unmanaged worktrees; parent notified. No worktree cleanup attempted.


## Retained surfaces

- `/settings`, `/connect` device/connected-source management, and `/records` patient-portal connection/copy status.
- `/records/connect`, `/settings/accounts` and `/settings/data-privacy` remain explicit connection/native account handoffs.
- Ops routes remain internal operations. Public marketing and Health Commons remain public.
- Voice UI, APIs, runtime, design and proof tooling are excluded: a separate user-owned session is retiring that feature. All voice-specific edits in this task were restored to the branch base.
