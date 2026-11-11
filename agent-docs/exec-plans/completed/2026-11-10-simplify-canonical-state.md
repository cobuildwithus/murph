# Simplify canonical state and inbox ownership

Status: completed
Created: 2026-11-10
Updated: 2026-11-10

## Goal

Remove redundant runtime wiring and derived outcome authority, correct inbox rebuild counts, and retire unused inbox configuration without weakening canonical writes or supported restores.

## Success criteria

- Saved outcomes resolve from their exact immutable artifact/reference without duplicate tracking fields deciding validity.
- Current writers remain readable by the supported older outcome reader until the consumer-first rollout is proved.
- Pure forwarding exports and unused service factories are deleted; loader reductions preserve current packaging and cold-import boundaries.
- Inbox rebuild reports every rebuilt capture, including collections larger than a display page.
- Unused local connector configuration no longer controls inbox reads; transport authentication remains at its current owner.
- Focused tests, affected package typechecks and complexity review pass before the draft PR handoff.

## Scope

- Core experiment outcome reads and behavior-free public exports.
- Vault-usecase module loading and unused private service factory.
- Inbox read configuration and rebuild counting.
- No deployment, database migration, production data access, or deletion of historical vault contents.

## Constraints

Keep canonical write locking, unknown publication outcomes, immutable artifacts and old snapshot readability. The existing generic runtime-import helper is used by the runner bundler and is not presumed obsolete. Root owns final ReviewGPT, Ready and merge decisions.

## Product UX

- Effort: Patch.
- Outcome: saved experiment results remain readable when redundant tracking is absent or stale; inbox rebuild reports the complete result.
- Reaches: existing and restored vaults, repeat outcome reads, missing or mismatched artifacts, inboxes above the display cap.
- Proof: actual canonical filesystem outcome round trips and real SQLite inbox rebuild, plus existing focused suites.
- Result: Ready for the scoped candidate; final review and release remain with the completion owner.

## Tasks

1. Completed: revalidated readers, writers, consumers and compatibility requirements against base 34d9f4edc1.
2. Completed: removed duplicate outcome tracking as read authority and seven no-op public wrappers; canonical locks remain at their current owners.
3. Completed: removed redundant core and integrated loader caches, the core export-shape gate and duplicated core API inventory, and the unused private unwired factory. Public package types now compose directly with parsed blood-test and immunization inputs; existing normalization is unchanged.
4. Completed: rebuild returns the distinct capture count already computed inside the SQLite replacement transaction. Removed unsupported connector config schemas, readiness checks, source-id mapping, and creation.
5. Completed: focused tests, affected typechecks and complexity review passed; owner docs record retained boundaries and removal gates.
6. Handoff: scoped commit and draft PR only; root owns final ReviewGPT, exact-head CI, Ready, merge and release.

## Decisions and removal gates

- Outcome tracking writer/schema retirement is deferred until every supported runner reader accepts reference-only documents. Existing older readers explicitly reject absent tracking. This change prepares that consumer-first release; it does not falsely claim rollout convergence.
- Workout prose-default migration stays: dormant/restorable vaults can still contain user defaults only in memory. No inventory or supported restore-floor proof establishes safe deletion. Removing it now can erase intended workout defaults or revive an explicitly cleared value.
- Local connector config retirement leaves old files alone; deleting ignored historical data is unnecessary.
- Older inbox readers still require the config marker. New config-free vaults require this reader version as their rollback floor unless the older bundle runs inbox initialization before reading. The private packages ship together. No production rollout or rollback was performed here.
- The generic by-name import helper remains a runner-bundler seam. The query promise preserves the established cold-import timing boundary; service-instance caching retains dependency-specific construction. The public unwired factory still has callers. These are current requirements, unlike the deleted duplicate private factory and core module cache.
- No new services, dependencies or durable state.

## Verification

- Core: outcome closeout, preferences, assessment writes and canonical lock suites passed (47 tests); health-history family passed after the schema-composition regression was added (42 tests); clinical assertions passed (2 tests). The outcome proof covers absent/stale tracking, missing artifacts, lineage mismatch, retry identity and unchanged artifact/frontmatter bytes.
- Vault-usecases: 10 focused runtime, public loader, entrypoint, helper and clinical suites passed (61 tests). Native module reuse and existing unavailable-runtime errors are preserved.
- Inbox-services: full package suite passed (27 tests). The real SQLite regression rebuilds 201 canonical captures while the display API still caps results at 200; restoring the old recount loop made this test fail with 200 versus 201. The same test covers absent/malformed retired config and unchanged historical config bytes.
- Inboxd: idempotency/rebuild suite passed (16 tests); runtime-state path/versioned-state coverage passed (12 tests).
- Cloudflare: runner CLI bundle suite passed (20 tests), after the normal scoped runtime-state build required by its package-entrypoint fixture.
- Typechecks passed for core, vault-usecases, inbox-services, inboxd, operator-config and runtime-state.
- `pnpm complexity:diff --base 34d9f4edc1` passed: no increased debt; the affected experiment reader's debt fell from 16 to 12 and inbox read/config branches decreased.
- `pnpm docs:drift` and `git diff --check` passed. No broad suite, live provider journey or production data access was needed for these internal ownership changes.

## Remaining removal work

The outcome finding is intentionally consumer-first: stop emitting and remove the duplicate tracking schema only after all supported current and rollback readers accept reference-only outcomes. Workout prose migration remains blocked on evidence that no supported active, dormant or restored vault relies on those defaults, including explicit-clear precedence. Neither prerequisite is proved by repository tests alone; no speculative migration or fallback was added to pretend otherwise.
Completed: 2026-11-10
