# Linq group icon observability

## Goal

Make asynchronous Linq group-icon mutations diagnosable from Murph-owned
observability after the provider accepts the initial request.

Success means:

- accepted avatar requests emit a privacy-minimized structured timing record;
- `chat.group_icon_updated` and `chat.group_icon_update_failed` webhooks are
  durably recorded in the existing provider-event ledger;
- failure records retain only the allowlisted provider code and opaque
  correlation metadata, never icon URLs, handles, or raw webhook content; and
- focused tests prove parsing, persistence routing, and logging behavior.

## Constraints

- Preserve the existing Linq request, webhook, and provider-event owners.
- Do not add a queue, polling loop, schema, or second lifecycle owner.
- Treat provider image URLs as private capabilities that must not enter logs or
  durable diagnostic payloads.
- Preserve unrelated work in the primary checkout.

## Approach

1. Admit the two documented group-icon outcome events into the existing
   privacy-minimized provider-event parser.
2. Normalize their chat correlation, terminal status, provider timestamp, and
   numeric failure code without retaining icon values or actor handles.
3. Emit matching metadata-only request and webhook timing details.
4. Add focused parser, webhook-routing, and request-logging tests.
5. Document the operational and privacy contract, then run the PR completion
   workflow.

## State

Implementation, focused local proof, and the exact-head PR review are complete.
The preliminary coverage/privacy pass found that the generic event
builder could still derive health projections and admit nonnumeric failure
codes; the accepted narrow parser-boundary correction and unrelated-event
telemetry regression coverage are complete and locally verified. Final review
round 2 found that transport exceptions were labeled as confirmed request
failures even though the provider may already have accepted the PUT; the
accepted correction records that state as request-unconfirmed without retrying.
Final review round 3 found that the neutral label also covered completed HTTP
rejections. The accepted three-way classification now records an accepted
response, a structured HTTP rejection, or an ambiguous transport outcome.
Final review round 4 passed the full corrected snapshot with no qualifying
findings. Exact-head CI passed the host matrices, build/typecheck, app
verification, fixture coverage, hygiene, viewport, and design-proof checks.
Its two package-coverage shards are blocked by deterministic pre-existing
failures on unchanged assistant-runtime and CLI routing tests; the same broad
workflow is failing on `main`, and focused local reproduction confirms those
failures do not exercise this plan's Linq request or webhook paths.
Status: completed
Updated: 2026-08-06
Completed: 2026-08-06
