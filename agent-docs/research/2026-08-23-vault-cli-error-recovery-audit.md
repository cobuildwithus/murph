# Vault CLI model-recovery error audit

Date audited: 2026-08-23

Status: complete static audit with focused synthetic and test proof

## Executive summary

The audit reviewed every one of the 340 registered Vault CLI leaf commands across
61 root families. The dominant defect is systemic: command and use-case code
often computes the exact validation issues, but `incurErrorBridge` discards them
and returns only `code`, `message`, `retryable`, and `exitCode`. The model then
sees messages such as `Food payload is invalid.` or `Invalid workout session
fields.` even though the failing paths already exist in memory.

This is primarily a **model-facing error-envelope problem**, not a request to log
more private data. The first implementation should establish one bounded,
value-free repair-detail contract and carry it through the final machine JSON.
Durable logs should remain much smaller and contain only safe categories.

Two other cross-cutting problems deserve immediate attention:

1. Plain exceptions become `UNKNOWN` and can expose absolute local paths.
2. Failures before `cli.serve()` ignore `--full-output --format json` and print a
   plain stderr line, so machine callers lose the code and envelope entirely.

The reviewers also found several silent-success paths where invalid input is
dropped or interpreted as no data. Those are validation/correctness defects, not
logging defects, and are listed separately because they leave the model with no
error from which to recover.

## Disposition of the reported weekly automation failure

The current automation contract accepts a five-field cron schedule with an
explicit valid IANA time zone. Current tests cover recurring cron schedules with
time zones, and [PR 1546](https://github.com/cobuildwithus/murph/pull/1546),
merged on 2026-08-10, fixed preservation of explicit recurring time zones. The
reported schedule shape—weekly cron plus `America/New_York`—is therefore valid
on the audited head.

That does not close the error-quality bug. Internal automation schedule, route,
override, save, and import parsers still run after Incur's argument parser; a
failure there can become `UNKNOWN` with raw Zod text instead of a field-specific
error. No open PR was identified as a broad Vault CLI model-recovery fix during
this audit. The original hosted-group production call was not replayed, so this
document does not claim that exact historical route is operationally closed.

## Scope and confidence

Eleven independent reviewers covered nine non-overlapping command slices plus
the shared error pipeline and manifest reconciliation.

| Slice | Root families | Registered leaves | Result |
| --- | --- | ---: | --- |
| Core and assistant runtime | `init`, `validate`, `vault`, `assistant`, `chat`, `run`, `status`, `doctor`, `stop`, `automation`, `batch`, `audit`, `capture` | 52 | Reviewed |
| Clinical and health | `goal`, `condition`, `allergy`, `blood-test`, `immunization`, `family`, `genetics`, `assertion`, `vitals`, `diagnostic-test`, `clinical-note`, `social-history`, `encounter` | 58 | Reviewed |
| Events and documents | `event`, `journal`, `intervention`, `intake`, `document`, `export` | 44 | Reviewed |
| Nutrition and regimens | `meal`, `food`, `recipe`, `supplement`, `medication`, `regimen`, `protocol` | 48 | Reviewed |
| Activity and measurement | `workout`, `exercise`, `measurement`, `scheduled-log` | 40 | Reviewed |
| Experiments and Murph Age | `experiment`, `habitat`, `age` | 29 | Reviewed |
| Knowledge and reads | `memory`, `knowledge`, `search`, `query`, `timeline`, `show`, `list`, `commons`, `research`, `model` | 29 | Reviewed |
| Devices and routing | `device`, `wearables`, `provider`, `route` | 30 | Reviewed |
| Samples | `samples` | 10 | Reviewed |
| **Total** | **61 roots** | **340** | **Complete registration coverage** |

The generated Incur command map and generated config schema contain the same 340
leaves. The hand-authored command descriptor manifest describes only 236 leaves,
so it must not be used as the audit denominator. This omission does not hide the
commands from the model today; it can hide them from future descriptor-based
audits and can omit optional recovery hints.

This is exhaustive registration coverage, not a claim that every possible
filesystem, provider, corrupt-state, or concurrency outcome was dynamically
forced. A finding was included only when proven through the complete throw-to-
renderer path, an existing test, or a focused synthetic reproduction.

## What a recoverable error must contain

For a machine caller, an error is recoverable when it answers four questions
without disclosing private input:

1. **What failed?** A stable code and operation stage.
2. **Can the current model repair it?** Field paths and expected form, or a
   precise next command.
3. **Should it retry unchanged?** An evidence-based `retryable` value.
4. **What must remain private?** No submitted values, health content, provider
   response bodies, absolute paths, tokens, or arbitrary nested context.

Native Incur argument validation already demonstrates the desired shape with
`VALIDATION_ERROR` and structured `fieldErrors`. The gaps are concentrated in
validation and failures that occur after argument parsing.

## Priority 0: shared corrections

### VCE-001 — Preserve bounded field repair details

**Evidence.** `packages/cli/src/incur-error-bridge.ts:4-27` converts a
`VaultCliError` to `IncurError` with only four fields. Useful data under
`context.issues`, `context.errors`, flattened Zod errors, causes, and hints is
dropped. `packages/operator-config/src/text/shared.ts:20-68` is not a fallback:
it recognizes only string arrays under `errors`, while most producers use
`issues`, Zod issue objects, or flatten objects.

A synthetic field failure rendered as:

```json
{
  "code": "invalid_payload",
  "message": "payload failed validation.",
  "retryable": false
}
```

The original issue path did not survive.

**Confirmed command impact.** At minimum:

- Clinical imports: `goal`, `condition`, `allergy`, `family`, `genetics`,
  `blood-test`, `assertion`, `vitals`, `diagnostic-test`, `clinical-note`,
  `social-history`, and `encounter` `import-json`.
- Typed saves/edits: `blood-test save --result/--link`, `food save/edit`,
  `recipe edit`, `workout add/edit`, `scheduled-log save`, `meal edit`.
- Other imports/mutations: `food import-json`, `recipe import-json`, `provider
  import-json`, `event import-json`, invalid event/document/intervention edits,
  malformed export manifests, and experiment plan frontmatter generation.

**Smallest safe change.** Add one explicit, allowlisted repair-detail type to
`VaultCliError`, for example bounded entries containing only `path`, issue
`code`, and safe `message`. Do not infer safety by serializing arbitrary
`context`. Carry those entries to the final machine envelope while preserving
the domain error code. If the current Incur version cannot serialize field
errors on a domain-coded error, patch that narrow transport surface or append a
deterministically bounded value-free summary to the message as an interim step.

Support a fixed maximum issue count and message length, report the omitted
count, and add non-echo tests for submitted values, content, paths, causes, and
provider bodies.

### VCE-002 — Redact and classify unknown exceptions at the root boundary

**Evidence.** Non-`VaultCliError` exceptions are rethrown by the bridge and
become `UNKNOWN`. A synthetic permission failure preserved the operating-system
message and absolute local path. Raw filesystem errors can escape from sample,
query, export, operator-config, exercise-catalog, Commons-catalog, progress-card,
and other file boundaries.

**Smallest safe change.** Map expected errors nearest their domain owner, then
apply a final root redactor for all remaining unknown exceptions. Safely bucket
known Node codes such as `ENOENT`, `EACCES`, `EISDIR`, and storage exhaustion.
Return a stable category and action without the raw path. Keep unexpected
details only in private, value-free diagnostics.

This is both a recovery defect and a privacy boundary; it should ship with
VCE-001 or immediately after it.

## Priority 1: transport and command work packages

The table groups overlapping leaf findings into implementable work packages.
Commands can appear in more than one row because validation, transport, and
corrupt-state failures are different paths.

| ID | Affected commands | Proven model-facing problem | Recommended repair surface |
| --- | --- | --- | --- |
| VCE-003 | All commands failing during invocation planning, vault override, config, environment, or default-vault resolution | `--full-output --format json` is ignored before `cli.serve()`; only a plain stderr line is printed. | One transport-aware outer error renderer with code, retryability, exit code, requested format, and root redaction. |
| VCE-004 | `automation save/import-json` and route/schedule/override parsing; `scheduled-log save/import-json`; `assertion save`; `diagnostic-test save`; Murph Age preview/calculate leaves; `experiment start` | Command-internal `.parse()` failures become `UNKNOWN` with raw Zod arrays or internal field names. | Reuse a local `safeParse` adapter or move the exact schema to Incur options so final output has stable code and field paths. |
| VCE-005 | `batch` | Each failed child exposes only `Command exited with status N` in the documented error object; the real child envelope is buried as encoded stdout. | Parse full child JSON and lift `code`, `message`, `retryable`, and `fieldErrors`; use status only as fallback. |
| VCE-006 | `assistant ask/status/session show/deliver/chat`; root aliases; hosted daemon calls | Daemon-down, auth, 5xx, invalid JSON, and version-skew payloads become indistinguishable `UNKNOWN` failures. | Map daemon transport, auth, status buckets, and response-contract failures to safe typed errors with correct retryability. |
| VCE-007 | `assistant onboarding resume-context` | Individual read failures remain inside outer success as only `Read failed.`; absent device services are mislabeled as reads. | Return bounded per-surface `{status, code, retryable, message, nextStep}` and distinguish unavailable services from corrupt/I/O reads. |
| VCE-008 | `assistant run --once`, root `run --once` | Partial reply failures are represented only by counters while the safe provider failure exists only in stderr events. | Preserve partial-success semantics but add a capped structured `lastFailure` or `failures` list with phase, code, retryability, and safe message. |
| VCE-009 | `init`; `vault repair*`; `habitat save/show/list/coverage`; `intake project`; experiment start conflict | Known core domain errors bypass existing mappers and become `UNKNOWN`, sometimes with a readable message but no stable action class. | Map at the use-case/CLI boundary to `already_exists`, `conflict`, `not_found`, `invalid_payload`, or `contract_invalid`, with the relevant inspect/edit/validate command. |
| VCE-010 | Root `show/list`; family shows/lists; `search query`; `timeline`; `query projection rebuild`; all `memory` leaves | Malformed metadata, Markdown, JSONL, or the canonical memory document becomes `UNKNOWN`, often without a vault-relative source and line; a broad read can be blocked by one record. | Query-owned parse errors with a safe vault-relative path and line, then typed CLI mapping and a truthful validate/repair action. |
| VCE-011 | `document import`; `intake import`; all JSON-file imports including samples and nutrition/regimen families | Missing file, directory, permission denial, parse failure, and empty stdin collapse to generic read/JSON messages because safe cause/hint context is dropped. | Classify safe filesystem and JSON-location facts, name the input option, and expose the existing stdin repair hint; never return an absolute path or payload. |
| VCE-012 | `samples import-json`; `samples import-csv`; `samples csv import/profile` | Array indices disappear; all-invalid CSVs discard computed skip reasons; inference failures hide the headers and override flags. | Preserve bounded `samples[N].field` paths, skip-reason counts, available header names, and exact `--ts-column`/`--value-column`/`--stream` repair flags without raw cells. |
| VCE-013 | `route resolve-address`; `route estimate` | Mapbox transport/auth/rate/no-route/invalid-response failures are plain `UNKNOWN`; optional elevation failure discards an otherwise valid route. | Typed phase/status buckets with correct retryability; degrade optional elevation to `null` plus a warning or say to retry without `--elevation`. |
| VCE-014 | `research scout/scout-batch`; food and supplement label searches | Exa and label-provider auth, 429, 5xx, timeout, malformed 2xx, and other failures are generic or incorrectly non-retryable despite safe status/stage already being known. | Status-bucketed codes, bounded safe messages, correct retryability, and no provider response body. |
| VCE-015 | Hosted device actions for provider list/connect/account list/reconcile | A wrapper replaces every upstream typed failure with `device operation is unavailable`; oversized lists only say `device result is too large`. | Allowlist safe code/message/retryability from known errors; for oversized results name provider/source filters. Keep generic fallback for unknowns. |
| VCE-016 | `protocol import-json`; `journal link/unlink`; `intake import`; export pack reads | Core validation has useful issues but returns `UNKNOWN` or a generic shape error after a direct, unmapped call. | Map the core code and include bounded nested field paths; align command option schemas where the exact ID, enum, title limit, or stream contract is already known. |
| VCE-017 | `age model-cards`; Commons protocol list/show/explore; `exercise list/show/facets`; `experiment progress-card` | Missing/corrupt generated artifacts and rendering/persistence failures are undifferentiated `UNKNOWN` or `INVALID_INPUT`, sometimes path-bearing. | Safe artifact/render stage codes; copy Commons knowledge's graceful-unavailable pattern where continuation is valid. |
| VCE-018 | `doctor`; scheduled-log core/query operations; export pack writes | Read versus parse failures, registry conflict/corruption, permission, and storage failures are conflated. | Preserve stable operation stage and safe errno/domain code; do not describe I/O failures as malformed data. |
| VCE-019 | `scheduled-log pause/resume/archive`; `memory update` | Message is readable but code is `UNKNOWN`, so callers cannot distinguish not-found from retryable/internal failure. | Use stable `not_found`; lower priority than generic-message paths but inexpensive when touching the owner. |

## Silent success and misleading-success defects

These defects should not be "fixed" by adding logs. They require stricter input
validation or truthful result contracts.

| Priority | Commands | Proven behavior | Required correction |
| --- | --- | --- | --- |
| P0 | `immunization import-json` | An unknown or misspelled field can be silently dropped while the import returns success. | Add a strict import schema and expose `immunization payload-schema`; reject before writing. |
| P0 | `samples import-json` | Non-object members can be filtered from a mixed array and the remaining records saved without reporting the drop. | Reject the first invalid member with its array path; do not partially save unreported input. |
| P0 | `model` mutations and `assistant self-target set/clear` | Malformed operator config is treated as absent and can be overwritten, discarding unrelated facts. | Distinguish missing from invalid; fail mutations closed with `operator_config_invalid`. |
| P1 | `scheduled-log save` | Flags from an action family other than the selected `actionKind` can be silently ignored. | Reject incompatible flags and name the selected action family. |
| P1 | `goal/condition/allergy/blood-test/genetics list` | A status typo returns a believable empty success. | Validate against the owning status enum. |
| P1 | `wearables metric latest/trend` | An unsupported metric typo is indistinguishable from a valid metric with no data. | Validate with the canonical metric resolver and return `invalid_option` with bounded aliases/help. |
| P1 | `age evidence` | A scalar JSON payload succeeds as zero cards; a non-array `cards` property produces repetitive warnings instead of a field error. | Reject invalid top-level and wrapper shapes before analysis. |
| P1 | All date-filtered `wearables` leaves | Impossible calendar dates pass shape validation and can become empty success or later internal failure. | Validate real dates and enforce `from <= to`. |
| P2 | `samples batch list` to `samples batch show` | `list` can return a legacy ID that `show`'s argument schema rejects. | Make `show` accept every exact ID emitted by `list`. |

Two adjacent correctness bugs also surfaced and should be triaged outside the
error-envelope work:

- `measurement add` resolves a date-only `--occurred-at` using the vault time
  zone rather than an explicitly supplied event `--time-zone`, then stores the
  explicit zone beside the mismatched instant.
- Optional route elevation currently fails the whole successful route instead
  of degrading; VCE-013 includes the preferred recovery behavior.

## Good patterns to copy

No blanket rewrite is warranted. The following existing paths are already
actionable and demonstrate the desired behavior:

- Native Incur option/argument validation returns `VALIDATION_ERROR` with
  `fieldErrors` for enum, range, type, and required-option failures.
- `capture import-json` embeds the first invalid path and message directly.
- Workout JSON import and workout-format commands format schema issue paths.
- Supplement ingredient parsing names the indexed ingredient, missing fields,
  and allowed unit forms without echoing submitted health values.
- `samples add`, measurement tuple parsing, and scheduled-log schedule parsing
  name conflicting or missing flags.
- `validate` returns structured issues rather than throwing a generic failure.
- Audit and many show commands use stable, noun-specific `not_found` errors.
- Capture media, duplicate-label, manifest, and lookup failures are specific.
- Event JSONL import includes bounded line numbers and the first failures.
- Commons knowledge search safely reports its generated corpus as unavailable
  and tells the model it may continue.
- Device sync client transport errors already preserve typed retryability, and
  daemon startup excerpts are redacted.
- Missing Mapbox credentials, hosted-only label calls, lookup misses, and normal
  empty list/search results are already clear and should remain unchanged.

An `UNKNOWN` code by itself was not treated as a high-priority finding when the
message already gives an exact, privacy-safe repair. Stable codes are useful,
but generic messages, false success, wrong retryability, and path leakage come
first.

## Implementation order

1. **Define the repair envelope.** Add a value-free, bounded validation/repair
   type to the domain error contract and prove its final JSON shape. Preserve
   native Incur field errors.
2. **Close the root privacy boundary.** Redact unknown exceptions and classify
   safe filesystem categories before expanding detail anywhere else.
3. **Fix the highest-volume producers.** Migrate health imports, event
   mutations, food/recipe/provider, workout, scheduled-log, automation, and
   common JSON input paths.
4. **Fix truthful outcomes.** Address immunization, samples, operator config,
   wrong-family flags, status filters, wearable metrics, and Age evidence.
5. **Classify external failures.** Daemon, Mapbox, Exa, labels, hosted device,
   catalog, render, and export boundaries need status/stage-aware retryability.
6. **Finish lower-volume taxonomy gaps.** Known core errors and readable
   `UNKNOWN` not-found/conflict paths.
7. **Ratchet coverage.** Assert final machine envelopes, privacy non-echo, and
   leaf inventory from the generated 340-command source of truth.

## Logging and privacy contract

Model-facing output and durable logging have different purposes.

The model-facing error may contain:

- command leaf and stable error code;
- retryability based on known cause/status;
- bounded field paths, issue codes, and value-free messages;
- bounded operation stage, status bucket, or safe errno category;
- one concrete next action when that action actually exists.

Durable telemetry should normally contain only:

- command family or leaf;
- stable error code;
- issue paths/codes and counts;
- operation phase;
- safe status/errno bucket;
- retryable flag and a correlation identifier.

Neither surface should contain submitted values, health/vault content, event or
member identifiers, raw JSON/CSV cells, message text, provider response bodies,
credentials, arbitrary causes/context, or absolute filesystem paths.

## Required regression suite

The shared correction should not be accepted on use-case-only tests. Add final
CLI-envelope tests for:

1. Each supported safe validation shape and deterministic bounding.
2. Stable domain code plus field details in JSON/full-output formats.
3. No echo of input values, file contents, provider bodies, causes, or paths.
4. Raw filesystem errors becoming stable, redacted root errors.
5. Pre-serve failures honoring the requested machine format.
6. Invalid automation cron/time-zone/route fields naming the exact path.
7. Representative health, encounter, event, food/recipe/provider, workout, and
   scheduled-log validation failures.
8. Provider auth, 429, 5xx, timeout, and malformed-success retry decisions.
9. Batch lifting the real child error envelope.
10. Every silent-success case failing before a write or returning a truthful
    warning/result.

Add a generated-leaf reconciliation check for audit tooling. The descriptor
manifest currently omits 104 registered leaves; requiring descriptor equality
is appropriate only if descriptors are intentionally made exhaustive.

## Verification performed

- Reconciled 340 registered command paths across 61 roots between the generated
  Incur map and generated config schema.
- Traced the shared bridge, terminal formatter, entrypoint, and representative
  producers through their final rendering paths.
- Proved the bridge detail loss with a synthetic `VaultCliError` carrying a
  field issue.
- Proved raw permission errors can become `UNKNOWN` with an absolute path.
- Proved pre-serve duplicate `--vault` failure ignores requested JSON output.
- Ran focused existing CLI tests for nested encounter validation and malformed
  structured workout input: 2 files passed, 2 selected tests passed, 11 tests
  skipped by the focus filter.
- Used synthetic, non-production inputs to reproduce representative validation,
  silent-success, provider, batch, and taxonomy paths. No production vault
  contents or identifiers were used or persisted.

## Remaining limits

- No production hosted-group automation save was executed.
- Provider and operating-system branches were selectively simulated rather
  than exhaustively fault-injected.
- This report recommends work packages; it does not implement the fixes.
- Command behavior can overlap rows. Counts in the coverage table are command
  inventory counts, not unique-defect counts.
