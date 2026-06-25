# Retell post-call analysis fields

Configure these fields on the published Retell agent version. Murph stores the final analysis result,
not the raw transcript.

Subscribe the Retell webhook to `call_ended` and `call_analyzed` only, pointing at
`/api/retell/webhook`. Murph verifies the raw `X-Retell-Signature`, updates the existing
`HostedPhoneCall` row idempotently, and runs result handling only once when analysis first lands.

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
    relevant policies.

follow_up
  Type: Text
  Description:
    State the exact question or action required from the user. Return an empty string if nothing is
    required.
```

Privacy baseline: Retell stores basic attributes only; Murph stores the call brief and final result.
Do not persist raw Retell transcripts, webhook bodies, function bodies, recordings, or audio in
Murph.
