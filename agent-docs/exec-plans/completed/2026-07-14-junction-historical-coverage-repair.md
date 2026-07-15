# Junction historical coverage repair

## Goal

Repair Junction historical-coverage evaluation so supported Apple Health SDK
sources participate, raw Junction payload semantics have one importer-owned
implementation, and a valid empty historical window cannot be mislabeled as a
wearable reconnect failure.

Success criteria:

- Apple Health-only and mixed-source connections receive source-specific
  historical coverage evaluation.
- Official Junction activity, sleep, and sleep-cycle response shapes are
  interpreted by importer-owned code shared with the coverage state machine.
- Transport completion uses Junction historical-pull status rather than the
  presence of a qualifying data row, including successful zero-data windows.
- Existing terminal coverage state is safely reevaluated under a new version.
- Reconnect errors remain bounded to a proven provider-specific recovery case
  and never imply resetting healthy sibling sources.
- Focused, routed, and cross-layer regression tests pass.

## Constraints

- Preserve the package ownership boundary: importers own raw payload meaning;
  device-sync owns source obligations, retry timing, and lifecycle state.
- Do not add a new service, queue, persisted map, or generic framework.
- Keep health payloads, member identifiers, credentials, and local machine
  identifiers out of committed artifacts and logs.
- Preserve current-data ingestion and direct-provider behavior.

## Approach

1. Add regression tests for Apple Health-only coverage, successful empty
   history, official parallel sleep-cycle arrays, and importer/checker parity.
2. Export a narrow Junction historical-evidence classifier from the importer
   and delete the duplicate semantic parser from device-sync.
3. Use Junction historical introspection to distinguish completed, pending,
   unsupported, and failed pulls by provider/resource.
4. Include recognized SDK sources in coverage eligibility and advance the
   persisted coverage version so current connections are reevaluated.
5. Verify the focused suites, routed diff checks, scenario integrity, coverage
   write audit, and exact-head PR review.

## State

Complete.

## Outcome

- Junction summary meaning now has one owner: the importer classifier delegates
  to canonical normalization, while device-sync retains only source obligations,
  retry timing, and recovery policy.
- Historical-pull introspection distinguishes success, pending, unsupported,
  unknown, and failed provider resources. Successful zero-data windows complete
  without inventing a row-count requirement.
- Recognized SDK sources, including Apple Health, participate independently of
  the Link-provider filter.
- Historical reconnect authority is limited to explicit Garmin failures; stale
  non-Garmin recovery markers are cleared without disconnecting healthy sibling
  wearables.
- The production change removes more Junction provider code than it adds and
  introduces no new service, queue, store, dependency, or persisted field.

## Verification

- Focused importer, device-sync, assistant-runtime, and web projection suites
  passed, including the full 816-test device-sync and 1,639-test assistant-runtime
  packages.
- All 15 packages selected by the routed diff check passed typecheck. Every
  selected package suite except one untouched assistant-engine file passed.
- The assistant-engine file's initiating warm-process test timed out once and
  contaminated later cases with busy-state failures; that exact test passed in
  isolation immediately afterward.
- The repository build, scenario-integrity checks, documentation guards, and
  diff checks passed.
- The required coverage-write audit found no missing high-risk regression case
  and made no edits.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
