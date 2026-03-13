# `@healthybob/inboxd`

Source-agnostic inbox ingestion for Healthy Bob.

This package keeps canonical inbox evidence in the vault and uses a local SQLite
runtime database for cursors, transient dedupe caches, capture-local search
tables, and attachment job state.

## Runtime expectations

- Run on Node.js `>=22.16.0`.
- `@healthybob/inboxd` opens its runtime database through the built-in
  `node:sqlite` module and stores machine-local state under
  `<vault>/.runtime/inboxd.sqlite`.
- Query-owned lexical search state lives separately under
  `<vault>/.runtime/search.sqlite`.
- The package writes runtime state next to the vault and expects normal local
  filesystem read/write access there.

## Core model

- every inbound source normalizes into a single `InboundCapture` envelope
- raw source evidence is persisted under `raw/inbox/<source>/...`
- append-only vault events and audits record the canonical import trail
- inbox SQLite runtime state lives under `<vault>/.runtime/inboxd.sqlite`
- any idempotent promotion from inbox captures into canonical records must be
  derivable from canonical vault evidence rather than local `.runtime` state alone

## Current scope

- connector contracts for polling and webhook sources
- iMessage-first poll connector over an injected driver boundary
- capture pipeline with raw persistence, event/audit append, dedupe, and FTS
- runtime list, show, and search helpers for future CLI/agent surfaces
- `vault-cli inbox ...` is the intended human/operator surface layered on top of this package

## iMessage adapter contract

The iMessage connector is optional and macOS-only. `@healthybob/inboxd` keeps
the adapter behind a dynamic import so non-iMessage consumers do not need the
dependency at all.

- Install `@photon-ai/imessage-kit` only in the same project/workspace that
  runs `@healthybob/inboxd` or `vault-cli`.
- The runtime imports that package only when `loadImessageKitDriver()` or an
  iMessage-backed CLI flow is exercised.
- If the package is missing or incompatible, `vault-cli inbox doctor` fails the
  `driver-import` check and reports the import error directly.
- Other inbox connectors can use this package without installing the iMessage
  adapter.

## Operator notes

- Use `vault-cli inbox doctor --source-id imessage:self` before `backfill` or
  `run` to confirm macOS access, Messages database readability, and adapter
  importability.
- A `driver-import` failure usually means `@photon-ai/imessage-kit` is not
  installed where the runtime is executing, or it does not expose the expected
  `getMessages` and `startWatching` functions.
