# Bound event and manifest recovery metadata

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Keep event and stored-manifest recovery useful while ensuring only finite,
  schema-owned paths and generic stages can reach the model-facing CLI
  envelope.

## Success criteria

- Stored export and assessment manifests expose only a known top-level manifest
  field or the root path; identifier-shaped stored keys never become recovery
  paths.
- Event contract errors expose only finite public event fields or the root path;
  identifier-shaped submitted keys never become recovery paths.
- Submitted validation, filesystem work, stored reads, conflicts, and writes
  carry the smallest applicable generic stage at the producing owner.
- Built CLI tests prove private top-level and nested keys and values are absent,
  and rejected event input leaves canonical files unchanged.
- Focused tests, affected package typechecks, package shape, bundle, and privacy
  checks pass; the draft PR is updated without starting ReviewGPT.

## Scope

- In scope: event error mapping and filesystem helper logic in Vault Usecases;
  stored export/intake manifest reads in the CLI; focused owner and built-CLI
  tests; existing runner bundle budget if generated size changes.
- Out of scope: the shared error projector, a new recovery-property protocol,
  public-path migration, state, logging, command topology, and unrelated Vault
  CLI families.

## Product UX

- Effort: Patch.
- Outcome: the model receives truthful, privacy-safe recovery location and
  phase without losing the existing command outcome.
- Reaches: existing event imports and stored export/intake reads that fail.
- Proof: built envelopes for submitted and stored identifier-shaped keys, plus
  canonical no-write comparison for rejected event input.

## Design

- Keep two local finite field sets beside the schemas that own stored manifest
  parsing, and one finite public-event field set beside the event error mapper.
- Collapse nested failures to their safe static parent and unknown top-level
  failures to root.
- Restrict filesystem `fieldPath` to the two existing call-site literals.
- Add plain stage strings to existing `VaultCliError.context`; add no registry,
  transport, or compatibility layer.

## Tasks

1. [x] Add failing owner and built-envelope privacy/no-write regressions.
2. [x] Replace regex admission with finite owner mappings and add generic stages.
3. [x] Run focused source and built CLI tests, typechecks, package/bundle checks,
   privacy checks, and final diff inspection.
4. [ ] Archive this plan with the scoped commit, push the draft PR head, and
   refresh its evidence and change-shape sections.

## Decisions

- Keep stored manifest field ownership beside each concrete recovery contract;
  nested issues collapse to that static parent and unknown top-level issues to
  root.
- Keep event path admission as a finite union of the public event import schema
  fields; arbitrary submitted identifiers collapse to root.
- Attach stages in the existing owner context and leave shared projection and
  its eventual recovery-property migration to the foundation PR.

## Verification

- Passed the Vault Usecases helper suite (6 tests), export helper suite (6),
  built events/documents recovery suite (10), affected CLI and Vault Usecases
  typechecks, prepared runtime build, and CLI package-shape check.
- Passed `pnpm test:diff`, including privacy/architecture guards, all affected
  package suites and typechecks, hosted web verification/build, and Cloudflare
  node/workers verification.
- Assembled the production Cloudflare runner bundle successfully; the Vault CLI
  bundle remained within its total, entry, and static-startup budgets and all
  parity probes passed.
- Final diff check and identifier/credential privacy scan passed. A direct
  Prettier check was unavailable because this workspace does not install that
  executable; repository-owned verification and package compilers remained
  green.
Completed: 2026-08-24
