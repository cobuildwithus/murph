# Four-pass test pruning and reviewed PR completion

Status: completed
Created: 2026-10-21
Updated: 2026-10-22

## Goal and invariant

Run four additional pruning passes over the existing test suite, remove low-value
maintenance load, and retain stronger executable proof of critical user outcomes.
Complete the combined cleanup through a PR, valid ReviewGPT result, required
exact-head CI, and an authorized merge. Production behavior stays unchanged.

## Ownership and evidence

The existing test owners and runners remain authoritative: Web Playwright and
Vitest, built CLI journeys, assistant real-Codex journeys, and Cloudflare bundle/
runtime integration tests. Source spelling, prose, structural identity, and
mock-only expectations are candidates, not behavioral contracts. Every removal
cluster must identify surviving executable proof or add a composed replacement.

The original local checkout lagged current main. Only the task cleanup commit
was rebased onto the verified remote base; unrelated local commits remain outside
this PR. Upstream feature retirement and newer unique tests take precedence over
stale proof. The first cleanup plan remains immutable historical evidence.

## Four passes

1. Remaining static assertions: source text, CSS, prose, metadata inventories,
   export identity, and tests that mirror constants.
2. Duplicate coverage: repeated happy paths or boundary cases already exercised
   by stronger current integration/end-to-end tests.
3. Mock and implementation coupling: tests that only prove stub wiring, private
   call ordering, or internal decomposition without protecting an outcome.
4. Consolidation: replace fragmented low-value clusters with compact real
   browser, fresh-process CLI, composed runtime, or live-assistant flows; review
   the complete final removal inventory for unique invariants and stale wiring.

Each area records its findings and changes by pass. A pass may retain a case
when its unique invariant cannot be proved elsewhere; there is no deletion quota.

## Scope and constraints

- Four disjoint parallel areas: Web; non-assistant packages; assistant engine and
  runtime; Cloudflare and repository tooling.
- Parent owns integration, current documentation, dependencies, final review,
  PR, ReviewGPT, CI, and merge.
- Keep auth, billing, privacy, health-safety, canonical persistence, recovery,
  idempotency, and authority coverage; prefer executable proof over prose locks.
- Reuse existing harnesses; no new production owner, dependency, persisted state,
  runtime policy, deployment, or provider communication is needed.
- Synthetic fixtures only; no personal identifiers, private data, or auth contents
  in authored artifacts. Credentials remain inside existing authorized tooling.
- Respect process ownership and retain unrelated work.

## Risks and mitigation

- Lost unique coverage: per-cluster retained-proof mapping and parent diff review.
- Brittle replacement: assert observable effects and complete flows, not exact
  copy, incidental model steps, or private implementation structure.
- Current-base drift: focused checks run against the reconciled branch; required
  CI and ReviewGPT bind to the stable pushed head.
- Stochastic/tooling failures: preserve exact invocation evidence, use documented
  bounded recovery, and report blockers rather than infer success.

## Completion

Finish four passes, run focused proof and typechecks, inspect privacy and complete
diff, update current test documentation, close the implementation plan, commit,
open/update draft PR, mark ready after local proof, launch ReviewGPT alongside
CI, remediate supported findings, and merge only after required gates pass.
No member-facing changelog is needed for internal test maintenance.

## Pass results

All four areas completed all four passes on the reconciled current base.

| Pass | Web | Packages | Assistant | Infrastructure |
| --- | --- | --- | --- | --- |
| 1: static inventories | Metadata/copy/visual exports | Export/script/provider inventories | Prompt/skill/source spelling | Docker/deploy/source snapshots |
| 2: duplication | Vault ownership/import/migration scans | CLI knowledge and contract duplicates | Meal/nutrition/skill prose catalogs | Route allowlist and package inventories |
| 3: mock coupling | Mock homepage/layout and fake transactions | Fake health routing and persistence | Prompt descriptions, export identity, mocked writer calls | Phone and personalization transport mocks |
| 4: composed outcomes | Browser metadata/images and archive navigation | Fresh-process record lifecycles and built scoped help | Live walking/guidance plus retained workout/card delivery | Executed build/assembly and bundle publication |

Surviving unique tests cover authentication, canonical writes, prompt audience
isolation, numerical nutrition safety, schema/path validation, transport fencing,
malformed replies, retries, concurrency, privacy, and recovery. Browser flows,
real PostgreSQL, built CLI subprocesses, real HTTP, and live assistant journeys
replace large clusters without changing production behavior.

Parent review checked removal clusters against surviving executable owners,
replacement failure paths, test discovery, and active references. Historical
audit documents and the first completed plan remain point-in-time evidence.

## Verification and delivery

Current-base proof uses Node 24.22.1 and the frozen lockfile.

- Web: 112 focused Vitest cases, six real Chromium journeys, native lint, and
  changed discovery configuration passed. Browser route/image and archive
  journeys run through `public-content-journeys.spec.ts`.
- Packages: prepared built runtime and CLI typecheck passed; 192 focused cases
  cover contracts, real package resolution, CLI routes, family/genetics, and
  fresh provider/food/recipe/knowledge persistence. Knowledge raw readback and
  explicit food rename follow current upstream contracts.
- Infrastructure: 221 focused Cloudflare cases, bundle publication cases,
  real subprocess build/assembly, and 14 Frog cases passed. Cloudflare
  typecheck passed after correcting one test literal's inferred type.
- Assistant: 228 deterministic cases across 12 retained suites and package
  typecheck passed. All eight current-base live guidance cases passed and were
  reviewed Ready on the current default model, including canonical no-write and
  no-automation checks. The existing five-turn routine draft/save/readback,
  missing-record, and malformed-record journey also passed with exactly one
  explicit verified save and no unintended mutation.
- Database: the full current migration chain applied to an isolated disposable
  local database. Three Web suites/five cases proved exact Starter and meal-photo
  SQL plus actual onboarding races; operational-report contracts passed three
  cases against PostgreSQL and the retained Analytics fixture.
- Scenario integrity passed for 206 scenarios, 12 sample inputs, and 29 golden
  directories. Hosted billing CI guard and docs drift passed. Active removed-file
  reference scan and authored privacy/whitespace checks passed.
- Complexity guard passed against the task merge base. The unchanged provider
  boundary inspector remains at 23; this task removes one obsolete requirement
  elsewhere in that file and does not justify restructuring its independent
  provider-safety checks.
- The shared CLI test wrapper advertises an unsupported `.each` method. The
  composed journeys use ordinary registration; the reproducible tooling issue
  is recorded in the task-owned public-safe Frog entry.

Final root `pnpm typecheck` passed across packages, apps, and repository
guards. All nine live journeys passed and were reviewed Ready; local
implementation and proof are complete. PR exact-head ReviewGPT, required CI, and merge evidence will be
recorded on the PR; this plan records the implementation and local-proof phase.
Completed: 2026-10-22
