Goal (incl. success criteria):
- Fix hosted-local Linq sends that fail before the Linq stub sees a request in containerized E2E.
- Success means the Worker provider egress intercept preserves container-reachable local provider aliases, focused egress tests pass, and the relevant Linq E2E path is proven or any blocker is isolated.

Constraints/Assumptions:
- Keep the fix simple and composable: no new scheduler, URL registry, retry owner, or broad fallback path.
- Preserve existing provider write-fence and credential-injection boundaries.
- Preserve unrelated dirty worktree edits and active lanes.
- Do not expose secrets, direct identifiers, full local paths, or raw private payloads.

Key decisions:
- Use the provider base URL that actually matched the outbound request as the upstream base instead of remapping accepted container aliases back to the original configured loopback URL.

State:
- Active.

Done:
- CI evidence was inspected: replies are attempted, but Linq delivery reports retryable `LINQ_API_REQUEST_FAILED` and the stub observes no request.
- Confirmed the staged runner-platform regression test passes already, so it does not reproduce the failing boundary.
- Patched provider egress routing so configured local aliases are identity upstream routes while default-host fallback routes still map to configured upstreams.
- Added direct Linq alias egress coverage and updated Telegram alias coverage.
- `pnpm --dir apps/cloudflare test runner-egress-intercept.test.ts` passed.
- `pnpm --dir apps/cloudflare test runner-platform.test.ts -t "keeps hosted-local Linq URL rewrite and provider fetch allowlist in sync"` passed.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/test/runner-egress-intercept.test.ts` passed, including `apps/cloudflare verify` with 82 test files and 1218 tests passing.
- `git diff --check -- apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/test/runner-egress-intercept.test.ts apps/cloudflare/test/runner-platform.test.ts agent-docs/exec-plans/active/2026-06-02-hosted-linq-egress-alias.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- Security/privacy review reported no findings.
- Coverage-write review reported no additional test changes needed.
- Final task-finish review reported no findings.

Now:
- Close this plan and create the scoped task commit if overlapping dirty work permits.

Next:
- Handoff with verification, review, and residual E2E gap.

Open questions (UNCONFIRMED if needed):
- Direct hosted-local Linq E2E was not started because another hosted-local dev/E2E stack was already active in this checkout; starting a competing stack would risk conflating this fix with unrelated concurrent work.

Working set (files/ids/commands):
- `apps/cloudflare/src/runner-egress-intercept.ts`
- `apps/cloudflare/test/runner-egress-intercept.test.ts`
- `apps/cloudflare/test/runner-platform.test.ts`
- `apps/cloudflare/test/helpers/hosted-local-linq-support.ts`
- `pnpm --dir apps/cloudflare test runner-egress-intercept.test.ts`
- `pnpm --dir apps/cloudflare test runner-platform.test.ts -t "keeps hosted-local Linq URL rewrite and provider fetch allowlist in sync"`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/test/runner-egress-intercept.test.ts`
Status: completed
Updated: 2026-06-02
Completed: 2026-06-02
