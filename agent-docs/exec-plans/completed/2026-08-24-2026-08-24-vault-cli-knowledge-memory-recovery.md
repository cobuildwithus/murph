# Vault CLI knowledge memory recovery

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Restore the existing Vault CLI recovery promise for malformed canonical
  memory: the model receives one fixed field location it can act on, while
  canonical content and machine-local paths remain private and the failed read
  performs no write.

## Success criteria

- `MemoryDocumentParseError` field guidance uses a projector-supported generic
  issue code while retaining the existing fixed owner-selected field path.
- A built `vault-cli` full-output journey proves the fixed field error, safe
  envelope, private sentinel non-echo, and byte-for-byte no-write behavior.
- Focused tests, CLI typecheck, package-shape, production runner bundle budget,
  privacy guards, and final diff inspection pass.
- The scoped commit is pushed to PR #2208, its body is current, and the PR is
  left Draft for parent-owned review.

## Scope

- In scope:
  - `packages/cli/src/commands/memory.ts`
  - built/full-envelope recovery proof in `packages/cli/test/memory.test.ts`
  - this execution plan and PR metadata
- Out of scope:
  - shared Vault CLI projection changes
  - the later owner-authored public-path migration
  - new logging, retry, repair, or persistence owners
  - ReviewGPT execution, which remains parent-owned

## Constraints

- Technical constraints: use the existing `VaultCliError.context.issues` seam;
  do not add an abstraction or widen arbitrary error context; prove the
  published built entrypoint rather than only the in-process command module.
- Product/process constraints: Product UX Patch. Outcome: a malformed memory
  document gives the assistant a fixed recovery field. Reaches: the existing
  `memory show` failure journey. Proof: built full-output no-echo/no-write
  regression. Preserve unrelated branch work and stop if a new substantive
  review result arrives.

## Risks and mitigations

1. Risk: the field path or canonical content leaks through generic projection.
   Mitigation: keep the path owner-selected and fixed; assert the complete
   serialized envelope omits content and local path sentinels.
2. Risk: a malformed read mutates or normalizes the canonical file.
   Mitigation: compare exact bytes before and after the built command.
3. Risk: source-only proof passes against stale built output.
   Mitigation: execute the packaged `dist/bin.js` test helper and run package
   shape plus bundle proof after building.

## Tasks

1. [x] Confirm exact PR/worktree ownership and inspect the current mapper and
   projector contract.
2. [x] Change only the memory owner issue code and add built full-envelope proof.
3. [x] Run focused tests, typecheck, package shape, bundle, privacy, and diff checks.
4. [x] Complete the Product UX walkthrough and parent candidate review, archive
   this plan, commit, push, refresh the PR body, and leave the PR Draft.

## Decisions

- Reuse generic issue code `custom`; the fixed field path already carries the
  actionable location and the generic code is accepted by the shared
  projector.
- Keep malformed canonical memory terminal and inspect-first; this patch does
  not change retryability or add automatic repair.
- Changelog remains not applicable because this is internal model-facing CLI
  recovery with no member-visible UI or product promise change.

## Verification

- Commands to run:
  - focused `memory.test.ts` source and built-runtime test
  - `pnpm --dir packages/cli typecheck`
  - `pnpm --dir packages/cli verify:package-shape`
  - production runner bundle boundary test/build command selected by the
    existing PR contract
  - repository privacy, unsafe-cast, and diff checks
- Expected outcomes: all pass; the malformed-memory envelope contains the
  fixed `metadata` field with code `custom`, no private sentinels, and the
  canonical bytes are unchanged.

### Results

- Focused built/full-output memory suite: 11/11 passed. The malformed-memory
  journey returned `memory_document_invalid`, `stage: validation`, and exactly
  one `metadata` field error with code `custom`; the full envelope omitted both
  sentinels and the source file remained byte-for-byte unchanged.
- CLI package typecheck passed.
- CLI package build and package-shape verification passed.
- Cloudflare runner CLI-bundle boundary suite: 14/14 passed.
- Production runner assembly passed: Vault CLI total 9,481,803 B of 9,482,492
  B, entry 805 B of 20,000 B, static startup 25,155 B of 33,200 B, and runner
  total 11,285,186 B of 11,393,617 B.
- Agent-doc drift, whitespace, prohibited-cast, and direct-identifier/credential
  scans passed.

## Product UX walkthrough

- Person/path: an assistant reading malformed canonical memory through the
  ordinary built `memory show` command.
- Result: the assistant receives the existing terminal error plus the fixed
  `metadata` recovery location, without canonical content or a machine-local
  path.
- Recovery: no automatic retry or repair occurs, and the malformed source is
  unchanged for explicit owner inspection.
- Difference from plan: none.
- Status: Ready.
Completed: 2026-08-24
