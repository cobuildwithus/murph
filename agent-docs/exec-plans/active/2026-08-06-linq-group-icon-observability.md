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

Implementation and focused local proof complete. Exact-head PR review and CI in
progress. The preliminary coverage/privacy pass found that the generic event
builder could still derive health projections and admit nonnumeric failure
codes; the accepted narrow parser-boundary correction and unrelated-event
telemetry regression coverage are complete and locally verified. Final review
round 2 found that transport exceptions were labeled as confirmed request
failures even though the provider may already have accepted the PUT; the
accepted correction records that state as request-unconfirmed without retrying.
