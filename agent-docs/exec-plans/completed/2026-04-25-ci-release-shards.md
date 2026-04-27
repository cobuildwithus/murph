Goal (incl. success criteria):
- Fix the failing GitHub Actions run `24934246788` by addressing the failing release app verification and CLI package coverage shards.
- Success means the targeted local checks for the two failures pass, followed by required repo verification/audit/commit workflow for the touched files.

Constraints/Assumptions:
- Preserve unrelated dirty Health Commons content/research rows and existing active ledger work.
- Do not print or write personal identifiers, secrets, raw credentials, or local home paths.
- Keep the fix limited to stale expectations or the narrow CLI config-default/vault-default behavior proven by the logs.

Key decisions:
- Treat the release-check aggregator failure as downstream of the app and CLI shards, not as a separate root cause.

State:
- in_progress

Done:
- Read required repo routing, architecture, product, verification, completion, and testing docs.
- Inspected Actions run `24934246788`; identified failing jobs and failure snippets.
- Registered the active CI-fix lane in the coordination ledger.
- Updated stale hosted-web Health Commons sauna research group count expectations.
- Let non-`murph` JSON/machine-output CLI requests reach Incur when no default vault/config is available, preserving the human-output early missing-vault preflight.
- Added CLI entrypoint coverage for `--format json`, `--json`, and `--format=json` missing-vault JSON requests.
- Isolated the CLI config-default smoke test from repo-local `vault/` autodiscovery by running the built CLI from a temp cwd/HOME.
- Ran security/privacy review and coverage-write passes; neither required production changes.

Now:
- Run final completion review and close/commit or archive the active plan as the dirty shared worktree safely allows.

Next:
- Handoff with exact verification status, including unrelated local blockers.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether current unrelated active-plan and Health Commons generation drift will be resolved before a broader local rerun; focused CI-failure proof is green.

Working set (files/ids/commands):
- GitHub Actions run `24934246788`
- `apps/web/test/health-commons-experiment-detail-page.test.ts`
- `packages/cli/src/cli-entry.ts`
- `packages/cli/test/cli-entry.test.ts`
- `packages/cli/test/incur-smoke.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
