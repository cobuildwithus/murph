# Member workspace archive refusal

## Outcome and boundary
An explicitly requested private member workspace archive includes inspected non-secret member runtime files. Credentials, internal instructions/configuration, other-member data, unsafe filesystem paths and live process artifacts remain excluded. Originals remain unchanged; existing send approval and hash validation own delivery.

## Evidence and owner
PR #2873 added general vault ZIP permission but tested only visible files. PR #3106 permits runtime troubleshooting reads, not export. Investigate production prompt/tool ambiguity using the real Codex fixture and GPT Terra. Production changes are authored through ReviewGPT; parent owns reproduction, review, tests and completion.

## Product UX
Private explicit full archive requests should prepare a ZIP, disclose concrete omissions without leaking their contents, and truthfully report pending approval. Existing visible-file archive requests retain their behavior. Group and unverified requests gain no personal export authority. No new UI or export service.

## Steps
- Extend synthetic archive journey with safe runtime state/history and a credential exclusion sentinel; reproduce on unchanged production instructions.
- Apply reviewed minimal author patch, update deterministic composed-prompt proof and durable owners.
- Run focused tests, typecheck, GPT Terra live journey, inspect ZIP entries and unchanged originals, and measure complete provider input.
- Review diff, add member-facing changelog, commit with approved identity and finish required completion gates.

## Status
Baseline evidence: focused composed file-send guidance test and package typecheck pass.
Terra baseline did not reproduce a refusal: one run failed in synthetic send preparation;
both the explicit-runtime and general whole-workspace requests prepared one ZIP
and one approval but included the fake credential file.
This proves missing source-content guidance, not the exact reported refusal or a
production credential leak. The regression requires safe runtime content, credential
exclusion, omission disclosure, unchanged originals and one pending send.
No production data or credentials accessed. ReviewGPT author response recovered below.

File-send boundary baseline: 33 focused tests passed. Full first-provider input baseline
captured for identical private/group fixtures; exact Terra tokenizer is unavailable,
so token counts must be reported unavailable rather than estimated.

## Implementation and deterministic proof
ReviewGPT supplied the two production instruction replacements; its response was
recovered through exact capture metadata after duplicate model-confirmation lines
prevented validated capture. This was patch authoring, not the final review gate.
Parent reviewed and applied those replacements. Authenticated-private export scope,
content inspection, narrow exclusions, in-archive omission notice and unchanged
hidden-ref/hash/destination approval boundaries are explicit. No new service,
state owner, schema, or runtime exporter was added.

Focused source tests: 243 cases exercised; 241 passed immediately, with only the
expected route fingerprints and measured prompt-size baseline requiring refresh.
After refresh, all 87 model-behavior tests and the exact route characterization pass.
File-send boundary coverage: 33 tests pass. Package typecheck passes. Changelog
rendering: 10 tests pass using the repository-root config after fragment generation.
Reused existing Frog entry 20260911184822 for that documented-command mismatch.
Complexity guard passes; unchanged existing 28/25-complexity prompt builders need
no unrelated refactor for a literal-text change.

Complete provider request capture at baseline 251f3c8f6fc9 and candidate with identical
fixtures: private 157380 -> 159815 bytes (+2435, +1.55%); group 141463 -> 141463 (0).
Private registered tool descriptions: 58497 -> 59727 bytes. Private instructions:
83984 -> 85189 bytes. The real pinned App Server, production Murph base instructions, and loopback scripted provider
capture all first-request fields except prompt_cache_key. Exact Terra tokenizer
is unavailable, so token counts are unavailable rather than estimated.


## Live and parent review
Ready: all three focused `pnpm test:assistant:live -- --test <pattern> --model
gpt-5.6-terra` cases pass through the local subscription: general whole-workspace,
explicit hidden-runtime/history, and original visible-file archive. Each requests
one generated ZIP and one pending approval, preserves original bytes, and emits no
attachment or false delivery claim. Runtime cases include both safe hidden records,
exclude the credential sentinel from extracted bytes/names and replies, and include
an omission notice. Parent reviewed every printed synthetic reply and the complete
diff. No real member data, delivery providers, or production credentials were used.

The exact source of the reported refusal remains unproven; the narrower demonstrated
cause is ambiguous archive-source guidance and missing hidden-runtime coverage.
Production revision and provider delivery are not claimed verified.

## Completion review and base reconciliation
PR #3537 received a validated final ReviewGPT PASS at 034382a25d83 with no
qualifying findings. The waited exact-turn capture, completion marker and
requested/observed gpt-6-pro response model agree. The first browser attempt
failed before submission; the healthy-lane retry owns the valid result.

Main advanced to 28ea746d789b during review and created two test conflicts.
The normal merge preserved both complete provider-input measurement blocks;
route fingerprints were refreshed from the combined existing production prompt.
Parent verified the reviewed two production instruction replacements are identical,
with group/maintenance/output-only fingerprints unchanged relative to current main.
This is a behavior-preserving base reconciliation, not a new substantive review.
After reconciliation, 243 focused tests, package typecheck, ten changelog rendering
tests and docs drift pass. Four complete request captures pass: private
157504 -> 159939 bytes (+2435, +1.55%); group 141587 -> 141587. Exact tokenizer
counts remain unavailable. Private tools are 58659 -> 59889 bytes and instructions
83946 -> 85151; group tools 44354 and instructions 62796 are unchanged.

All three focused Terra export journeys pass again after reconciliation. Parent
reviewed the printed replies and unchanged send/approval/content assertions: Ready.

The final plan-closeout commit carries evidence only. Exact-head required CI
remains the PR completion gate; merge, production deployment and actual provider
delivery are outside this local verification. Keep the open PR worktree.
Status: completed
Updated: 2026-09-17
Completed: 2026-09-17
