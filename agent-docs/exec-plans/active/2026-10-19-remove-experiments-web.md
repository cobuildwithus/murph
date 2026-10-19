# Retire experiment website and public protocol content

Status: active
Created: 2026-10-19
Updated: 2026-10-19

## Goal and protected invariants

Remove the website experiment library, details, results, sharing routes, and their exclusive infrastructure and Health Commons experiment content. Preserve the assistant's private experiment creation, sessions, reminders, progress, and outcome analysis. Leave Environment unchanged. Preserve shared biomarker and goal knowledge and existing private records.

## Owners and implementation

- Web owns the removed routes, navigation, cards, and public presentation projections.
- Health Commons owns public experiment protocols, families, and their exclusive evidence/media; shared knowledge remains with its existing owner.
- Core, query, and vault-usecases retain canonical private runs and saved snapshots. The CLI and assistant should support private experiments without a public catalog prerequisite.
- Delete exclusive paths rather than introducing replacement services. Existing saved protocol snapshots and lineage remain readable; no private data migration or destructive production action.

## Product UX

Outcome: experiment work happens in the assistant, without a website library or public experiment links.
Reaches: website visitors, members with existing runs, and members creating new assistant-led experiments.
Proof: removed routes and navigation; existing experiment data remains readable; create/log/analyze a custom experiment without public protocol content; assistant gives conversational results without retired URLs.
Done when: focused tests and typechecks pass and the final diff preserves Environment and shared knowledge.

## Tasks

1. Map website-only dependencies and obtain Claude's scope review.
2. Remove website routes, exclusive presentation code/assets/tests, and active references.
3. Remove public experiment content and exclusive generated projections; clean shared references.
4. Decouple assistant experiment setup from the retired catalog and website while retaining existing run semantics.
5. Run focused checks and assistant proof, review privacy and compatibility, update owner docs/changelog, commit the scoped change, open a PR, and resolve ReviewGPT and required CI on its final head.

## Risks and verification

- Shared sources and generic experiment execution must not be swept into website deletion. Inspect actual consumers before removal.
- Existing protocol-linked runs carry immutable snapshots. Test continued progress and closeout without current catalog entries.
- Run affected Web, CLI, Commons, query and usecase tests and typechecks; assistant prompt changes also require the repository's focused live proof.
- No deployment or production data deletion is included.

## Progress

- Isolated checkout created; no Environment feature code changed.
- Scope corrected to website experiment surfaces and public experiment content.

- Claude audited the boundary and is implementing scoped website, catalog, CLI, packaging, documentation, and assistant-verification changes.
- Removed 35 public protocol pages, 40 family pages, and their exclusive source records/artifacts; retained sources reachable from surviving biomarkers, goals, and measurement methods. Catalog generation passes after reference cleanup.
- Private creation, saved-run activation/safety, immutable historical lineage, and concurrent outcome writes pass 25 focused tests. Vault-usecases typecheck passes.
- Website-specific browser run-card generation is being removed separately from assistant progress-card generation.
- Complete provider-input loopback captures pass for direct and group fixtures: both shrink by 185 bytes; dynamic tool definitions are unchanged. Exact model tokenizer unavailable, so no token estimate is claimed.
- Complexity guard passes; remaining hotspots are pre-existing shared workflow branches, with reduced aggregate complexity.
- User requested a PR, Claude review, and green ReviewGPT. Finish requires exact-head review and CI, with no merge or deployment.

- Preserved the six existing published biomarker pages by using their own reviewed publication status and completeness rather than public protocol references.
- Focused web coverage: 19 files / 328 tests pass. Mobile and desktop production sidebar proof passes and confirms `/experiments` returns 404 while Environment remains linked.
- Assistant deterministic guidance tests, typecheck, and the focused real-Codex private-start journey pass. The journey saves one private run with an explicit outcome and no retired catalog commands or web link.
- Commons typecheck and all 177 tests pass after updating the obsolete protocol-dependent publication expectation; generated-output determinism check passes.

- Claude candidate review found four issues: unverifiable positive legacy safety answers, stale test commands/assertions, overbroad biomarker trace includes, and caller-supplied private-protocol lineage. Accepted all four. Activation now fails closed for positive legacy answers; private-protocol reuse reads and verifies canonical saved revisions/snapshots; trace includes are narrow; test consumers are being updated.

- Removed the dead browser results engine and three orphan presentation components; shared metric identity and canonical outcomes remain with existing owners. Query suite passes 876 tests (one skipped).
- Final browser navigation/404 proof passes at 390px and 1280px; retained metric-card responsiveness passes at 320/390/768/1280px. Final trace tests pass 54 cases and Web typecheck passes.
- Follow-up Claude review identified a nested inline lineage bypass, stale onboarding assertions, and a dead historical changelog button. Closed the nested input, derive inline snapshots from the saved protocol, updated the safety assertions and saved-plan skill guidance, and removed only the dead button. Private-plan tests pass 13 cases and onboarding guidance passes 16; vault-usecases typecheck passes.
- Final complexity guard passes across 123 authored source files, with 17 retained hotspots inspected and lower aggregate debt. No new service, persistence owner, or dependency.
- Draft PR #4216 is open. Review preview and final deterministic assistant sweep are in progress; exact pushed-head ReviewGPT and CI remain required.

- Claude final follow-up returned PASS, including nested input rejection, saved snapshot validation, historical lineage preservation, and unchanged Environment.
- Full assistant sweep: 5,842 passed and 565 skipped; two stale prompt/skill assertions failed during the in-progress run. Both were corrected, and the complete affected two-file rerun passed all 38 tests. The four-file regression cleanup also passes 161 tests (seven skipped) and assistant typecheck passes.

- Review preview builds successfully. Live checks confirm `/design` returns 200, the navigation retains Environment and omits Experiments, and `/experiments` returns 404. Production project settings remain unchanged.
