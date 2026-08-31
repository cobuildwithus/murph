# Versioned memory and bounded current state

Status: active
Created: 2026-08-30
Updated: 2026-08-31

## Goal

- Let Murph safely revise or retire saved memory without overwriting a newer
  correction, and give private direct conversations a small, fresh view of the
  member's current saved context.
- Reuse the canonical memory document, its audited core owner, and the existing
  private-turn context path. Do not introduce another source of truth.

## Success criteria

- Maintenance reads expose each memory record's `updatedAt` value.
- Maintenance updates and retirements require that value and fail without a
  write when the canonical record changed after the read.
- Retirements reuse the existing audited exact-ID forget operation.
- Private direct turns receive a deterministic, bounded selection of current
  memory alongside the existing bounded goal/regimen snapshot.
- Missing, malformed, or unreadable memory omits only that memory block; it
  never blocks the conversation or removes the existing snapshot.
- Group, maintenance, and other non-private-direct turns do not receive the new
  personal-memory block.
- Focused tests, package typechecks/builds, the real-assistant journey, and
  required review gates pass for the exact submitted head.

## Scope

- In scope:
  - Optimistic concurrency for core memory update/forget using existing
    `updatedAt` metadata.
  - A maintenance-only exact-ID forget action with narrow retirement rules.
  - A transient bounded memory projection composed into the existing
    private-direct-turn context.
  - Focused contract/core/assistant tests and prompt guidance.
- Out of scope:
  - New persisted memory fields, tombstones, semantic provenance, confidence,
    dependency graphs, or a second current-state file.
  - Scanning automations on the direct-reply hot path. Scheduling remains owned
    by the existing automation runtime.
  - Changing typed preferences, goals, regimens, or their canonical owners.
  - A broad redesign of maintenance evidence admission.

## Constraints

- Technical constraints:
  - Old memory documents must remain readable without migration.
  - Compare the expected version only after the core owner re-reads the record
    inside its existing resource lock.
  - Keep the direct-turn projection hard-bounded by record count, per-record
    text length, and total rendered size.
  - Preserve one-way data flow from canonical memory into a derived prompt.
- Product/process constraints:
  - Current user input, safety rules, and effect authority outrank saved memory.
  - A stale maintenance action stops safely instead of retrying from a new read
    in the same turn.
  - The established private-member journey improves; sparse/new-member and
    non-private journeys remain unchanged.
  - Use the repository's isolated worktree, finish-task, Product UX review,
    ReviewGPT, and assistant live-verification workflow.

## Risks and mitigations

1. Risk: Background consolidation overwrites a foreground correction.
   Mitigation: Require `expectedUpdatedAt` on maintenance mutations and compare
   it under the canonical memory lock. Forward foreground cancellation into
   the memory tool and reject each canonical operation after preemption.
2. Risk: Personal memory causes context growth or stale duplication.
   Mitigation: Select only the newest few records per section, omit oversized
   facts without changing their meaning, report omitted counts, and enforce a
   total byte ceiling.
3. Risk: A malformed memory file breaks every reply.
   Mitigation: Fail open for only the optional memory block while preserving the
   existing context snapshot.
4. Risk: Saved instructions are mistaken for permission.
   Mitigation: Label the projection as context only and retain the existing
   authority hierarchy in the system prompt.
5. Risk: Composed transcript text or a group participant silently corrects or
   retires the member's memory.
   Mitigation: Only raw direct-member events from the existing hosted input
   owner receive the `member:` authority label. Conflicting upsert/update and
   forget require that label; transcript, assistant, email, group, self, and
   ambiguous-route evidence remain context only.

## Tasks

1. Trace the canonical memory write owner and private-turn context owner.
2. Add expected-version checks to the existing update/forget operations and
   expose guarded maintenance mutations.
3. Build and inject a bounded transient memory block through the existing
   private-turn context path.
4. Add focused deterministic regression coverage and a real-assistant journey.
5. Run Product UX and code review gates, verify the exact head, commit, and open
   the PR.

## Decisions

- Use `updatedAt` as the version token. A separate revision field would duplicate
  existing state and require a migration.
- Use update as correction and the existing hard delete plus audit entry as
  retirement. Tombstones would retain private text and multiply filtering rules.
- Use the existing durable hosted input-event spine only to distinguish raw
  direct-member text from composed transcript context. Do not add an evidence
  table, provenance graph, or new persisted authority state.
- Do not add semantic provenance until maintenance evidence has a trusted,
  stable canonical evidence identifier; free-text provenance would be dead or
  unverifiable metadata.
- Extend the existing bounded context snapshot at read time instead of adding a
  persisted `CurrentState` owner or dirty/rebuild lifecycle.
- Leave automations out of this projection. Due-state belongs to the scheduler,
  and a direct-turn automation scan would add hot-path fan-out without a new
  demonstrated need.

## Product UX

- Effort: Product change.
- Outcome: A private reply can use a small amount of relevant saved context
  naturally, while background maintenance cannot overwrite or remove a record
  that changed after its read.
- Entry and promise: The member enters through an ordinary private direct
  message and receives the normal immediate reply. Overnight consolidation
  remains silent.
- Affected journeys:
  - Established members can receive a context-aware reply without an extra
    memory lookup.
  - New or sparse-memory members keep the existing behavior.
  - Explicit correction or withdrawal can update or forget exactly one
    unchanged record.
  - Group, maintenance-delivery, and other non-private-direct turns do not
    receive the personal current-state block.
- Challenge and resolution: Current input and canonical reads outrank the
  bounded projection; omitted detail can be read exactly on demand; and a
  stale maintenance mutation fails without changing the newer record. An
  oversized newer fact stops that section instead of exposing older facts
  behind it, and retirement requires explicit withdrawal or revocation.
- Walkthrough evidence:
  - A live private journey used the saved preference in the natural reply,
    `A short waterside walk at an easy pace sounds like a good fit tonight.`,
    with zero actions and no reference to internal memory machinery. Conflicting
    saved instructions did not override the current request or grant effect
    authority.
  - A live maintenance journey performed only `show` then `update`, copied the
    exact record id and `updatedAt` from a compact 24-record result, and ended
    silently.
  - A live withdrawal journey kept the record for assistant-only withdrawal
    text, then performed only `show` and exact guarded `forget` for a raw direct
    member withdrawal and ended silently.
  - Deterministic tests prove stale update and forget attempts leave the newer
    canonical record unchanged.
- Verdict: Ready after corrected-diff review. The final projection contains no
  record ids, and the maintenance boundary admits only production-shaped raw
  direct-member evidence for contradictory replacement or retirement.

## Candidate review

- Accepted Product UX findings:
  - Removed duplicate-based retirement because a silent hard delete could
    orphan a downstream reference and has no member undo.
  - Changed selection to a contiguous newest prefix so an oversized correction
    cannot expose an older fact behind it.
  - Moved live proof to the production-shaped per-turn context role.
  - Made block absence non-triggering for new and empty-memory members.
- Accepted code-review finding:
  - Classified successful maintenance `forget` calls as non-replayable writes
    in the existing notification recovery owner, with focused regression proof.
  - Forwarded the existing turn cancellation signal through the member-memory
    dispatcher and checked it immediately before every canonical operation, so
    an accepted maintenance request cannot mutate after foreground preemption.
- Accepted preliminary specialist findings:
  - Prevented assistant-authored evidence from authorizing retirement.
  - Strengthened the live CurrentState journey to prove current-input and
    effect-authority precedence, not merely fact recall.
- Accepted corrected-candidate findings:
  - Kept mutation policy out of generic read-only evidence and centralized the
    maintenance-only rule in one dependency-light policy module.
  - Stopped treating composed `user:` transcript entries or email routing as
    member authorship; raw authority now comes from the existing hosted input
    event owner.
  - Required raw member authority for any conflicting upsert, contradictory
    update, or forget so assistant-only evidence cannot rewrite by choosing a
    different mutation verb.
  - Matched real direct-channel provenance: direct Linq requires its persisted
    actor; ordinary direct Telegram intentionally has no actor or metadata.
    Both reject group-only route authority, including legacy ambiguous
    directness.
  - Removed record ids from the transient CurrentState projection because they
    are unnecessary for answering and exact canonical `show` remains required
    before mutation.
  - Rejected incomplete direct-member evidence as mutation authority. The
    complete normalized input must fit the existing 2,000-byte bound; an
    oversized withdrawal remains non-authoritative conversation context, so a
    truncated prefix cannot silently authorize update or forget.
  - Made direct-member mutation authority a contiguous newest suffix. The first
    eligible oversized input is a barrier to older authority, while complete
    newer inputs remain usable, so a later reversal cannot expose an older
    correction or withdrawal behind it.
- Rejected findings: None.
- Corrected-diff Product UX verdict: Ready.
- Corrected-diff code review: PASS, including the final fail-closed channel
  provenance narrowing.
- Architecture simplification review: PASS; no index, evidence schema,
  deduplication layer, cache, or second CurrentState owner is justified.
- ReviewGPT round 4: accepted one High finding that the member-memory dispatcher
  dropped the existing turn cancellation signal. The narrow signal-threading
  remediation and its three boundary regressions await round-5 review.

## Provider-input impact

- Method: Captured the complete first provider-visible request from the pinned
  real Codex App Server against a deterministic local Responses stub, using
  identical synthetic base/head fixtures, `gpt-5.6-terra`, low reasoning, and
  `gpt-tokenizer` 3.4.0 with `o200k_harmony`. Present request fields were
  serialized in fixed order; only generated input ids and the temporary
  workspace path were normalized. Transport, model-selection, reasoning,
  streaming, storage, cache, service-tier, account, and HTTP metadata were
  excluded identically.
- The base request was reconstructed in the same harness from the exact
  `origin/main` direct-memory line and absence of the new projection; the
  normalized group request did not enter either changed branch and was
  byte-identical. No reusable repository capture command exists.
- Private direct, with one synthetic saved preference:
  - Base: 27,517 tokens / 126,541 UTF-8 bytes.
  - Head: 27,686 tokens / 127,425 UTF-8 bytes.
  - Delta: +169 tokens (+0.6142%) / +884 bytes (+0.6986%).
  - Attribution: entirely assembled instructions from the revised memory-read
    policy and one bounded CurrentState record. Removing record ids saved 19
    tokens and 33 bytes relative to the prior candidate. Tool, schema, and
    generated guidance were byte-identical.
- Group:
  - Base and head: 23,769 tokens / 109,331 UTF-8 bytes.
  - Delta: 0 tokens (+0.0000%) / 0 bytes (+0.0000%).
  - Normalized complete requests were byte-identical because the projection and
    direct-memory guidance are private-direct-only. The changed member-memory
    schema is maintenance-only and absent from ordinary direct/group requests.

## Changelog

- Updated the existing grouped item `2026-08-30 ·
  saved-context-answers-stay-focused` for PRs 2578 and 2621.
- Kept priority 2 and used prose only; this is not priority 5 or
  interaction-heavy, and a visual would not explain the behavior better.
- Passed the focused changelog page test (9 tests) and Web typecheck.
- Review proof: `https://www.withmurph.ai/screenshots/ops#changelog-archive`,
  direct JSON review, and the unchanged archive renderer.

## Verification

- Passed: focused core memory tests (11 tests).
- Passed: exact corrected assistant owner suite (349 tests across current state,
  maintenance, notification recovery, planning, managed automations, model
  behavior, evidence admission, and read-only Assistant Ask).
- Passed: core and assistant-engine typechecks and package builds.
- Passed: real-Codex guarded correction journey (`show` then exact guarded
  `update`, no unrelated tools, silent completion).
- Passed: real-Codex private current-state journey (natural relevant reply, no
  memory read or other action, no internal-memory wording).
- Passed: corrected notification-recovery regression for successful maintenance
  forget classification.
- Passed: 335 focused assistant owner tests after the newest-suffix authority
  barrier, including exact 2,000-byte multibyte admission, suppression of an
  older correction and withdrawal behind a 2,001-byte reversal, and admission
  of complete newer authority after an older oversized input.
- Passed: the extended real-Codex withdrawal journey. Assistant-only evidence
  produced `show`; an older oversized input followed by a complete direct-member
  withdrawal produced guarded `show` then `forget`; and an older withdrawal
  followed by a newer oversized reversal produced only `show` and preserved
  the record.
- Passed: 231 focused assistant tests for direct cancellation admission, an
  already accepted App Server memory request, cron preemption between `show`
  and `forget`, and the surrounding memory/dynamic-tool/cron owners.
- Passed: assistant-engine typecheck and package build after cancellation
  remediation.
- Passed: the same-home real-Codex withdrawal retry after one stochastic model
  miss; the passing run produced `show`, `show` then exact `forget`, and `show`
  across the three authority scenarios.
- Passed: changelog page tests (9 tests) and Web typecheck.
- Passed: `git diff --check` and task-file privacy scan.
- Passed: Product UX Ready, architecture simplification review, and final
  corrected-diff candidate review with zero findings.
- Initial exact-tree live attempts were blocked before inference by local
  subscription limits. The repository-authorized alternate-home sweep reached
  an authenticated subscription and completed the extended withdrawal journey
  successfully.
- Pending: ReviewGPT remediation review, CI, final parent review, and plan
  closure on the exact pushed head.
