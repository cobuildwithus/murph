# Remove Dead Compatibility Surfaces

Status: completed
Updated: 2026-07-10

## Goal

Delete private compatibility wrappers, aliases, and ignored options that have no
production caller or persisted-state obligation. Success is a smaller canonical
surface with focused imports/commands and no replacement abstraction.

## Scope

- Remove hosted-local compatibility entrypoints and obsolete local command aliases.
- Remove no-op review-helper and assistant-index options.
- Remove private web function/barrel/re-export aliases with no production caller.
- Remove corresponding tests and update current documentation to canonical names.

## Constraints

- Preserve public CLI compatibility and all persisted-state readers.
- Avoid files owned by active coordination-ledger rows, including hosted mailbox,
  hosted webhook transport, runner-container lifecycle, and hosted-local stack work.
- Do not add deprecation machinery or replacement wrappers.
- Keep historical completed plans and migrations unchanged.

## Verification

- Caller and stale-string searches for every removed symbol/command.
- `pnpm test:diff` over the touched files.
- Required coverage-write audit and parent final review.
- PR ReviewGPT loop and CI on the pushed head.

## State

- Done: removed the private wrappers, aliases, ignored options, obsolete command
  names, and their compatibility-only tests/docs; repository-wide caller searches
  found no live consumers.
- Done: the routed diff suite passed on the implemented deletion set. The
  coverage-write audit moved failure cleanup and SIGINT proof from a deleted
  wrapper test into the canonical hosted-local E2E owner test, whose focused
  coverage suite passed.
- Done: security/privacy review found no auth, billing, data-access, or identifier
  regression; the Privy route now imports the same implementation directly.
- Next: archive and commit, rebase onto current main, rerun the routed verification
  on the final head, then push and complete ReviewGPT/CI.
Completed: 2026-07-10
