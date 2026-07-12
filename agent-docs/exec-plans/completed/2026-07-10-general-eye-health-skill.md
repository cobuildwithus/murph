Goal (incl. success criteria):
- Add a package-owned generalized eye-health skill that Murph can discover and read for common eye-health questions, including digital eye strain, refractive error, contact-lens care, prevention, and symptom triage.
- Ground the skill in current authoritative guidance and peer-reviewed evidence, with clear uncertainty and source provenance.
- Success means Murph receives concise, safe routing instructions; detailed evidence stays progressively disclosed; urgent eye symptoms are escalated appropriately; unsupported popular claims are not presented as established; and focused tests plus the package verification lane pass.

Constraints/Assumptions:
- Keep the implementation within the existing `packages/assistant-engine/skills/**` owner and its established discovery/test seams unless repository evidence proves another owner is required.
- Do not diagnose, reinterpret a contact-lens prescription as disease severity, recommend prescription changes, or imply that screen use permanently damages adult eyes.
- Prefer low-burden, reversible guidance and a clear off-ramp in line with the product constitution.
- Use authoritative ophthalmology/public-health guidance and peer-reviewed systematic reviews or trials; separate consensus advice from evidence-limited heuristics.
- Preserve unrelated working-tree and coordination-ledger changes.

Key decisions:
- Use a lean `SKILL.md` as the response workflow and triage boundary, with detailed clinical evidence and citations in one-level reference files.
- Treat red-flag triage and contact-lens risk as mandatory first-pass checks before routine self-care guidance.
- Keep personal diagnosis and treatment outside the skill; advise professional evaluation when symptoms persist, recur, impair vision, or conflict with contact-lens wear.

State:
- Complete; implementation, the controller-granted independent prompt review, and routed scoped verification are green and the task is ready for the repository closeout path.

Done:
- Read repository routing, architecture, invariants, product, completion, and verification guidance.
- Confirmed `packages/assistant-engine` owns Murph-managed package skill assets.
- Completed independent repository mapping plus evidence and safety research passes.
- Confirmed that discoverability requires both the typed skill registry and the compact system-prompt router catalog.
- Implemented the skill, two progressively disclosed references, registry and prompt routing, and focused asset coverage.
- Forward-tested both routine screen/contact discomfort and a painful red contact-lens case; narrowed the mild end-of-day dryness boundary found by the routine test.
- Resolved the initial independent prompt-review findings by routing new flashes and a sudden increase in or many new floaters independently, and by removing the conflicting `experiment` label from the comfort trial.
- Forward-tested isolated flashes and isolated new-floater cases after that correction; both retained immediate routing without being downgraded by absent pain or the other retinal symptom.
- Fast-forwarded the task worktree to current `origin/main` and rebuilt the new upstream operator-config and vault-usecases declaration prerequisites.
- Rechecked the retinal and contact-lens safety wording against current NEI and CDC guidance.
- Passed skill validation, the focused 24-test skill-asset file, assistant-engine typecheck, privacy scan, and `git diff --check` on the current base.
- Completed the single controller-granted independent prompt-review audit. Accepted and fixed all three findings: preserve prompt routing for any contact-lens pain, require bilateral symptoms for the mild self-care branch, and distinguish stable longstanding floaters from new flashes or a sudden increase in or many new floaters.
- Reran the focused 24-test skill-asset file, assistant-engine typecheck, skill validation, privacy scan, and `git diff --check` after the audit fixes; all passed.
- Passed the routed `pnpm test:diff` lane on the reconciled base: dependency and architecture guards, all six affected package typechecks, 3,665 affected package tests, and the Cloudflare verification surface (1,736 tests) passed. The first attempt exposed missing ignored Health Commons artifacts and a stale ignored assistant-cli build after the base update; canonical regeneration plus the three-file focused CLI rerun (79 tests) proved the failure was artifact preparation, and the unchanged full scoped lane then passed.

Now:
- Close the plan with `scripts/finish-task`, push the existing task branch without force, and open the authorized draft PR.

Next:
- Report the exact commit, draft PR, verification record, and CI state. ReviewGPT remains separately controller-gated.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-engine/skills/general-eye-health/**
- packages/assistant-engine/src/assistant-skill-assets.ts
- packages/assistant-engine/src/assistant/system-prompt.ts
- packages/assistant-engine/test/assistant-skill-assets.test.ts
- agent-docs/exec-plans/active/COORDINATION_LEDGER.md
- pnpm test:diff packages/assistant-engine/skills/general-eye-health packages/assistant-engine/src/assistant-skill-assets.ts packages/assistant-engine/src/assistant/system-prompt.ts packages/assistant-engine/test/assistant-skill-assets.test.ts
Status: completed
Updated: 2026-07-11
Completed: 2026-07-11
