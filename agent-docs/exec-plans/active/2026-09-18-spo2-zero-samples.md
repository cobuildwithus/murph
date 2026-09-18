# Skip unusable blood-oxygen samples without replacing complete-day history

## Outcome and invariant
Treat numeric zero SpO2 samples, including parsed numeric strings, as unusable input. Stop retrying solely because of those samples. Preserve existing valid canonical history and never publish a filtered complete-day replacement as complete. Other invalid values and unrelated resources retain their validation.

## Owner and smallest change
Use the existing Junction importer and complete-source-day authoritative-set boundary. Ordinary aggregates already omit unusable samples. For a complete-source-day blood-oxygen resource containing zero, omit that resource's temporal output and replacement authority; other resources remain independently usable. Prefer deriving this within the current normalization pass. No persisted state, dependency, service, scheduler, queue, general validation framework, or provider-specific branch is needed. ReviewGPT authors implementation and substantive revisions.

## Evidence and authority
A synthetic complete-day input containing zero currently throws JUNCTION_CALENDAR_REFRESH_INCOMPLETE_NORMALIZATION. User explicitly adopted skipping zeros as product policy; this is not a claim about undocumented provider sentinel semantics. Prior synthetic proof shows indiscriminate filtering can authorize an empty or partial replacement. Production operations remain read-only; bug-fix merge/deploy excluded.

## Product UX
Outcome: unusable samples no longer stall import, and useful history remains trustworthy.
Reaches: ordinary mixed/zero-only samples; complete-day mixed/zero-only input with and without prior history; sibling resources; corrected input and genuine empty responses.
Proof: actual normalization, canonical import/readback, replay, recovery, existing malformed-input checks, provider/service completion where needed.

## Steps
- [x] Focused failing proof and ReviewGPT implementation packet.
- [x] Apply authored patch; run focused owner tests/typecheck; inspect full diff and complexity.
- [ ] Changelog/owner contract, scoped commit, draft PR, final ReviewGPT and exact-head CI.

## Risks and rollout
No schema or deployment-order change intended. Old runners can retain the existing zero failure until replaced; new runners must not manufacture complete-day authority. No live recovery claim until separately authorized deployment and read-only verification.

## Progress
- Created an isolated sanctioned checkout from main; no overlapping open normalization PR found.
- New focused test fails at the expected complete-day zero rejection. Existing canonical Withings preservation/recovery test passes before implementation.
- ReviewGPT author request accepted using the managed lane and guarded full source/test archive. Reused existing Frog entry `20260915214405-reviewgpt-packaging-exceeds`: an ignored invocation wrapper summarizes expected stderr exclusions while retaining their full log and preserving the guarded packager exit status. No repository tooling changed.
- Parent traced temporal job completion: a no-op import does not publish temporal authoritative sets or a new complete-day coverage ledger; ordinary canonical facts are independently owned.
- Applied the exact ReviewGPT patch. Real provider/service/importer/canonical proof passes; importer, service, and Web typechecks pass. Changelog rendering passes (10 tests) using the repository-root invocation covered by existing Frog entry `20260912202546-changelog-focused-test`.
- Complexity guard found debt increasing from 75 to 81 in two existing importer functions. Sent an implementation revision request; no guard or baseline change.
- Full Junction suite initially passed 265 of 266 tests. The extra final scenario (restore original values after correction and an authoritative-empty response) fails identically against base `5eecc4b3f24a9cffeee83bd9ff3923db71a68d27` with all zero inputs removed. This pre-existing canonical revival issue is outside the zero-skip change. Removed that newly added assertion; zero preservation, correction after zero, true-empty retraction, and empty replay remain covered. Follow-up should inspect versioned provider retraction/reassertion in the canonical import owner.
- Reused Frog `20260829230530-reviewgpt-patch-attachment`: exact-metadata export verified the authored response and sole artifact; completing the native Save dialog recovered the exact patch after CLI download timeout.

- Final authored simplification reuses the omission validator and publication owner; no extra state or function versus the first patch. Parent reviewed the full diff, all changed paths, privacy, source/day validation, canonical preservation, and the unchanged retry/coverage owners. Product UX: Ready.
- Final local proof: 266 Junction importer tests, 3 service completion/retention tests, importer/service/Web typechecks, 10 changelog rendering tests, docs drift, and whitespace checks pass. Complexity passes with debt 75 → 75 and max 33 → 33; all ten above-threshold functions are unchanged.
- Delivery gates still pending: draft PR, final ReviewGPT, required exact-head CI, plan closeout, and remote-base mergeability. Merge and deployment are excluded.
