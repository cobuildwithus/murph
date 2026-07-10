# Hosted Group Rename Tool

Status: completed
Updated: 2026-07-07

## Why

Murph can create hosted group records for group chats, but it currently cannot
rename the database group after creation from the conversation. Users can ask
for a friendlier or more specific group label, and Murph should be able to make
that product-state change when the current conversation is already a hosted
group context.

## Scope

- Add the smallest web-owned mutation for updating a hosted group's display
  name.
- Expose a narrow assistant/runtime tool only when the active hosted context is a
  group chat.
- Bind authority to the current hosted member/runtime context and current group,
  not to model-supplied group ids.
- Validate and normalize the new name with a conservative length/empty check.
- Add focused tests for the mutation boundary and the tool wiring.

## Non-goals

- Do not rename the upstream iMessage/Linq/Telegram group chat title.
- Do not add a group-settings UI, scheduler, queue, or new persisted-state owner.
- Do not change newsletter setup behavior beyond giving Murph a rename tool that
  can be used in those conversations.

## Verification plan

- Prefer `pnpm test:diff <touched paths>` if it truthfully covers the web,
  runtime, and assistant-tool owners.
- Run `pnpm typecheck`.
- Add or update focused owner tests for validation and authorization.

## Result

- Added `update_display_name` to the hosted runtime group tool contract and
  parser.
- Added a web-owned transaction that renames the group resolved from the current
  runtime member id, not from model-supplied group ids.
- Exposed the assistant dynamic tool action only as a database display-name
  rename, with prompt guidance that it does not rename upstream chat titles.
- Covered parser validation, assistant argument parsing, runtime forwarding, and
  web authorization/unavailable behavior with focused tests.

## Verification

- `pnpm exec vitest run apps/web/test/hosted-group-tool.test.ts --config apps/web/vitest.workspace.ts --project hosted-web-store-config --no-coverage`
- `pnpm exec vitest run test/assistant-codex-group-tool.test.ts --config vitest.config.ts --no-coverage`
- `pnpm exec vitest run test/hosted-runtime-group-tool-linq-context.test.ts --config vitest.config.ts --isolate=true --no-coverage`
- `pnpm exec vitest run test/parsers.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/hosted-execution typecheck`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir apps/web typecheck:prepared`
- `pnpm --dir packages/assistant-runtime typecheck`
- `git diff --check`

Broader package-suite note: the unfiltered `packages/assistant-runtime` test
script failed in `hosted-runtime-workspace-entrypoint.test.ts` on an unrelated
workspace-entrypoint fake-timer/temp-runtime cleanup case. The directly touched
runtime group-tool context test passed.

## Deployment notes

This may span web, Cloudflare-hosted runtime callbacks, and the runner bundle.
Keep the deploy-skew behavior compatible: old runners must continue working
without the tool, and new runners must receive a structured unavailable result
until the web callback exists.
Completed: 2026-07-07
