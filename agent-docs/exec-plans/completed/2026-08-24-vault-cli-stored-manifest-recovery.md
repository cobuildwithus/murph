# Make stored-manifest recovery owner-specific and value-free

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Ensure model callers receive owner-specific, terminal, value-free recovery
  envelopes when stored intake or export manifests are missing or corrupt.

## Success criteria

- Missing assessment lookups identify the `id` field and direct the caller to
  `intake list` without echoing the submitted identifier.
- Missing, unreadable, invalid-JSON, and invalid-shape assessment manifests
  truthfully state that the CLI cannot reconstruct or repair stored state.
- Export manifest failures use export-specific terminal guidance and mention
  only the real `export pack create` alternative.
- Built-CLI tests prove codes, stages, retryability, repair fields, and absence
  of identifiers, paths, contents, and filesystem causes.
- Focused adjacent tests, CLI typecheck, final diff/privacy review, and scoped
  commit succeed.

## Scope

- In scope: intake manifest lookup/discovery/read/parse/validation envelopes;
  export manifest read/parse/validation/mismatch envelopes; focused tests.
- Out of scope: shared transport, arbitrary context projection, automatic
  stored-state repair, file editing commands, export topology, and PR metadata.

## Constraints

- Technical constraints: keep errors owner-local and value-free; reuse the
  foundation repair contract; preserve unknown-error sanitization; do not turn
  stored-state corruption into a retryable input failure.
- Product/process constraints: Product UX Patch. Outcome: a model learns that
  the selected stored artifact is terminally unavailable and chooses a real
  alternative instead of retrying or inventing a repair command. Affected
  person: model callers inspecting imported assessments or export packs.

## Risks and mitigations

1. Risk: caller-specific wording drifts across parse and schema failures.
   Mitigation: pass one small owner recovery contract into the shared reader.
2. Risk: a raw filesystem/path cause re-enters the final envelope.
   Mitigation: replace known stored-manifest failures with authored messages
   and assert private identifiers, paths, contents, and causes are absent.
3. Risk: terminal guidance claims an unsupported repair.
   Mitigation: say the CLI cannot repair stored manifests; name only existing
   list/import/create alternatives and do not promise mutation of old state.

## Tasks

1. Trace every assessment/export call into the shared manifest reader.
2. Add the smallest owner-specific recovery contract and safe assessment
   lookup/discovery classification.
3. Add built final-envelope tests and update adjacent helper expectations.
4. Run focused tests, CLI typecheck, Product UX walkthrough, and privacy review.
5. Archive the plan and commit locally without pushing or mutating the PR.

## Decisions

- Keep stage names aligned with failure ownership: `lookup`,
  `manifest_lookup`, `manifest_read`, `manifest_parse`, and
  `manifest_validation`.
- Terminal stored-state errors remain `retryable: false`; malformed JSON and
  schema errors retain bounded value-free diagnostic paths without claiming
  the CLI can edit stored files. Only the caller-correctable missing assessment
  ID identifies an input field.

## Verification

- Passed `pnpm --dir packages/cli build`, the built recovery suite (6 tests),
  export helper coverage (6), adjacent export/intake expansion coverage (7),
  and CLI package typecheck.
- Final envelopes cover missing assessment lookup, missing raw directory and
  manifest, malformed assessment JSON/schema, malformed export JSON/schema,
  export manifest ID mismatch, and export output failure. Private sentinels
  prove submitted IDs, entity IDs, raw directories, relative/absolute paths,
  contents, and causes are absent.
- Product UX walkthrough: a missing caller-selected ID identifies `id` and
  points to `intake list`; broken stored assessment state says it cannot be
  repaired and names only `intake list`/`intake import`; broken export state
  names only the real `export pack create` alternative; valid intake/export
  and symlink-safe path handling remain green.
- Final checks: `git diff --check`, diff privacy scan, scoped status review, and
  archived-plan commit.
Completed: 2026-08-24
