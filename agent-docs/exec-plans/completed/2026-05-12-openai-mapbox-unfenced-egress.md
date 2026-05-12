# OpenAI Mapbox Unfenced Egress

## Goal

Restore hosted OpenAI/Codex and Mapbox credential injection for requests that cannot reliably carry hosted runtime write-fence headers.

Success criteria:

- OpenAI credential injection no longer requires runtime write-fence headers.
- Mapbox credential injection no longer requires runtime write-fence headers.
- Existing OpenAI and Mapbox protections remain: canonical HTTPS origin, explicit path/method policy, sentinel credential, upstream header scrubbing, and Worker-owned secret injection.
- Linq, Telegram, WhatsApp, and internal virtual-host routes remain write-fence protected.
- Focused tests prove unfenced OpenAI and Mapbox sentinel requests are accepted while disallowed provider shapes still fail closed.

## Constraints/Assumptions

- Keep the fix local to Cloudflare runner egress interception and focused tests.
- Preserve unrelated working-tree edits.
- Do not broaden provider path/method allowlists.
- This is a production-blocking trust-boundary fix; use scoped verification.

## Key Decisions

- Do not invent a Codex-specific proxy or container-id registry.
- OpenAI and Mapbox rely on sentinel credentials plus strict provider URL policy instead of write-fence headers.
- Side-effect provider channels continue to require the write fence.

## State

Complete; ready for scoped closeout.

## Done

- Confirmed current OpenAI and Mapbox intercept paths require `requestOwnsRuntimeWriteFence`.
- Confirmed focused tests currently expect 401 for unfenced OpenAI and Mapbox sentinel requests.
- Removed the write-fence gate from OpenAI and Mapbox intercept handlers only.
- Updated focused egress tests so OpenAI and Mapbox inject credentials without write-fence headers while Linq, Telegram, WhatsApp, and internal virtual-host routes remain fenced.
- Ran focused verification:
  - `pnpm exec vitest run apps/cloudflare/test/runner-egress-intercept.test.ts --config apps/cloudflare/vitest.node.workspace.ts --no-coverage -t "OpenAI|Mapbox|Linq|Telegram|WhatsApp"` passed.
  - `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/test/runner-egress-intercept.test.ts` passed.

## Now

- Close the active plan with a scoped commit.

## Next

- None.

## Open questions

- None.

## Working set

- `apps/cloudflare/src/runner-egress-intercept.ts`
- `apps/cloudflare/test/runner-egress-intercept.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-05-12-openai-mapbox-unfenced-egress.md`
Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
