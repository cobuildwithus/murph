# Blood oxygen normalization diagnostics

Status: completed
Created: 2026-08-19
Updated: 2026-08-20

## Goal

- Make the next Junction complete-day normalization failure self-diagnosing in
  hosted runtime logs without recording raw health data or provider payloads.

## Success criteria

- Every importer rejection branch emits one stable, stage-qualified reason.
- Complete-day row failures include useful structural context: one-based row
  ordinal, a code-owned known provider slug, timestamp kind, and timestamp
  semantics when known.
- The device-sync failure diagnostic preserves those fields and the hosted
  runtime emits them on `device-sync.job_failed`.
- Focused importer, device-sync, hosted-runtime, and type checks pass.

## Scope

- In scope: Junction calendar/complete-day importer errors and their existing
  device-sync hosted log path.
- Out of scope: changing acceptance rules, retry behavior, provider requests,
  canonical writes, or logging raw readings/timestamps/identifiers/payloads.

## Constraints

- Technical constraints: preserve the existing error code/message and retry
  semantics; use fixed tokens and bounded structural numbers only.
- Product/process constraints: production health data stays private; the log
  must still be specific enough to identify the parser-contract mismatch from
  one failed attempt.

## Risks and mitigations

1. Risk: added metadata accidentally carries health data or identifiers.
   Mitigation: populate only fixed enums, code-owned field paths, a bounded row
   ordinal, and a slug admitted by the existing known-provider set; verify the
   emitted log exactly.
2. Risk: diagnostic plumbing changes sync behavior.
   Mitigation: leave the error code, message, retryability, persistence, and
   control flow unchanged and exercise the real importer-to-service path.

## Tasks

1. Add typed importer rejection metadata at every existing throw site.
2. Preserve the metadata in device-sync failure diagnostics.
3. Add it to the existing hosted runtime redacted log allowlist.
4. Add focused regression and privacy tests.
5. Run focused verification and the required PR review gates.

## Decisions

- Keep a single existing error code so retry/storage behavior remains stable;
  add typed diagnostic fields instead of encoding branches into error codes or
  the member-facing error message.
- Include structural shape evidence rather than raw values. This is both more
  privacy-safe and more directly actionable for a normalization contract bug.
- Admit a provider slug to diagnostics only through Junction's existing
  code-owned provider set. Unknown payload text is omitted at both the importer
  and device-sync boundaries while the other structural diagnostics remain.
- Collapse unreachable daily timestamp sub-classifications into one guarded
  fallback; the reachable temporal resolver keeps its precise timestamp
  reasons.

## Verification

- `pnpm --filter @murphai/importers typecheck` — passed.
- `pnpm --filter @murphai/device-syncd typecheck` — passed.
- `pnpm --filter @murphai/assistant-runtime typecheck` — passed.
- Full affected Vitest files — 234 importer and 137 device-sync service tests
  passed after review remediation; the unchanged hosted-runtime path previously
  passed all 85 tests.
- Focused blood-oxygen diagnostics cover eight rejection shapes plus unresolved
  source context. Sparse-row tests assert their exact diagnostic, and privacy
  tests prove unrecognized provider text is omitted while a known provider is
  preserved.
- Preliminary specialist review findings were remediated. Final ReviewGPT
  rounds 1 and 2 passed; round 2 reviewed the corrected full patch.
- Required GitHub checks passed on the corrected code head, and
  `git merge-tree --write-tree HEAD origin/main` proved a clean current-base
  merge.
- A bounded production runtime-log aggregate still showed 35 generic
  normalization failures in the preceding 24 hours, confirming that the live
  event cannot identify the failed parser branch before this change deploys.
- `git diff --check` — passed.
Completed: 2026-08-20
