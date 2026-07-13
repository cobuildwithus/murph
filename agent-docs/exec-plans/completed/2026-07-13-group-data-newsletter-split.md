Goal (incl. success criteria):
- Replace the newsletter-specific shared-health reader with a generic group weekly-data primitive built on the existing consented group projection.
- Keep newsletter-only behavior narrow: recipient preparation and scheduled email delivery remain explicit hosted operations; shared health data is read only through the generic group CLI.
- Success means scheduled newsletters use the exact scheduled occurrence and vault timezone for weekly boundaries, newsletter tools never return email addresses, send authority/idempotency/opt-out behavior remains unchanged, and group-chat skills can reuse the same weekly primitive.

Constraints/Assumptions:
- Preserve the existing `vault-cli group shared` raw reader and add only the smallest reusable weekly projection needed by current group experiences.
- Do not add persisted state, routes, dependencies, arbitrary group-email capability, or a second projection parser.
- Keep health data in the group vault boundary and recipient resolution in the web/email boundary.
- Preserve missing-email reminder behavior, but name the newsletter preparation operation honestly rather than presenting it as a pure stats read.
- Preserve unrelated worktree and ledger edits.

Key decisions:
- Add `vault-cli group weekly` as a pure, member-attributed summary over the existing shared projection, with an optional explicit `--as-of` timestamp and the vault timezone in its result.
- Move the existing daily-record-to-weekly-stat adapter out of assistant-engine and into the CLI composition boundary, which already depends on both hosted-execution and query.
- Hard-cut `murph.newsletter action="read_stats"` to `action="prepare"`; it returns newsletter eligibility plus the scheduled occurrence reference, but no health rollups or superlatives.
- Keep `action="send"` newsletter-specific and server-authorized, with recipients resolved internally and no raw addresses exposed to the assistant.
- Update the newsletter skill to join generic weekly member data to prepared eligible recipients by member id.

State:
- Ready to publish.

Done:
- Inspected PR #582 and the original newsletter implementation lineage.
- Proved the existing raw group shared-data primitive and the duplicate newsletter-specific projection/weekly adapter.
- Traced scheduled occurrence, recipient eligibility, missing-email reminders, send authority, idempotency, and email-address boundaries end to end.
- Added the generic `vault-cli group weekly` summary over the consented shared projection, keyed by member id and evaluated in the vault timezone at an optional exact `--as-of` timestamp.
- Narrowed the hosted newsletter read action to recipient preparation, removed health data and display names from that contract, and updated the newsletter skill to join eligibility to the generic weekly result by member id.
- Consolidated duplicate projection-store file readers into one hosted-execution Node entrypoint and removed the newsletter-specific weekly adapter.
- Regenerated CLI artifacts and passed focused tests, affected-package typechecks, and a direct built-CLI fixture.
- Passed `pnpm test:scenario-integrity` and a complete `pnpm test:diff` changed-surface gate, including all affected package suites plus web lint, tests, and production build.
- Completed the required security/privacy review with zero medium-or-higher findings.
- Completed the required coverage-write pass; it added one fail-closed preparation-mismatch assertion, and the focused assistant-runtime file passes all 16 tests.
- Re-ran the post-audit affected suites: the changed assistant-runtime owner passed 1,565 tests; an unrelated concurrent setup-wizard keypress test failed once and then passed all 6 tests in isolation.
- Re-read the full diff and changed call paths; the final shape adds no state, route, dependency, or compatibility layer and remains a net deletion.

Now:
- Close the execution plan through the scoped commit helper and push the isolated branch.

Next:
- Open the PR and complete ReviewGPT plus CI against the exact pushed head.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/cli/src/commands/group.ts
- packages/cli/test/group-command.test.ts
- packages/cli/src/vault-cli-command-manifest.ts
- packages/cli/src/incur.generated.ts
- packages/cli/config.schema.json
- packages/cli/src/vault-cli-skill-hash.generated.ts
- packages/hosted-execution/package.json
- packages/hosted-execution/src/vault-share-store-node.ts
- packages/hosted-execution/test/vault-share-store-node.test.ts
- packages/hosted-execution/test/hosted-execution.test.ts
- packages/assistant-engine/src/assistant-codex/dynamic-tools.ts
- packages/assistant-engine/src/assistant-codex/group-newsletter-shared-stats.ts
- packages/assistant-engine/test/assistant-codex-group-tool.test.ts
- packages/assistant-engine/test/group-newsletter-shared-stats.test.ts
- packages/assistant-engine/skills/group-newsletter/SKILL.md
- packages/assistant-engine/skills/group-chat/SKILL.md
- packages/assistant-engine/src/assistant/system-prompt.ts
- packages/hosted-execution/src/runtime-control.ts
- packages/hosted-execution/src/parsers/runtime-control.ts
- packages/hosted-execution/test/parsers.test.ts
- packages/assistant-runtime/src/hosted-runtime/vault-share-import.ts
- packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts
- packages/assistant-runtime/test/hosted-runtime-group-tool-linq-context.test.ts
- apps/web/app/api/internal/hosted-execution/groups/newsletter-tool/route.ts
- apps/web/src/lib/hosted-groups/group-newsletter.ts
- apps/web/test/hosted-group-newsletter.test.ts
- agent-docs/index.md
- agent-docs/product-specs/group-health-newsletter.md
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
