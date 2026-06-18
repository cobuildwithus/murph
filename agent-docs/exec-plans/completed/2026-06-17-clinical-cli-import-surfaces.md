Goal (incl. success criteria):
- Land Murph-owned CLI surfaces that let an agent with full PDF text save the high-value clinical data currently awkward to preserve: social history, structured clinical notes, richer family-history facts, explicit negative/normal clinical assertions, vitals, and generic diagnostic tests.
- Keep the command model aligned with `docs/incur-payload-schema-migration-guide.md`: `scaffold` is an example, while file-backed imports expose exact Murph payload contracts through `payload-schema` commands.
- Success means the new command families can scaffold, import JSON, expose payload schemas, write through canonical core/vault-usecase paths, and have focused tests/docs proving the contracts.

Constraints/Assumptions:
- Work happens on branch `codex/clinical-cli-surfaces` in worktree `murph-clinical-cli-surfaces`.
- The PDF parser is not in scope; assume Murph already has extracted PDF text in context and needs durable CLI families to save structured facts.
- Do not store raw clinical document text in command docs, examples, tests, logs, or prompts.
- Canonical writes must go through `packages/core`; the CLI must not write vault files directly.
- Keep medication work out of scope because `regimen import-json`, `regimen save --kind medication`, and `medication history add` already cover the current need.
- Preserve unrelated active ledger rows and unrelated worktree edits.

Key decisions:
- Add purpose-built nouns rather than a generic catch-all import: `social-history`, `clinical-note`, `assertion`, `vitals`, and `diagnostic-test`.
- Expand family-history import around structured relationship-condition facts instead of string-only condition arrays.
- Bound `clinical_assertion` to explicit absence, denial, and normality statements; positive facts continue to use their canonical noun.
- Add shared provenance/evidence refs to the new import payloads so PDF page/chunk/span/source-document evidence is machine-readable, not buried in notes.
- Treat payload-schema work as part of this feature, not as a later cleanup, for every new file-backed import added here.

Parallel landing plan:
- Batch 0, read-only scouts:
  - Domain/schema scout maps the smallest contract/core shapes for the new facts and identifies existing owners to reuse.
  - CLI/payload-schema scout maps the current command factory and Incur discovery gaps against the migration guide.
  - Tests/docs scout maps focused test files, command docs, and required generated artifacts.
- Batch 1, implementation lanes after scouts:
  - Core/contracts lane owns Zod schemas, event/family data model additions, and canonical mutation helpers.
  - CLI/usecase lane owns command registration, scaffolds, imports, payload-schema commands, and service wiring.
  - Tests/docs lane owns focused tests, command docs, migration-guide references, and generated metadata after the parent reconciles code paths.
- Parent agent owns merge/reconciliation of overlapping registries, generated files, final verification, audits, and the scoped commit.

State:
- Implementation complete; final scoped commit pending.

Done:
- Confirmed current main has medication-history facade and encounter scaffold/import-json.
- Confirmed payload-schema migration guide is the controlling design for file-backed import contracts.
- Created isolated branch/worktree for the implementation.
- Added bounded clinical assertion fields, structural evidence refs, clinical note sections, and family condition-history payload support across contracts/core/query.
- Added clinical import usecases and CLI command families for `assertion`, `vitals`, `diagnostic-test`, `clinical-note`, and `social-history`.
- Added shared `payload-schema` command plumbing and wired it into new clinical imports, encounter, and generic health import descriptors.
- Made `social-history import-json` validate and write its canonical assertion/exposure/note fan-out through one event-batch mutation.
- Regenerated contract schemas and CLI generated artifacts.
- Added focused contract/core/usecase/CLI tests, including real initialized-vault roundtrip coverage for clinical imports.
- Updated command-surface docs and the Incur payload-schema migration guide.
- Verification passed: `pnpm build:workspace:incremental`, `pnpm typecheck`, `pnpm test:diff`, `git diff --check`, and identifier-leak diff grep.

Now:
- Close the active plan through `scripts/finish-task` and create the scoped commit.

Next:
- Handoff the commit hash and verification summary.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- docs/incur-payload-schema-migration-guide.md
- docs/contracts/02-record-schemas.md
- docs/contracts/03-command-surface.md
- packages/contracts/src/**
- packages/core/src/history/**
- packages/core/src/domains/events/**
- packages/vault-usecases/src/**
- packages/cli/src/commands/**
- packages/cli/src/vault-cli-command-manifest.ts
- packages/cli/src/incur.generated.ts
- packages/cli/config.schema.json
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
