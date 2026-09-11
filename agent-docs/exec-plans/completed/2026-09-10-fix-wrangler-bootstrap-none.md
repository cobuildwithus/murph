# Use supported Wrangler for namespace-only bootstrap

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

- Let the existing namespace bootstrap invoke a supported no-container-update Wrangler deploy without changing the native release sequence.

## Success criteria

- The exact direct Wrangler accepts `--containers-rollout=none` with a synthetic container config and unusable Docker executable.
- Existing bootstrap receipts, native rollout ordering and failure guards remain unchanged and pass focused proof.
- Existing ARM64 egress behavior and dependency security overrides remain effective for both installed Wrangler versions.

## Scope

- In scope: exact Wrangler 4.93.0, its workers-types peer, matching patch and security overrides, lockfile, focused proof, and deploy owner documentation.
- Out of scope: production actions, namespace or release algorithm changes, test-pool upgrades, rollback, and broader dependency refresh.

## Constraints

- Technical constraints: retain `--containers-rollout=none`, before/after native receipts, selection-off bootstrap, and immutable image admission. Preserve pinned compatibility dates and supply-chain gates.
- Product/process constraints: isolated guarded worktree; parent owns candidate review, ReviewGPT, CI, merge and rollout. Open a draft PR only.

## Risks and mitigations

1. The test pool continues to depend on Wrangler 4.90.0 and its Miniflare version.
   Mitigation: preserve the old patch and overrides while adding equivalents for the direct 4.93.0 dependency; exercise the direct executable independently.
2. An older deploy CLI parses the required flag before any deployment work.
   Mitigation: use the first upstream supporting release and keep a real secret-free CLI regression test.
3. Local dry-run cannot prove a production namespace migration or fleet convergence.
   Mitigation: leave the protected bootstrap receipts, managed smoke and release observer as mandatory rollout proof.

## Tasks

1. Completed: confirmed official flag semantics and exact dependency/patch compatibility.
2. Completed: updated minimal dependency declarations, lockfile and owner guidance.
3. Completed: proved the direct CLI, existing deployment boundaries, types and dependency security delta.
4. Completed: prepared parent candidate handoff, scoped commit and draft PR evidence; parent retains final review and deployment ownership.

## Decisions

- Wrangler 4.93.0 is the minimum supporting release (upstream PR 12656); omitting the flag would violate the namespace-only contract.
- Keep the test pool on its existing version and preserve both version-specific egress patches and security overrides.
- Align the direct workers-types dependency to 4.20260518.1 to satisfy Wrangler's declared optional peer.
- This deployment tooling correction does not change member UI, assistant input or product behavior; no public changelog item is needed.

## Verification

- PASS: `pnpm install --frozen-lockfile` with both version-specific patches and security overrides. The dependency-only lockfile update changed no unrelated package versions.
- PASS: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/deploy-worker-version-cli.test.ts apps/cloudflare/test/stage-runner-release.test.ts apps/cloudflare/test/container-release-receipt.test.ts apps/cloudflare/test/deploy-preflight.test.ts apps/cloudflare/test/deploy-wrangler-bootstrap-cli.test.ts --no-coverage` — 176 tests across five files.
- PASS: `pnpm --dir apps/cloudflare typecheck`.
- PASS: `pnpm deps:guard`; `pnpm deps:ignored-builds` inspected, with no build-script approval changes.
- BASELINE FAILURE: `pnpm deps:audit` reports 108 existing advisories (3 critical, 45 high, 53 moderate, 7 low). An audit of the immutable base lockfile and candidate returned identical advisory IDs and severity counts; no newly introduced advisory IDs. Existing vulnerable Sharp and Undici versions are also dependencies of the new Miniflare graph; this focused repair neither suppresses nor remediates that broader debt.
- PASS: installed Wrangler 4.93.0 and retained test-pool Wrangler 4.90.0 both contain the unchanged ARM64 selection, digest stripping and selected-platform pull behavior.
- PASS: `pnpm complexity:diff --base 4d9f9172c36613c0fadbe7cd0f11197fe067d43c` — no authored production JavaScript or TypeScript changes; `bash scripts/check-agent-docs-drift.sh`; `git diff --check`.
- Independent read-only dependency review confirmed the existing staged version APIs are unchanged across the two upstream releases. The direct CLI proof covers namespace bootstrap and version upload without credentials or Docker; it does not prove a live namespace migration or native convergence.
- Exact final PR CI and ReviewGPT remain with the parent. Protected predeploy hosted-local journeys exercise the updated direct Miniflare graph before a separately authorized release; production receipts, smoke and observer convergence remain required.
- Recorded the repository CLI/proof mismatch in the task-owned Frog entry using only synthetic reproduction steps.
Completed: 2026-09-10
