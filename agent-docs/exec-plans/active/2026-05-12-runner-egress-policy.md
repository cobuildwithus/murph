# Runner Egress Policy

## Goal

Make hosted runner egress policy explicit by moving known default provider and internal virtual-host routes onto Cloudflare Container `outboundByHost`, while preserving the current arbitrary internet access requirement through a named open-internet passthrough policy.

Success criteria:

- `RunnerContainer` uses `static outboundByHost` for default OpenAI, Mapbox, Linq, Telegram, WhatsApp, and internal virtual-host handlers.
- The catch-all `outbound` handler remains enabled for arbitrary internet egress, but is named/documented as open internet passthrough rather than temporary migration behavior.
- Runtime-configured provider base URL overrides still receive Worker credential injection/policy through the catch-all path.
- Focused Cloudflare runner egress tests cover the policy split.

## Constraints

- Preserve arbitrary internet egress for now.
- Do not introduce `allowedHosts` or `enableInternet = false` in this change.
- Preserve existing dirty hosted runner edits and active overlapping hosted-runner work.
- Keep Worker-owned credential injection and runtime write-fence checks unchanged for provider credential injection.

## Plan

1. Add named per-host outbound handlers for known internal/default provider hosts.
2. Keep the catch-all handler for configured provider override hosts and open internet passthrough.
3. Wire `RunnerContainer.outboundByHost` to the known host map.
4. Update focused tests for the static mapping and explicit passthrough policy.
5. Run focused Cloudflare verification and required completion audits.

## Verification

- Pending: focused runner egress tests.
- Pending: Cloudflare app verification or truthful narrower lane.
