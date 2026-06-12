Goal (incl. success criteria):
- Add a focused hosted-local e2e test proving an explicit hosted signup timezone reaches the hosted runtime assistant context through the activation/bootstrap path.
- Success means the `timezone-injection` hosted-local scenario activates a member with an explicit timezone, drives a real Linq assistant turn, and verifies the assistant prompt uses the activation wake timezone rather than the default fallback.

Constraints/Assumptions:
- Keep the implementation narrow: test and scenario registry only.
- Preserve hosted ownership boundaries; do not add production test-only routes or runtime behavior.
- Use synthetic member ids and IANA timezone values only; no real identifiers or secrets.
- Avoid overlapping active hosted-local e2e work beyond the minimal scenario registry entry.

Key decisions:
- Exercise the runtime boundary by sending a `member.activated` wake with an explicit `timeZone`.
- Do not broaden to browser onboarding; browser/header capture and web activation transaction already have focused tests.
- Assert through the next hosted assistant turn instead of adding a test-only v2 snapshot inspection path.

State:
- Implementation and focused verification complete.

Done:
- Read required workflow, verification, testing, and Cloudflare skill guidance.
- Inspected existing timezone unit coverage and hosted-local e2e patterns.
- Added the hosted-local timezone injection scenario and registry wiring.
- Verified the focused scenario, registry unit test, and repo typecheck.

Now:
- Close the active plan through the repo finish workflow.

Next:
- Commit and hand off.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/cloudflare/test/hosted-local-timezone-injection-e2e.test.ts`
- `packages/hosted-local-harness/src/e2e.ts`
- `packages/hosted-local-harness/test/hosted-local.test.ts`
- `pnpm --dir packages/hosted-local-harness exec vitest run --config vitest.config.ts test/hosted-local.test.ts --no-coverage`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/hosted-local-timezone-injection-e2e.test.ts --no-coverage`
- `pnpm typecheck`
Status: completed
Updated: 2026-06-12
Completed: 2026-06-12
