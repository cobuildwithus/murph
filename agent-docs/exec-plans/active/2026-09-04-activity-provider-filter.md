# Support explicit activity provider filters

Status: active
Created: 2026-09-04
Updated: 2026-09-05

## Outcome and protected behavior

Allow an authorized device-activity automation to select Garmin, Oura, or Fitbit explicitly and to change an existing selection. Preserve omitted-source matching across providers and the existing WHOOP family versus WHOOP v2 distinction. Provider selection never grants device access or changes delivery authority.

## Existing owners and cause

The persisted automation schedule in packages/contracts owns the source enum. The CLI duplicates its current two-value enum. Hosted tool schemas derive from the persisted schedule. The assistant device-activity scheduler extracts source identity from canonical imported event metadata, but only WHOOP cases exist in its source matcher. Extend those current owners; add no provider API, dependency, state store, queue, or alias registry.

## Product UX

- Outcome: requested activity notifications can follow a supported selected wearable source.
- Reaches: new and edited device-activity automations, explicit supported source selection, omitted source, and existing WHOOP records.
- Proof: schema admission and rejection, saved/edit readback, matching and mismatching canonical imported events, and unchanged once-per-activity delivery identity.

## Scope and evolution

Accept only explicit supported provider slugs. Fitbit uses the existing google_health connection identity with legacy fitbit retained; match both normalized identities without changing the public selector. Garmin and Oura use their canonical slugs. Existing records remain valid; no rewrite or backfill is needed. Older readers reject new enum values, so consumer-first deployment and a rollback floor must be documented before enabling new writes. Preserve cursor and route semantics during source changes.

## Tasks

1. Obtain a concrete implementation patch from managed ReviewGPT using the guarded source snapshot.
2. Critique and integrate the smallest correct patch across contract, CLI, advertised tool, persisted parser, runtime matching, and generated artifacts.
3. Add focused regression coverage for new sources, retargeting, omitted source, WHOOP compatibility, unsupported values, and canonical source precedence.
4. Run focused tests and typechecks through the coordinated test slot; regenerate owned schema/CLI artifacts, inspect full provider input impact when advertisement changes, and review the actual diff.
5. Add a member-facing changelog, open a draft PR, present candidate evidence, and run final exact-head ReviewGPT concurrently with required CI after parent review.

## Verification

Baseline: focused device-source contract regression produced three expected failures for Garmin, Oura, and Fitbit, while three legacy/omitted/unsupported-selector cases passed. Initial collection required a normal frozen filtered workspace dependency install. No production operations or live device calls.

## ReviewGPT implementation

Managed GPT-6 Pro returned a concrete seven-file unified implementation patch from the guarded source snapshot. The patch was downloaded, inspected, and applied locally. It reuses the canonical enum, adds only three explicit provider cases, and covers persistence, advertised/runtime parsing, CLI retargeting, canonical source precedence, and scheduler replay. Redundant baseline-only coverage was removed in favor of the supplied lifecycle cases. Final PR review is a separate gate.

Local contract lifecycle suite: 19 passed after the implementation. Focused CLI source-retarget regressions: three passed, including same-owner readback, unchanged route/instructions, source-edit cursor reset, stale-writer rejection, and unsupported selector rejection. Contracts schema generator passed; its only tracked change is the intended three-value enum extension. CLI artifact generation passed through the canonical prepared dependency build; config-schema and generated types change only the source enums, with the expected skill hash change. No migration is required for existing records. Older readers reject new source values even in paused or archived records, so pausing is not a rollback strategy; retain compatible readers or explicitly reconcile new-value records through their canonical owner before downgrading.

## Candidate review

Parent reviewed the minimal three-owner source change provisionally and requested no source remediation. Final readiness remains pending generated CLI artifacts, engine regressions, focused live assistant proof, typechecks, complete initial request measurements, and final diff review.

## Additional verification

- Scheduler suite: 58 passed, including canonical provider precedence, legacy/current Fitbit, WHOOP variants, omitted source, sleep, and retry deduplication.
- Advertised/runtime schema suite: 16 passed. The first run exposed an external patch fixture error (JSON text passed to an internal already-decoded-arguments boundary); corrected the fixture to use the actual reader contract.
- Exact-base and current persisted-parser matrix: 36 combinations across six source choices and three statuses. Old readers reject every new explicit source even when paused or archived; current readers accept all supported choices. Both readers retain WHOOP and omitted-source compatibility.
- Identical direct/group production prompt, dynamic catalog, and initialize/thread-start/turn-start serialization captures: direct 24,182 to 24,190 o200k_base tokens (+8, +0.0331%), 113,630 to 113,655 UTF-8 bytes (+25); group 21,385 to 21,393 tokens (+8, +0.0374%), 100,658 to 100,683 bytes (+25). The whole serialized difference is exactly the three enum additions. Measurement includes all application-owned request fields and complete deferred schemas, not just authored text. Native Codex server-internal framing and tool-search rendering are not observable at this application boundary and are excluded; these are application-request token counts, not billed usage.

- Contracts, assistant-engine, and CLI typechecks passed. CLI save/edit schema advertisement assertion passed (one focused case), complementing the three same-owner source retarget regressions.
- Frozen filtered Web dependency install passed without lockfile edits. Focused live proof runs one exact provider case per invocation; a multi-case name was rejected by the normal runner guard before any provider action.

## Live-proof correction

The first Garmin live run used the correct source once but omitted the requested workout filter. The scheduler intentionally treats omitted activity kind as all kinds, including sleep. Parent approved a bounded canonical schema-description clarification: select workout/sleep/named activity explicitly and omit only for all kinds. Runtime matching policy stays unchanged. Added exact advertised-guidance assertions and extended the new provider sleep cases to prove sleep/all selectors match while workout excludes sleep. Reply output now precedes assertions so a failed owned-effect check still exposes synthetic prose for review. Regeneration, revised input measurement, and same-home Garmin rerun are pending.

## Amended input and complexity proof

The revised complete application request captures are direct 24,182 to 24,236 tokens (+54, +0.2233%), 113,630 to 113,867 bytes (+237); group 21,385 to 21,439 tokens (+54, +0.2525%), 100,658 to 100,895 bytes (+237). Exact structural comparison limits the differences to the new source values and activity-kind guidance. The previously stated native-runtime exclusions still apply. Complexity guard passed with unchanged debt and maxima: existing scheduler coordinator 21 and CLI issue-path mapper 43 are unchanged; the modified source matcher is below threshold.

Parent approved one corrected exact Garmin live journey as sufficient shared model-path proof alongside deterministic coverage for every supported provider. Oura/Fitbit opt-in cases remain available but are not claimed as executed.

## Explicit selector guidance

The same Garmin journey still omitted the requested workout kind after the nested field description. The production live configuration aliases workspace imports to source; the application thread-start serializer forwards the same dynamic tool schema directly, without generated CLI artifacts. Explicit workout selectors survive canonical save and patch parsing for every supported provider (18 model-schema tests passed). Parent approved one selector sentence beside the tool's canonical schedule examples; omitted kind and source retain all-kind/all-provider semantics. The third exact Garmin journey is pending and prints synthetic raw requested schedules plus parsed saved schedule before the strict outcome assertion.

The final amended complete application request captures are direct 24,182 to 24,289 tokens (+107, +0.4425%), 113,630 to 114,171 bytes (+541); group 21,385 to 21,492 tokens (+107, +0.5004%), 100,658 to 101,199 bytes (+541). These supersede earlier candidate measurements. Whole-request structural comparison proves only the supported source enum and nested/top-level selector guidance differ. Native runtime and billed-input exclusions remain unchanged.

## Canonical shape refinement

A later live replay correctly selected workout but used a capitalized provider, then changed the schedule discriminator during repair; both attempts were rejected before mutation. Parent approved replacing the existing selector sentence in place with one exact canonical deviceActivity JSON shape and lowercase source/requested cutoff guidance. No runtime coercion or default was added. Model-schema/parser tests remain 18 passed. An accurate restatement of the exact supplied cutoff is now excluded narrowly from the invented-clock assertion; every persisted-effect assertion stays strict.

Final shape-candidate measurements supersede the previous values: direct 24,182 to 24,332 tokens (+150, +0.6203%), 113,630 to 114,338 bytes (+708); group 21,385 to 21,535 tokens (+150, +0.7014%), 100,658 to 101,366 bytes (+708). Exact whole-request comparison limits changes to the source enum and canonical nested/top-level selector guidance, with the same native-runtime exclusions. Exact-shape Garmin replay remains pending.

## Resumed candidate verification

The resumed task matched the handed-off base and task-owned dirty files; no conflicting worktree process or remote branch existed. Parent candidate review approved the four production owners and their focused regressions without remediation. Final schema tests passed 18/18 and assistant-engine typecheck passed. Changelog production archive rendering passed 9/9, and the unchanged production presentation reference returned HTTP 200 under the content-only proof contract.

The exact-shape Garmin journey first failed before any provider action because the previous subscription profile reached its usage limit. The unchanged journey is being retried once on the next eligible authenticated profile under the repository's pre-action quota fallback rule; no credential contents were accessed or copied. Live UX remains Hold until strict effects and prose pass.

The first eligible alternate profile passed the same exact Garmin journey on GPT-5.6 Terra through the local subscription. It requested and saved exactly one canonical deviceActivity schedule with source=garmin, activityKind=workout, and the exact requested cutoff. The reply truthfully confirmed the saved future check-in, with no invented clock occurrence, duplicate effect, unnecessary question, or internal terminology. Parent accepted the direct evidence and Ready UX verdict. No further subscription profiles were tried. Web typecheck is the remaining local gate; final pushed-head ReviewGPT and CI are pending.

Web typecheck completed successfully with generated changelog/health-commons data and Prisma client preparation. All local candidate gates passed; no process was signaled. Final diff readback and identifier scan found no leakage or unrelated changes. Candidate publication, final exact-head ReviewGPT, and CI follow with the plan retained active.
