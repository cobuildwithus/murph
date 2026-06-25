# Retell post-call analysis fields

Configure these fields on the published Retell agent version. Murph stores the final analysis result,
not the raw transcript.

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
Do not persist raw Retell transcripts in Murph.
