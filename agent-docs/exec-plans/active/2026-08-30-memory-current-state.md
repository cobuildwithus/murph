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
- Accepted voice-memo transcripts are written into the ordinary durable user
  transcript, so maintenance sees what the member said instead of an attachment
  receipt summary.
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
  - Reusing durable attachment transcripts in the ordinary conversation
    transcript consumed by maintenance.
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
5. Risk: Assistant prose is mistaken for the member's intent, or natural member
   language is ignored because it does not use memory terminology.
   Mitigation: Keep one model instruction at the maintenance prompt owner: a
   `user:` entry may initiate correction or retirement in ordinary language;
   `assistant:` entries may provide context but cannot initiate it. The model
   judges the full chronological conversation and skips uncertain changes.

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
- Reuse the existing chronological `user:` / `assistant:` maintenance transcript
  and trust the model to interpret quotes, corrections, reversals, and ordinary
  language. Do not add a second authority view, channel-specific provenance,
  evidence barriers, or another persisted state owner.
- Keep attachment transcripts durable in the existing input event's
  `attachmentEvidence`. When an input is accepted, render its transcript into
  the ordinary durable `user` transcript that maintenance already consumes.
  Do not add a separate memory-authority stream.
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
  - Ordinary correction or withdrawal language can update or forget exactly
    one unchanged record without requiring memory terminology or an exact quote.
  - A voice memo contributes its accepted transcript to the same conversation
    history as typed input rather than only an attachment receipt summary.
  - Group, maintenance-delivery, and other non-private-direct turns do not
    receive the personal current-state block.
- Challenge and resolution: Current input and canonical reads outrank the
  bounded projection; omitted detail can be read exactly on demand; and a
  stale maintenance mutation fails without changing the newer record. The model
  uses the complete supplied conversation to distinguish a useful replacement
  from a fact that was temporary and should simply be retired.
- Walkthrough evidence:
  - A live private journey used the saved preference in the natural reply,
    `A short waterside walk at an easy pace sounds like a good fit tonight.`,
    with zero actions and no reference to internal memory machinery. Conflicting
    saved instructions did not override the current request or grant effect
    authority.
  - A live maintenance journey performed only `show` then `update`, copied the
    exact record id and `updatedAt` from a compact 24-record result, and ended
    silently.
  - A live retirement journey kept the record for assistant-only prose, then
    performed only `show` and exact guarded `forget` for the ordinary user line
    `That morning-summary preference was only temporary.` and ended silently.
  - Deterministic tests prove stale update and forget attempts leave the newer
    canonical record unchanged.
  - A deterministic accepted-input regression proves an attachment transcript
    becomes the ordinary user transcript text used by subsequent history reads.
- Verdict: Ready pending corrected-diff review. The final projection contains no
  record ids, and maintenance uses one chronological transcript plus one plain
  model rule rather than a second evidence-authority pipeline.

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
  - Prevented assistant-authored evidence from independently initiating a
    correction or retirement through one maintenance-prompt rule.
  - Strengthened the live CurrentState journey to prove current-input and
    effect-authority precedence, not merely fact recall.
- Accepted corrected-candidate findings:
  - Removed record ids from the transient CurrentState projection because they
    are unnecessary for answering and exact canonical `show` remains required
    before mutation.
  - Forwarded foreground cancellation to the existing member-memory dispatcher
    so preempted maintenance cannot begin a canonical operation.
- ReviewGPT rounds 2 and 3 found bugs in the review-induced mutation-authority
  collector's truncation and ordering rules. The user-approved complexity
  collapse removed that collector, its `member:` role, its channel provenance,
  and all special completeness and barrier logic instead of retaining the
  mechanism.
- ReviewGPT round 5 found that an attachment-only fallback could bypass the same
  collector. Accepted as a real flaw in that mechanism; resolved by deleting the
  mechanism rather than adding an attachment barrier. Accepted attachment
  transcripts now flow into the existing durable user transcript, so generic
  maintenance evidence sees the voice memo without a second evidence policy.
- Rejected remediation: another attachment-specific authority barrier, because
  the model can judge the generic chronological transcript and the removed
  collector no longer exists.
- Corrected-diff Product UX verdict: Ready.
- Architecture simplification verdict: Ready; optimistic version checking and
  abort propagation remain because they protect canonical concurrency that the
  model cannot observe, while semantic judgment stays in one prompt.

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
- Passed: final focused assistant owner suite (588 tests across generic
  maintenance evidence, prompt composition, managed automations, current state,
  member-memory execution, dynamic-tool dispatch, cron preemption, and accepted
  attachment-transcript persistence).
- Passed: core and assistant-engine typechecks and package builds.
- Passed: real-Codex guarded correction journey (`show` then exact guarded
  `update`, no unrelated tools, silent completion).
- Passed: real-Codex private current-state journey (natural relevant reply, no
  memory read or other action, no internal-memory wording).
- Passed: corrected notification-recovery regression for successful maintenance
  forget classification.
- Passed: 156 final prompt and managed-automation tests after removing the
  duplicated scheduled-job policy wording.
- Passed: the focused accepted-input regression proving a durable voice-memo
  transcript replaces the generic attachment fallback in conversation history.
- Passed: assistant-engine typecheck and package build after the final prompt
  composition.
- Passed: the final same-home real-Codex generic-transcript journey. The
  assistant-only scenario produced `show`; the ordinary user line saying the
  preference was only temporary produced exact guarded `show` then `forget`.
  An earlier run usefully exposed `show` then `update` for a natural but
  replacement-like phrase; the prompt now distinguishes a useful lasting
  replacement from a temporary fact without requiring deletion terminology.
- Passed: changelog page tests (9 tests) and Web typecheck.
- Passed: `git diff --check` and task-file privacy scan.
- Passed: Product UX Ready and the parent architecture simplification review.
- Earlier exact-tree live attempts were blocked before inference by local
  subscription limits; the repository-authorized alternate-home sweep reached
  an authenticated subscription. The final simplified journey passed through
  the current local subscription route.
- Pending: ReviewGPT round 6, exact-head CI, final parent review, and plan closure.
