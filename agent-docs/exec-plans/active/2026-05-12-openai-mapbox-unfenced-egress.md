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

Active.

## Done

- Confirmed current OpenAI and Mapbox intercept paths require `requestOwnsRuntimeWriteFence`.
- Confirmed focused tests currently expect 401 for unfenced OpenAI and Mapbox sentinel requests.

## Now

- Remove OpenAI and Mapbox write-fence checks.
- Update focused tests to cover unfenced injection.

## Next

- Run focused Cloudflare egress verification and scoped diff verification.
- Run required completion audits, then close with a scoped commit if safe.

## Open questions

- None.

## Working set

- `apps/cloudflare/src/runner-egress-intercept.ts`
- `apps/cloudflare/test/runner-egress-intercept.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-05-12-openai-mapbox-unfenced-egress.md`
