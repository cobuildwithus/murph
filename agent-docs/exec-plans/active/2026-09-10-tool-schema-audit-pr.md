# Audit tool schemas and publish the automation fix

Status: active
Created: 2026-09-10
Updated: 2026-09-11

## Goal

Audit all model-facing tool schema transformations for the automation declaration
failure class, correct proven related defects, and publish the reviewed PR.

## Success criteria

- Inventory covers every exported tool and route variant.
- Real Codex captures preserve complete canonical contracts, local declaration
  defects have regression proof, and upstream limitations are explicit.
- Any additional correction has focused regression proof and relevant typechecks.
- PR records scoped changes, live evidence, review, and exact-head CI truthfully.

## Scope and constraints

- Schema construction, registration, native/deferred/code conversion, and directly
  related validation/discovery only. No production records or mutations.
- Preserve runtime validators, permissions, version checks, and deferred loading.
- Preserve the completed original plan as historical evidence.
- Product UX: correct tool calls and concise progress in the existing quick and
  multi-edit journeys; additional journeys follow any proven affected behavior.

## Tasks

1. Inspect independent catalog and transport audits alongside real captures.
2. Correct proven declaration loss at its existing owner; extend focused proof.
3. Review tests, package checks, privacy, complexity and input-size evidence.
4. Publish the PR and complete its routed review and exact-head CI.

## Evidence

- Initial complete-contract suite passed: 14 tests, 56 tool/route registrations
  across eager native, deferred native, and code mode, plus adversarial sentinels.
- The removed automation compactor had no other callers. Existing inventory proof
  checks the canonical supplement; separate generated-declaration proof is needed
  to detect misleading types despite preserved raw JSON.

## Findings and corrections

- The deleted automation compactor had one production caller. A separate nutrition
  compaction used pattern constraints and six empty properties; inlining the same
  metric/goal definitions fixes the six real Codex unknown fields without changing
  runtime admission. Inner schema grows 5316 -> 6114 bytes (+798); the bounded
  6500-byte guard is supported by actual typed-declaration proof.
- Personalization's required-only alternatives displaced its update properties in
  Codex. A minimum property count and paired persona dependencies preserve typed
  properties and match runtime nonempty/pair admission. The live test caught a
  needless full-settings rewrite; sparse-update guidance now yields one tone-only
  save while preserving personality and voice.
- Custom Chat Completions conversion truncated all three tool-description forms at
  4096 characters, removing the canonical schema for long descriptors. Removed the
  slices while preserving request (8 MiB), tool JSON (256 KiB), and count (128)
  bounds. Native Responses and managed providers retain their existing paths.
- Corrected stale architecture prose that still described the deleted compactor.

## Focused evidence

- Complete inventory transport suite: 18 tests passed, covering 56 registrations
  in eager-native, deferred-native and code mode, sentinel damage rejection, and
  explicit generated-field checks. Empty named schemas are now rejected globally.
- 27 operator-config card tests, 42 engine card/personalization tests, and 18
  custom-provider adapter tests passed. The strengthened personalization proof
  covers all 32 mutable-field/pair-removal combinations and concrete enum types.
- Assistant Engine, operator-config, Cloudflare and earlier CLI typechecks passed.
- Terra local-subscription personalization live journey: Ready. Exactly one sparse
  tone save, no progress chatter, truthful concise confirmation, no private writes.
- Terra local-subscription dated nutrition-card journey: Ready. Exactly one
  canonical same-date context read and one valid card; no Goal mutations or
  duplicate attachments. Reviewed rendered synthetic output and required effects.
- Prior committed quick/single and four-reminder live proof remains valid: no
  automation runtime/prompt changes in this audit follow-up.
- Revised complete first-input fixture includes personalization for both private
  and group contexts. Identical base/head captures (base 52d27e05eb75), excluding
  only prompt_cache_key: private 165983 -> 167418 bytes (+1435, +0.8645%);
  group 149925 -> 151507 (+1582, +1.0552%). Exact Terra tokenizer unavailable;
  token totals remain unverified. Automation registration 21881 -> 30905 bytes,
  deferred; response-card growth is deferred. Custom endpoints now receive the
  complete already-admitted descriptions instead of truncated contracts.
- Complexity guard passed: no increased source hotspots; obsolete compaction debt
  removed. Documentation drift and gardening passed. Two independent read-only
  catalog and transport reviewers found no new regression in the local fixes.
- Final combined inventory and personalization run passed all 24 tests; changelog
  rendering passed all 10 tests. Final documentation and privacy checks passed.

## Explicit residual findings

- Pinned Codex 0.151.0 still shortens some deep automation signature types. Its
  internal no-compaction API is not exposed through supported RPC/config. The
  complete canonical JSON remains model-visible and runtime validation remains
  authoritative. This PR does not claim lossless generated TypeScript or fork the
  CLI. A future upstream change needs the same real boundary proof.
- Five existing group-family descriptors require action while conditional fields
  remain optional and are explained in prose/validated by the runtime. This is
  manual schema design, not reuse of the removed compactor; no live failure was
  established. A canonical action-contract unification is separate follow-up work.
- Missing coordination-ledger guidance is already tracked by the existing Frog
  issue; no duplicate entry or repository workaround is needed.

## PR completion

- Final ReviewGPT is now routed because the follow-up touches a provider protocol
  boundary as well as shared card authoring. Publish the draft, finish metadata,
  then start review on the stable Ready head concurrently with required CI.
- Production deployment and merge remain outside this request.
