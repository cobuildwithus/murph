# Retire local Murph product surfaces

Status: completed
Created: 2026-11-02
Updated: 2026-11-02

## Goal

Delete local Murph entrypoints and polling runtime while preserving the hosted product.

## Success criteria

Four scoped commits remove OpenClaw, setup and the murph binary, local assistant wrappers, and inbox polling. Hosted onboarding paths and single-pass maintenance remain intact. Generated contracts, affected tests, typechecks, workspace guards, and runner assembly pass.

## Scope

Slices 1–4 of the reviewed removal map, plus the murph binary. Keep device daemon tooling, hosted-local development, shared delivery and persistence, and npm release machinery except OpenClaw. Completed plans remain immutable.

## Constraints

Work only in the assigned isolated checkout. No pushes, PRs, production access, or stashes. Use real generators, public package entrypoints, scoped commit helpers, and the existing supply-chain policy.

## Risks and mitigations

- Preserve hosted onboarding by moving its registration and tests before deleting assistant-cli.
- Preserve hosted maintenance and normalization by tracing callers and splitting mixed tests.
- Update every runner binary expectation together and run full assembly to verify startup and package shape.

## Tasks

1. Remove OpenClaw package and inventories; verify and commit.
2. Remove setup, model picker, and murph binary; regenerate contracts; verify and commit.
3. Move hosted onboarding; delete assistant wrappers and continuous loop; verify and commit.
4. Remove inbox polling; narrow retained services; complete docs, verification, review, and final plan-bearing commit.

## Decisions

- Hosted members use channels and iOS; vault-cli remains the runtime/operator binary.
- No hosted behavior change is intended beyond removing obsolete runtime prompt guidance.
- No publication or external review is started because the task explicitly forbids pushing and PRs.

## Verification

### Slice 1

- Removed OpenClaw source, tests, distribution assets, release entry, build/test inventories, and active documentation.
- Passed: pnpm install; pnpm build; pnpm verify:workspace-boundaries; pnpm verify:workspace-package-cycles; pnpm deps:guard; pnpm no-js; pnpm docs:drift; pnpm --dir packages/cli typecheck; focused release-script-coverage-audit tests (38 passed, one opt-in tarball test skipped).
- Initial release audit exposed ignored residue in the removed directory; removing the entire retired directory fixed it. The workspace coverage guard also required its expected owner count to decrease from 26 to 25.
- Full repository-tool results and the unchanged fixture blocker are recorded below; focused workspace-verify and release-verification-lanes rerun passed (61 tests).

CI-only broad coverage and production deployment remain outside this task.

### Slice 2

Removed setup-cli, operator setup helpers, model picker, setup wrappers and root scripts, the murph binary, terminal UI dependencies, and the local installer and its landing-page entrypoints. Retained hosted signup, device tooling, and all four hosted onboarding commands.

Generated the CLI schema, Incur command types, skill hash, and prepared runtime with the real generators. Workspace build and CLI/assistant-engine/operator-config/inbox-services/Web/Cloudflare typechecks pass. Operator-config tests: 455 passed; inbox-services tests: 67 passed; Web landing tests: 3 passed; focused prompt/access tests: 64 passed. CLI full suite passed 1396 tests before two stale expectations failed; both corrected and focused rerun passed 86 tests. Edited engine tests passed except one prompt digest snapshot, regenerated with Vitest and verified. Cloudflare Node workspace passed 4643 tests before two stale package/schema expectations failed; corrected focused rerun passed 12 tests. Containers helper passed 20 tests. The full verify:cli gate passed: 357 tests in 20 files, typechecks, prepared runtime, and package shape.

The repository-tool full run passed 880 tests and failed 28: one obsolete package count was fixed and its focused suite passed; 27 pre-existing review-context fixture tests attempt Git commits with a non-noreply synthetic email rejected by the machine privacy hook. Both fixture source files are byte-identical to origin/main. No guard was weakened.

Product UX: retired local install links and instructions are removed; hosted signup and account routes remain. Hosted channel/onboarding behavior is covered by the preserved runtime contracts. Source readback confirms hosted sections remain; server-rendered readback and focused real-Codex proof are recorded below.

Full runner assembly passed: CLI total 9,532,087 bytes, startup closure 19,857 bytes (33,200 budget); runner entry 77,854 bytes, static boot closure 2,014,162 bytes versus recorded 2,047,343 baseline (-33,181 bytes), 22 chunks, total 12,430,391 bytes. The final measurement below distinguishes the recorded baseline from an exact Linux origin/main comparison.

### Slice 3

Moved the four hosted onboarding handlers and their tests into the CLI owner. Removed local assistant wrappers, root aliases, and continuous polling loop. Retained the single-pass implementation verbatim and converted shared maintenance/cron tests to exercise it directly.

Slice 3 checks: pnpm install, CLI generators, pnpm build, CLI/engine/runtime/Cloudflare typechecks, workspace boundaries/cycles, dependency guard and no-js passed. Automation tests passed 177 before removing two loop-only signal tests; subsequent pass coverage passed. CLI onboarding handler and built resume-context tests passed. Compact-surface tests passed 24; artifact/routing focused tests passed 12; repo workspace/release checks passed 61. Obsolete root-route assertions were corrected; final full-suite results are recorded below. docs:drift passed after the index update.

Real-Codex proof passed: one provider request and one exact meal read through the built CLI, no retired command, canonical vault unchanged, no outbox intent; reply accurately reported the synthetic meal and recorded 347 calories / 19 grams protein.

### Slice 4

Deleted polling connectors, daemon orchestration, parser-daemon composition, local service control, and source configuration commands. Retained init/show, hosted channel normalization, persistence/SQLite/retention, document preservation, and repair. Read-only connector identity configuration remains necessary for existing source-filter semantics; no polling driver or configuration mutation API remains. Mixed tests retain normalization, attachment status, canonical persistence, path safety, and repair coverage.

## Final review and evidence

The four retained onboarding commands are `vault-cli assistant onboarding status`, `resume-context`, `complete`, and `reopen`. An AST-assisted comparison against the task base confirms all four registration bodies are identical apart from indentation; their helpers are byte-identical. The hosted `runAssistantAutomationPass` implementation and extracted inbox initialization implementation are byte-identical to the task base.

Final reference review also removed the orphan installer copy component, self-host signup footer and public-agent claims, twelve smoke manifests for retired assistant commands, their unused golden-output directory, and unused result schemas for deleted assistant commands. Historical release notes, completed execution plans, and historical feature inventories remain evidence rather than current instructions.

### Verification ledger

| Command or selected lane | Result |
| --- | --- |
| `pnpm install` | Passed after manifest edits; supply-chain policy retained. |
| `pnpm --dir packages/cli gen:config-schema` | Passed; regenerated schema, Incur types, and skill hash. |
| `pnpm build` | Passed; includes `node scripts/assemble-assistant-cli-surface.mjs`. |
| `pnpm build:test-runtime:prepared` | Passed. |
| `pnpm verify:workspace-boundaries` | Passed. |
| `pnpm verify:workspace-package-cycles` | Passed. |
| `pnpm deps:guard` | Passed for 26 manifests. |
| `pnpm no-js` | Passed. |
| `pnpm verify:cli` | Passed 348 tests, prepared artifacts, typecheck, and package shape on the final repeat. |
| `pnpm --dir packages/cli typecheck` | Passed. |
| `pnpm --dir packages/cli test` | Final full rerun passed: 1369 tests across 135 files, 30 opt-in tests skipped. The earlier obsolete auto-reply-wiring assertion was corrected; its focused file also passed both tests. |
| `pnpm --dir packages/assistant-engine typecheck` | Passed. |
| Engine Vitest with all edited tests plus onboarding and automation tests | Passed 1829 tests in 66 files; 613 opt-in tests skipped. |
| `pnpm --dir packages/assistant-runtime typecheck` | Passed. |
| Runtime Vitest `test/hosted-runtime-conversation-event.test.ts` | Passed 21 tests covering hosted normalization and projection. |
| `pnpm --dir packages/inboxd typecheck` | Passed. |
| `pnpm --dir packages/inboxd test` | Passed 195 tests; 3 opt-in tests skipped. |
| `pnpm --dir packages/inboxd verify:package-boundary` | Passed all 7 tests against real built public entrypoints. |
| `pnpm --dir packages/inbox-services typecheck` | Passed. |
| `pnpm --dir packages/inbox-services test` | Passed 29 tests, including real SQLite init/rebuild/idempotency and repair. |
| `pnpm --dir packages/operator-config typecheck` | Passed. |
| `pnpm --dir packages/operator-config test` | Passed 455 tests. |
| `pnpm --dir packages/parsers typecheck` | Passed. |
| `pnpm --dir packages/parsers test` | Passed 94 tests. |
| `pnpm --dir apps/web typecheck` | Passed. |
| Web Vitest landing, homepage claims, and comparisons | Passed 17 tests. |
| Web Vitest public-agent readiness and join-invite state/page/islands | Passed 55 tests. |
| `pnpm --dir apps/cloudflare typecheck` | Passed. |
| `pnpm --dir apps/cloudflare test:node` | Final full rerun passed: 4645 workspace tests, 5 skipped, plus 20 containers-helper tests. The earlier dependency-order fixture was corrected to select a normal dependency instead of the separately validated skills owner. |
| `pnpm --dir apps/cloudflare runner:bundle` | Passed full assembly and CLI parity probes. |
| `pnpm test:scenario-integrity` | Passed: 194 scenarios, 12 sample inputs, 28 golden-output directories. |
| `pnpm docs:drift` | Passed. |
| `pnpm complexity:diff` | Passed; no increased complexity debt. Remaining hotspots belong to retained hosted behavior and shared guards. |
| `pnpm test:repo-tools` | Blocked: 880 passed, 27 failed in two unchanged ReviewGPT fixture files because the machine privacy hook rejects their synthetic non-noreply commit email. Both files are byte-identical to the task base and origin/main. No guard was weakened. |
| `pnpm test:assistant:live -- --test 'real model saved meal exact read uses the built CLI without mutation'` | Passed: exact canonical meal read, accurate response, no mutation, no outbox, no retired command. |
| `git diff --check` | Passed. |

Final full bundle: CLI 7,577,815 bytes total, 805-byte entry, 19,814-byte static startup closure (33,200 budget). Runner 77,854-byte entry, 2,014,025-byte static boot closure across 22 chunks (24 budget), 12,374,344 bytes total. The boot closure is 33,318 bytes below the tooling's recorded 2,047,343-byte baseline. An exact origin/main Linux candidate/base comparison is CI-owned and was not performed locally.

### Product and rendered evidence

Hosted onboarding, channels, canonical writes, cron, outbox, maintenance, normalization, retention, and persistence retain their existing owners and behavior. Runtime prompt guidance no longer advertises deleted commands. Public local installer/self-host choices are removed, including `/install.sh`; hosted checkout actions and plans are unchanged.

A dedicated local Next server with synthetic configuration returned HTTP 200 for the homepage and security page, with no installer link or local-install heading, and HTTP 404 for `/install.sh`. The server was stopped through its owned terminal. Browser inspection could not run because the computer-use browser access host was unavailable. Responsive and visual inspection therefore remains unavailable proof, rather than a claimed pass. Product UX disposition: hosted behavior Ready from deterministic and live proof; visual evidence Hold pending an available browser.

Changelog decision: no member capability or hosted service behavior is added by retiring the unused local product. The public copy changes remove obsolete local/self-host choices; no new hosted feature is claimed. No public release entry is added.

### Retained boundaries and risks

Device daemon/bin/http, device CLI controls, device-agent APIs, wearable fixture capture, hosted-local development/harness/fake providers, and npm publication beyond OpenClaw remain deliberately unchanged. Shared local-service/runtime-lock/channel/delivery machinery remains. Read-only inbox connector identity configuration remains for existing source filters and initialization; polling and source mutation are gone.

No push, PR, production access, deployment, rollback, or external review was performed. Required hosted CI, exact-base Linux budget comparison, and unavailable browser proof remain outside this local commit handoff. A Frog entry records the reproduced Cloudflare artifact-test/CLI-verification race; final artifact-mutating checks are serialized.
Completed: 2026-11-02
Completed: 2026-11-02
