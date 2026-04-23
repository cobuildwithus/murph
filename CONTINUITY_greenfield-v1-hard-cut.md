Goal (incl. success criteria):
- Land the first safe greenfield-v1 cleanup batch before public 1.0: package manifests use 1.0.0, the touched internal schemas/stores reset to v1, selected old-shape readers and compatibility aliases are removed, and directly coupled docs/tests describe the current design.

Constraints/Assumptions:
- No deploys/users to preserve; destructive storage/schema resets are allowed.
- Current checkout has overlapping active dirty rows, especially Cloudflare deploy/runtime and hosted assistant provider config. Do not overwrite unrelated edits.
- External provider/API versions are exempt from the "everything v1" rule.

Key decisions:
- Treat the cleanup as phased and commit only exact touched paths.
- First batch should avoid files currently dirty or explicitly owned by active rows unless the integration owner reviews the overlap.
- Hosted execution terminology, Prisma baseline squashing, CLI alias removal, and broader hosted web cleanup remain follow-up batches, not completion criteria for this plan.

State:
- First implementation batch complete and verified. Full release readiness checks pass for the final diff state.

Done:
- Five high-reasoning review subagents completed the initial audit and produced the cutover map.
- Registered the greenfield-v1 execution plan and ledger row.
- Set workspace package manifests to `1.0.0`.
- Reset hosted email, assistant cron runtime state, research orchestrator, and experiment protocol contract versions to v1.
- Replaced automation schema with `murph.frontmatter.automation.v1` and removed schedule `timeZone` compatibility.
- Removed hosted-execution generic side-effect aliases.
- Deleted one historical hosted-run review doc and removed package/research no-op compatibility flags.
- Added a literal apps/web proof that the experiment protocol contract is pinned to v1.
- Ran required coverage-write, simplify, and task-finish-review audits; addressed the doc/process and web-proof findings.

Now:
- Close and commit the first batch through the repo finish path, excluding unrelated active-lane edits.

Next:
- Open follow-up plans for hosted execution terminology, Prisma baseline reset, hosted web cleanup, CLI alias removal, and release execution once unrelated dirty lanes no longer block the clean-tree release script.

Open questions (UNCONFIRMED if needed):
- Whether runner containers should remain one-shot only or keep any warm-container operational seam.

Working set (files/ids/commands):
- Plan: agent-docs/exec-plans/active/2026-04-23-greenfield-v1-hard-cut.md
- Ledger: agent-docs/exec-plans/active/COORDINATION_LEDGER.md
- Verification target after implementation: pnpm typecheck, pnpm verify:acceptance, pnpm release:check, plus focused owner checks.
