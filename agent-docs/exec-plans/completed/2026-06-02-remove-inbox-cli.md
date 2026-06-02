# Remove inbox CLI command family

## Goal

Remove the `vault-cli inbox ...` command family entirely while keeping the
underlying inbox ingestion, raw attachment persistence, and audio/video parser
runtime available to assistant/local/hosted code paths.

## Success Criteria

- `vault-cli --help`, generated incur metadata, config schema, smoke manifests,
  and command-surface docs no longer advertise an `inbox` command group.
- CLI tests prove `inbox` is absent instead of preserving subcommand behavior.
- No removal of `packages/inboxd`, `packages/inbox-services`, parser workers, or
  assistant attachment evidence handling unless a reference is solely CLI glue.
- Parser/audio-video setup remains reachable through non-inbox setup/runtime
  paths that already own assistant/hosted ingestion.

## Scope

- In scope: `packages/cli` command registration and generated metadata,
  directly coupled CLI tests, command-surface docs, smoke manifests, and root
  docs/scripts that point users at `vault-cli inbox`.
- Out of scope: hosted mailbox ingestion, local assistant automation,
  `packages/inboxd`, `packages/inbox-services`, parser package internals, and
  unrelated hosted-local dirty work.

## Risks

- Orphaned generated metadata or smoke scenarios can keep advertising removed
  commands.
- Setup/onboarding may still depend on inbox bootstrap contracts for AgentMail
  or parser toolchain setup.
- Assistant/runtime command descriptors may still expect direct inbox service
  bindings even after the root CLI command is gone.

## Plan

1. [x] Map every live `vault-cli inbox` registration, schema, scenario, and
   doc reference.
2. [x] Delete the command registration and direct descriptor binding.
3. [x] Update generated config/schema metadata and command-surface docs.
4. [x] Remove or rewrite tests/scenarios that assume `inbox` exists.
5. [x] Run focused CLI and scenario verification, then completion audits.

## State

Implementation, focused verification, and required completion audits are
complete. Remaining work is the scoped finish-task commit if unrelated dirty work
does not block it.
Status: completed
Updated: 2026-06-02
Completed: 2026-06-02
