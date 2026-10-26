# Canonical event-read import experiment

Status: candidate authored; independent parent measurement and release decision pending.

## Outcome and protected boundary

Reduce cold `meal show` import work while preserving canonical reads, all scans,
authorization/path checks, visibility, ownership, revisions, errors and output.
The only runtime caller change is the exact-event loader's public core specifier.
Core owns the existing readers; no cache, algorithm change, ledger split, new
dependency, preload, registry or additional fallback is justified.

## Plan and decisions

1. Trace the erased runtime dependency closure and production resolver. The
   ledger does not loop back to core's root. Production's variable import uses
   the installed export map; assembly already preserves exports and emitted
   entries. Root tsconfig wildcard and manifest-derived test aliases suffice;
   Web's separate map receives the explicit entry.
2. Expose `core/event-read` as the same two function objects and change only the
   two exact-event runtime specifiers. Reuse the existing owner/error/timing
   regressions and synthetic full-ledger fixture.
3. Run the actual assembled CLI regression, base/base control and alternating
   cold base/candidate pairs described in `packages/core/bench/README.md`.
   Compare complete results, input/output bytes, loaded native/chunk work,
   CPU/wall variation and canonical-input preservation.
4. Reject the runtime/export candidate if the import work remains or the
   independent measurements do not show material benefit beyond variation.
   Keep diagnostic proof only in that case. Parent owns applying, running,
   reviewing, committing and releasing; no changelog before measured benefit.

## Authorship evidence and remaining gates

The source snapshot's frozen install is blocked by omitted dependency patch
files, including the pinned Incur patch. No assembled runtime benchmark,
Vitest suite, package build or typecheck is claimed here. Dependency-free
benchmark-driver tests, syntax parsing and workspace boundary verification
are the available author checks. Parent must execute the documented native and
focused gates against independently assembled artifacts before accepting the
candidate. Production aggregate wall phases are motivation, not a CPU profile
or a forecast of the attainable speedup.

The deduplicated source-cause, cron recovery and Personal Patterns work remain
outside this patch. No failed-work recovery or post-photo-removal read is changed.
