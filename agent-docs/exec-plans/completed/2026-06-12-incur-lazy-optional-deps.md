Goal (incl. success criteria):
- Land a temporary pnpm patch for `incur@0.4.5` that matches the upstream lazy optional dependency startup fix.
- Success means plain built CLI JSON commands no longer load `yaml`, `@modelcontextprotocol/server`, or `@cfworker/json-schema`, while YAML output and skill/MCP behaviors still work.

Constraints/Assumptions:
- Use pnpm patched dependencies; do not fork `incur` or switch to git/url/file dependencies.
- Patch both published `src/**` and `dist/**` because `incur` exposes a source condition.
- Preserve public behavior and keep the patch temporary/traceable.
- Do not include legal names, local usernames, home directory paths, secrets, or absolute local paths in committed files.
- Worker sandboxes may block broader tsx IPC or localhost-based tests; parent-side verification is authoritative when worker sandbox limits are hit.

Key decisions:
- Keep the change dependency-local by using a pnpm patch file and lockfile metadata only.
- Avoid broad docs unless the patch filename/comment and lockfile metadata are insufficient.

State:
- Implementation and verification complete; ready for `scripts/finish-task` closure.

Done:
- Read required repo routing, architecture, verification, security, and completion workflow docs.
- Confirmed `incur@0.4.5` is present under local `node_modules`.
- Confirmed upstream PR patch is available locally and only covers upstream source/tests, so the Murph patch must also mirror runtime `dist/**` output.
- Added `patches/incur@0.4.5.patch` and pnpm patched-dependency metadata.
- Updated CLI import-surface tests to remove now-unused eager optional dependencies from the baseline and prove built JSON commands avoid `yaml`, `@modelcontextprotocol/server`, and `@cfworker/json-schema` while YAML output still resolves `yaml`.
- Ran `pnpm install --offline`, `pnpm deps:guard`, `pnpm deps:ignored-builds`, `pnpm --dir packages/cli verify`, `pnpm typecheck`, and direct built CLI JSON/YAML probes.
- Ran `.codex-6` coverage/proof review; it added the focused import-surface proof.
- Ran `.codex-6` final completion review; only finding was stale active-plan bookkeeping, addressed by this update and pending `finish-task` closure.
- `pnpm deps:audit` remains blocked by pre-existing high advisories in transitive app dependencies (`axios`, `@grpc/grpc-js`, `js-cookie`), unrelated to this `incur` patch.

Now:
- Close the active plan with `scripts/finish-task`.

Next:
- Monitor upstream `incur` for a release carrying the lazy optional dependency fix, then remove the local patch when upgraded.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `patches/incur@0.4.5.patch`
- `packages/cli/test/vault-cli-import-surface-contract.json`
- `packages/cli/test/vault-cli-import-surface-contract.test.ts`
- `packages/cli/test/release-script-coverage-audit.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-06-12
Completed: 2026-06-12
