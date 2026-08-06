# Retell post-call analysis fields

Configure these fields on the published Retell agent version. Murph stores the final analysis result,
not the raw transcript.

Subscribe the Retell webhook to `call_ended`, `call_analyzed`, and
`transfer_ended` only, pointing at
`/api/retell/webhook`. Murph verifies the raw `X-Retell-Signature` and updates the existing
`HostedPhoneCall` row idempotently. For an ordinary call, `call_analyzed` is the
result boundary. When Retell reports `call_transfer`, that analysis describes
only the automated leg, so Murph defers result persistence and notification
until the human transfer leg ends. `transfer_ended` then becomes the result
boundary: Murph records that the handoff connected while keeping the
post-handoff outcome explicitly unknown and asks the member what happened. A
cancelled or failed transfer remains on ordinary `call_analyzed` handling; only
a successful transfer with a completed human leg is deferred.

Signed terminal callbacks also record Retell's provider-reported aggregate call
cost in the web-owned included-usage ledger. A `call_transfer` observation stays
pending until `transfer_ended` so the immutable usage row includes transfer-leg
cost. The pre-armed reconciliation workflow retrieves terminal usage when the
callbacks do not arrive.
For local development, `RETELL_WEBHOOK_PUBLIC_BASE_URL` may point individual created calls at
the local public tunnel without changing the published agent or workspace webhook configuration.

```text
outcome
  Type: Selector
  Values:
    - completed
    - not_completed
    - needs_user

result
  Type: Text
  Description:
    State the exact final outcome. Include all confirmed dates, times, locations, business names,
    provider names, prices, pickup details, confirmation codes, preparation instructions, and
    relevant policies. For a transferred call, this field describes only the automated leg before
    handoff; Murph will not treat it as proof of what the member and recipient agreed afterward.

follow_up
  Type: Text
  Description:
    State the exact question or action required from the user. Return an empty string if nothing is
    required.
```

Privacy baseline: Retell stores basic attributes only; Murph stores the call brief and final result.
For usage, Murph stores only the bounded aggregate cost and duration. Do not
persist raw Retell transcripts, webhook bodies, function bodies, recordings,
audio, transfer destinations, or product-level cost labels in Murph.
