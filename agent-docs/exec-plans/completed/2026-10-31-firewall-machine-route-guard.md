# Guard machine Web routes against firewall barriers

Status: completed
Created: 2026-10-31
Updated: 2026-10-31

## Outcome and owner

Machine-called Web routes must not silently remain behind edge barriers.
The Web scripts own a read-only scheduled check; route files and the existing
hosted-execution routes entrypoint own coverage. The supplied August deny
rules reproduce the missing alert; current config v8 has only public limits.

## Decisions and scope

Derive all internal routes, provider ingress and cron targets from source.
Classify browser OAuth callbacks explicitly and fail coverage on new ingress.
Use a pure conservative evaluator for custom/IP/managed rules and project
attack mode. Reuse the public WAF URL helper and trusted-main production canary
workflow pattern. No state, escape hatch, runtime behavior change, production
mutation, push, PR, or live-state merge gate. No member-facing changelog needed.
Unknown conditions remain may-match; API failures make the scheduled job red.
No runtime deploy skew is introduced. Rollback is a repository revert.

## Tasks

1. Inspect the complete live configuration and official API/CLI contracts.
2. Implement source inventory, evaluator, read-only script and hourly workflow.
3. Prove incident fixtures, live shapes, fail-closed cases and runner coverage.
4. Run focused tests/typechecks, live read-only proof, parent review and complexity guard.
5. Close plan and commit locally without pushing.

## Verification

All final checks below captured their process exit codes directly (no output pipelines):

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/vercel-machine-route-firewall.test.ts`: exit 0, 21 tests. First run exited 1 with one incorrect negation-test expectation; corrected and rerun. Includes optional catch-all negated-prefix regression found during parent review.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/web-control-route-contract.test.ts`: exit 0, 6 tests.
- `pnpm --dir apps/web typecheck`: exit 0. After final edits, `pnpm --dir apps/web typecheck:prepared`: exit 0.
- `pnpm --dir apps/cloudflare typecheck`: exit 0.
- `pnpm --dir packages/hosted-execution typecheck`: exit 0.
- `pnpm --dir packages/hosted-execution build`: exit 0; validates the changed public entrypoint.
- `pnpm --dir apps/web exec oxlint scripts/vercel-machine-routes.ts scripts/vercel-machine-route-firewall.ts scripts/check-vercel-machine-routes.ts test/vercel-machine-route-firewall.test.ts test/fixtures/vercel-machine-route-firewall.ts`: exit 0.
- `actionlint .github/workflows/vercel-machine-route-firewall.yml`: exit 0.
- `pnpm complexity:diff`: exit 0, zero new hotspots above 20; maximum new function complexity 18. Parent review found no useful further abstraction.
- `git diff --check`: exit 0. Authored-diff personal-identifier scan passed.
- `pnpm exec tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/check-vercel-machine-routes.ts` without credentials: expected exit 1 and fixed missing-token diagnostic.

Live proof used `pnpm exec tsx --tsconfig apps/web/tsconfig.json .tmp/firewall-live-validation.ts`
(exit 0). That disposable launcher called the exported checker with a fetch
adapter executing only `vercel api <GET path> --raw` from the primary checkout.
It used existing CLI authentication, kept both API responses in memory, and
did not retrieve production environment credentials. The production fetch
transport was separately exercised through injected response fixtures.
Output: `Vercel firewall check passed: 109 protected routes; zero conflicts.`
The live firewall was v8; attack mode was omitted (off by Vercel CLI semantics).
Official contracts inspected: [firewall config](https://vercel.com/docs/rest-api/security/read-firewall-configuration)
and [CLI attack-mode read](https://github.com/vercel/vercel/blob/main/packages/cli/src/commands/firewall/status.ts).

The Web test is explicitly registered in hosted-web-store-config; runner
coverage uses the existing cloudflare-node-platform contract suite. No live
state is required by either lane. The scheduled workflow is unactivated until
this local commit is integrated. No push, PR, production mutation, CI run,
or ReviewGPT submission was performed under the user's local-only boundary.
Platform automatic DDoS mitigation and actual hosted secret permissions remain
outside this local proof. Browser callbacks/companion APIs are intentionally
excluded; earlier firewall bypasses intentionally do not suppress conflicts.

Parent review covered all authored files, privacy, immutable route ownership,
AND/OR and negation semantics, unknown shapes, trusted controller ordering,
secret-safe errors, bounded GETs, and the authorized local-only completion.
The task-owned Frog entry records the silent tsx inline-launcher issue; the
file-based launcher produced the required explicit live success evidence.
Completed: 2026-10-31
