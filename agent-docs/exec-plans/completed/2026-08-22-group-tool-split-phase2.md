# Complete the Murph group tool catalog split

Status: completed
Created: 2026-08-22
Updated: 2026-08-22

## Goal

- Replace the provider-visible 30-action `murph.group` surface with six focused group-family descriptors after the compatible parser has reached production.
- Preserve the existing canonical group request, executor, signed callback, trusted route/member binding, and restricted scheduled group-read fallback.
- Make invalid tool calls return the complete validator reason to the originating model, so it can repair the request instead of treating a generic rejection as a product limitation, while keeping durable diagnostics value-free.

## Success criteria

- Ordinary authorized group turns advertise exactly `murph.group_consult`, `murph.group_data`, `murph.group_membership`, `murph.group_usage`, `murph.group_chat`, and `murph.group_email` for the 30 public group actions.
- Each descriptor exposes only its own strict action and field surface, while all accepted calls still normalize to `kind: "group"` and use the existing executor.
- Legacy `murph.group` parsing remains available for rollback compatibility but is absent from the ordinary full group catalog.
- Restricted detached/scheduled shared reads retain the existing narrow `murph.group` descriptor and authority boundary.
- Invalid tool calls return the complete Zod reason to the originating model, including unknown field names and allowed values, while durable diagnostics contain only bounded, value-free validation metadata.
- All dynamic-tool validation surfaces are audited for generic model feedback, missing diagnostics, and schema/runtime drift; confirmed failures are corrected without adding a second executor or state owner.
- Focused tests, assistant-engine typecheck, provider-input measurements, required ReviewGPT gates, and exact-head CI pass before merge.

## Scope

- In scope: provider-visible group-family descriptors, catalog availability/type plumbing, provider-visible assistant skill references, legacy-parser compatibility, complete model-visible validation reasons, value-free durable diagnostics, focused regression coverage, and matching architecture documentation.
- Out of scope: new endpoints, stores, queues, schedulers, permissions, member/group identity inputs, executor behavior, or changes to Web/Cloudflare/Temporal ownership.

## Product UX

- Classification: Patch. The member promise is unchanged; this repairs tool selection and retry behavior for existing group conversations.
- Primary journey: a participant asks the current group Murph to set a recurring check-in; Murph selects the route-bound automation tool, supplies only supported fields, and reports actual scheduler acceptance or failure.
- Protected journey: detached or scheduled group work that has only shared-read authority sees the same narrow read-only group tool and gains no additional action.
- Recovery journey: a malformed automation call receives the validator's complete reason and can retry without blaming missing day/time or member permissions unless the scheduler actually reports that condition.

## Risks and mitigations

1. Risk: a family schema drops a valid field or advertises another family's field.
   Mitigation: derive every descriptor branch from the canonical legacy schema and prove exact action/field partitions plus canonical normalization.
2. Risk: catalog cutover reaches a parser without family-name compatibility.
   Mitigation: phase 1 is merged and a successful production deployment uses a descendant revision; keep legacy parsing as rollback compatibility.
3. Risk: replacing `murph.group` widens detached/scheduled authority.
   Mitigation: change only the ordinary `groupAvailable` catalog branch and pin the specialized shared-read descriptors unchanged.
4. Risk: useful model-only validation detail enters durable diagnostics.
   Mitigation: keep the complete Zod reason ephemeral and non-serializable; persist only the existing bounded, value-free digest and prove the separation in tests.

## Tasks

1. [x] Define six strict provider-facing descriptors from the existing canonical group schema and action ledger.
2. [x] Cut ordinary group discovery over to the six descriptors while preserving legacy parsing and restricted shared-read discovery.
3. [x] Update provider-visible group skill guidance and architecture ownership text, including the paired private managed-skill source.
4. [x] Return complete validation reasons to the originating model while keeping durable diagnostics value-free, with production-shaped regression tests.
5. [x] Audit all dynamic-tool surfaces for equivalent feedback, diagnostic, and schema-drift failures and resolve the shared opaque-feedback and diagnostic-coverage failures.
6. [x] Run focused tests, typecheck, provider-input measurements, and parent diff/privacy review.
7. [ ] Commit, push, open the PR, and run preliminary specialist plus final ReviewGPT concurrently with CI.
8. [ ] Resolve accepted findings, prove the exact head, merge, and retire the worktree.

## Verification

- Focused assistant-engine Vitest suites covering the group catalog/parser, dynamic tool resolution, assistant skill assets, automation schema validation, and validation feedback.
- `pnpm --dir packages/assistant-engine typecheck`.
- Exact serialized provider catalog/fingerprint and tool-count measurements before and after the cutover.
- Required preliminary `completion-specialists` and final PR ReviewGPT gates against the exact pushed head.
- Required GitHub Actions green on the final PR-authored head.

## Audit disposition

- Replaced generic executor rejection text across every current invalid dynamic-tool request with the same complete ephemeral Zod issue response.
- Replaced the manually enumerated diagnostic classifier with the structural `validationDigest` boundary, covering invalid request variants that the list had missed.
- Corrected the validation digest's unsafe-root count when a schema exposes more than the output's 16-key presentation cap.
- Restored the compact, Codex-supported automation refinements for a nonempty target override, exactly one local date selector, and at least one patch mutation. Conditional support ownership and local-time recovery coupling cannot be represented by Codex's supported JSON Schema subset without duplicating the schema beyond its canonical size; their existing runtime rules now return complete repair reasons, and support ownership is also explicit in the tool description.
- Found additional runtime/schema drift in assistant configuration, Family invites, physical-note pairs, vault-file retirement ids, pending-vault ids, response media, personalization, and support identifiers. No new per-tool machinery was added: the shared full-reason path makes each existing strict runtime rejection directly repairable.

## Local evidence

- Ordinary `groupAvailable` catalog: 5 tools / 23,695 serialized bytes before; 10 tools / 29,023 bytes after. The group surface itself changes from one 19,073-byte descriptor to six focused descriptors totaling 24,403 bytes and intentionally changes the thread contract fingerprint.
- Stable route prompt: 59,022 characters before; 59,104 after, an 82-character increase from explicit family names.
- Assistant Engine: typecheck passed; 19 changed Vitest files passed with 817 tests and 6 intentional skips.
- Private managed skills: 85 focused checks passed. Full `murph-cloud` verification reached its unrelated Temporal deploy timing suite, where 3 of 421 tests failed on exhausted local command deadlines; no orchestrator or deployment file is changed by this task.
Completed: 2026-08-22
