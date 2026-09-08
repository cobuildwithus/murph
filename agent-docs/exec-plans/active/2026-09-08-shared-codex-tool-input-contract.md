# Preserve canonical tool input contracts across Codex exposure modes

Status: active
Created: 2026-09-08
Updated: 2026-09-08

## Outcome and scope

Owned PR3059 preserves complete canonical tool input contracts at the model
boundary across native and code-only exposure, with default-on real CLI upgrade
guards. Implementation and parent local proof are complete; final ReviewGPT
round 2 and required exact-head CI remain pending.

The production correction stays small: a 31-line derived schema adapter,
existing thread-start/fingerprint integration, and three song-description lines.
The card recovery/complete-text policy remains. No handlers, validation, canonical
input schemas, runtime configuration, dependencies, state, or effects changed.
Completed plans, image-model PR3077, and adjacent card-feature PR2629 are outside
scope. The existing unshipped changelog title, summary, and stable ID are unchanged
by these final corrections. No merge, deployment, or production action occurred.

The parent confirmed that stable Codex 0.153.4 is already pinned and that
0.154.0-alpha.7 has byte-identical relevant lossy code; upgrading alone does not
fix schema loss. The stable pin remains unchanged.

## Decisions and owners

- Derive the complete JSON Schema document from canonical `inputSchema` at
  `app-server-requests.ts` thread/start and append it to the top-level description.
  Preserve the original schema object, identity, namespace, loading policy, and
  dispatch authority. Sort object keys and escape JSON comment terminators
  without changing parsed content. Do not flatten references, rewrite branches,
  omit descriptions/defaults, or truncate. Repeated composition is idempotent.
- Feed those same declarations into the existing contract fingerprint owner.
  Planning bootstraps incompatible persisted contracts once using bounded
  committed history, then resumes the new native thread. No new lifecycle state
  or unconditional reset is needed; thread/resume still cannot replace tools.
- Clarify return/effect semantics in the existing song description: success
  already attaches native response media; code mode prints the returned text
  receipt with `text`, not media-render helpers. A post-success helper failure
  neither undoes attachment nor authorizes regeneration. The success `rpcText`
  already identifies the attachment and remains unchanged.
- Reuse the loopback Responses harness. The independent oracle reads actual
  provider requests, native search results, and complete code-generated metadata,
  not registration inputs or an imitation of Codex conversion. Production still
  owns process/thread lifecycle, runtime validation, authority, and effects.
- Keep commands and the CLI-upgrade contract in
  `agent-docs/references/testing-ci-map.md`, and architectural ownership in
  `ARCHITECTURE.md`. This plan records outcomes, not another operating policy.

## Completion gates

- [x] Preserve canonical schemas, tool identity, route/loading policy, and existing
  thread compatibility across all three exposure modes without mutation.
- [x] Prove small/large schemas, reference scopes, branch locations, and complete
  descriptions; reject corrupted, truncated, duplicated, or wrong-tool evidence.
- [x] Prove invalid admission has no effects, one valid generation succeeds, and
  its text receipt reaches the actual next provider request in both modes.
- [x] Apply the receipt correction unchanged; pass the changed guards, planning,
  typecheck, and local hygiene checks recorded below.
- [x] Rerun all four complete first-input measurements after receipt clarification.
- [x] Pass all five synthetic live journeys and obtain parent Ready after actual
  reply/effect review, including the strengthened song attachment assertions.
- [ ] Validate final ReviewGPT round 2 PASS with zero accepted unresolved findings.
- [ ] Validate required exact-head CI for the reviewed candidate.

The parent owns final review, CI, and mechanical archive/status/scoped commit
through `scripts/finish-task`, followed by resulting-head verification. Keep this
plan active until the two final gates pass. The PR body carries the exact reviewed
head, model, and evidence IDs; no merge or deployment is implied by plan closure.

## Parent local evidence

The parent reports the following results on the corrected candidate, before this
documentation-only evidence update:

- **117 PASS** across `assistant-codex-tool-input-contract.test.ts` and
  `assistant-codex-turn-planning.test.ts`: 13 guard tests plus 104 planning tests.
  Coverage includes all 56 canonical registrations, including route variants,
  in three exposure modes; exact schemas/reference scopes, corruption negatives,
  independent thread fingerprints, and the false-attachment-claim negative oracle.
  Native/code-only admission proof observes three invalid attempts with zero
  effects, then one valid generation and its receipt on the actual next provider
  request. All four affected scripted guards also passed.
- **Typecheck and whitespace PASS; doc gardening PASS with zero issues.**
  Complexity PASS: five changed source files, zero hotspots, reported maximum
  complexity 12 in existing code and 4 in the new helper.
- Earlier owner tests: **292 PASS**; CLI/runner parity: **23 PASS**; changelog:
  **10 PASS**. The new 117-test result overlaps planning coverage in the 292;
  these are not additive totals.

The full scripted command recorded 118 PASS, two oracle failures, and four
skipped. Both failures were subsequently corrected and their targeted tests
passed; the full command has not been rerun green. Exact source ablation failed
RED for the missing canonical marker, followed by byte-identical restoration.

## Complete first-provider-request measurements

All four measurement tests were rerun after the receipt clarification and PASS,
with exactly the same bytes, registration counts, and deltas:

| First provider request | Baseline bytes | Candidate bytes | Delta | Registered/deferred |
| --- | --- | --- | --- | --- |
| Private native | 149,655 | 152,788 | +3,133 (+2.09%) | 11 / 8 |
| Private code-only | 142,389 | 145,522 | +3,133 (+2.20%) | 11 / 8 |
| Group native | 126,688 | 133,064 | +6,376 (+5.03%) | 6 / 2 |
| Group code-only | 116,782 | 123,158 | +6,376 (+5.46%) | 6 / 2 |

These are complete decoded-input bytes. Raw wire bytes are decoded bytes plus
58 in both phases, so their deltas match. Song is **absent**, not deferred, in
these representative first-request fixtures: `songGenerationAvailable` is not
enabled. Its description clarification therefore adds no initial payload in
these routes. Later enabled song exposure carries that description, and the
56-registration catalog guards include it. General deferred contracts remain
8 of 11 private registrations and 2 of 6 group registrations.

Baseline bypasses only the shared adapter inside the local test spy; candidate
uses the adapter. Both use the same production builders, model catalog, card
policy, and route capability inputs. Wire counts include transport identity;
the normalized comparison permits only enumerated volatile identities and the
exact derived supplement. Exact target-tokenizer counts are unavailable; no
token values or zero-cost duplication claim is inferred from these bytes.

## Product UX — all five journeys Ready

The parent reviewed the synthetic outcomes and marked all five journeys Ready:

| Journey | Exposure | Verified outcome |
| --- | --- | --- |
| Nine requested items | Native and code-only (two journeys) | Zero card calls; all nine complete text entries in order. |
| Concise comparison of synthetic routes Amber/Birch | Native and code-only (two journeys) | Two routes, one valid card, no authored duplicate reply. |
| Authorized song shortening | Code-only (one journey) | One attempt, one successful dynamic completion, one fake generation, one native attachment; canonical 300-second maximum for a 360-second request. |

The strengthened song journey passed using the normal pinned CLI and local Terra
subscription, without a tap or wrapper. Actual prose truthfully reports duration
and shortening, with no false attachment-failure claim. The native response media
is present, with no other actions, writes, or runtime issues. The authorizing
fixture supplies neither the numeric maximum nor invocation/return-helper
instructions. The parent read the actual reply before marking Ready. The four
card journeys remain passing and unaffected by the tool-local song clarification.
No transcript excerpts, private data, or temporary investigation captures are
part of this record.

## Risks and limits

This preserves model-visible information, not constrained-grammar enforcement
or guaranteed model compliance. Existing validators and effect owners remain
authoritative. Full documents cost bytes when exposed; first-request measurements
do not claim to cover every enabled tool combination or later exposure.

Catalog discovery covers exported canonical registrations plus current boolean
resolver gates and the direct/group progress discriminator. A future new route
shape must extend the probes if those inputs cannot represent it. Upstream
schema-preservation improvements are welcome: no guard requires raw schemas to
remain lossy. Investigate changes to transport, metadata, identity, scope, or
deferred availability rather than weakening the oracle or blindly updating
snapshots.
