# Reject duplicate canonical memory IDs before destructive mutations

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Fail canonical memory reads and mutations before any write when
  `bank/memory.md` contains a second record with an already-used canonical
  memory ID. Return one safe, line-specific `memory_document_invalid` envelope
  so an assistant or operator knows the document needs repair instead of
  treating an ambiguous record as one target.

## Product UX

- Outcome: an assistant or operator receives one terminal, line-specific error
  before a duplicate ID can make an exact read ambiguous or make one mutation
  affect multiple private facts.
- Reaches:
  - An assistant using `memory show` sees the existing structured
    `memory_document_invalid` envelope with safe field `id`.
  - An assistant using `memory update` or `memory forget` gets the same
    inspect-first result and cannot mutate the ambiguous document.
  - An operator repairing the canonical file gets the second record's
    vault-relative line without record IDs, text, or an absolute path.
- Proof: a contracts regression asserts the parser-owned error and second line;
  a built CLI regression exercises `show`, `update`, and `forget`, checks the
  exact machine envelope, and compares the file bytes after every command.

## Success criteria

- The canonical memory parser rejects the second duplicate ID at its source
  line with `MemoryDocumentParseError`, issue `record_invalid`, and field `id`.
- Valid canonical memory documents parse exactly as before.
- `memory show`, `memory update`, and `memory forget` refuse the corrupt
  document before a write, return the existing safe CLI error projection, and
  do not echo record text, IDs, or an absolute vault path.
- Focused contract and built-CLI regressions pass, along with typechecks for
  every touched package owner.

## Scope

- In scope:
  - Duplicate canonical memory ID detection in the contracts-owned parser.
  - Focused contracts and CLI proof for read and mutation behavior.
  - Existing CLI error-envelope reuse; no new error transport.
- Out of scope:
  - Changing healthy memory output shapes or command names.
  - Automatically repairing or selecting between duplicate private records.
  - Generic `show`/`list` behavior or other CLI families.

## Constraints

- Technical constraints:
  - Reject the second duplicate during the existing single parse pass; do not
    add a second parser, state owner, or filesystem scan.
  - Keep failure before all mutation planning and persistence.
- Product/process constraints:
  - Use only private-free synthetic fixtures.
  - Preserve the current bounded `memory_document_invalid` projection and
    vault-relative line evidence.
  - Do not include local account or home-directory identifiers in tracked
    output.

## Risks and mitigations

1. Risk: A duplicate is detected only after an earlier record has been
   accumulated in memory.
   Mitigation: Parsing is side-effect free; throw on the second ID before the
   parsed document can reach any read or mutation caller.
2. Risk: The error could leak the duplicate ID or record text.
   Mitigation: Reuse the existing fixed field/line projection and add explicit
   non-echo assertions at the built CLI boundary.

## Tasks

1. [x] Add duplicate-ID detection to the canonical memory body parse pass.
2. [x] Add focused contract proof for the second-record line and safe field.
3. [x] Add built CLI proof that read and mutation commands fail without writing
   or echoing private fixture values.
4. [x] Run focused tests and touched-owner typechecks; inspect the final diff
   for scope and privacy.

## Progress

- Implementation and focused deterministic proof are complete in the isolated
  task worktree.
- Parent diff review, commit, push, and PR gates remain pending and are owned by
  the parent lane.

## Decisions

- Reuse `MemoryDocumentParseError` with `record_invalid` and field `id` rather
  than add a duplicate-specific error hierarchy. The CLI already projects that
  owner error into the exact safe recovery envelope needed here.
- Detect duplicates inside `parseMemoryDocumentBody` so the second record's
  absolute document line is already available and no later scan is required.

## Verification

- Commands to run:
  - Focused contracts memory tests.
  - Focused CLI memory tests against the built runtime.
  - Typechecks for `packages/contracts` and `packages/cli`.
- Expected outcomes:
  - Duplicate-ID reads and mutations fail before any persisted byte changes.
  - The envelope contains only the stable code, safe `id` field, and canonical
    vault-relative source line; private fixture values and absolute paths stay
    absent.
- Results:
  - Contracts Vitest suite: 42 files passed, 348 tests passed.
  - Prepared built-CLI memory test: 1 file passed, 15 tests passed, including
    the duplicate-ID `show`/`update`/`forget` regression.
  - Contracts package typecheck: passed.
  - CLI package typecheck: passed.
  - The first focused built-CLI attempt reached its 120-second test timeout
    while the fresh worktree prepared runtime artifacts; after preparation
    completed, the exact focused test passed in 17 seconds and the full memory
    test file passed in 61 seconds.
Completed: 2026-08-30
