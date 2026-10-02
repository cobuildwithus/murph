# Classify rejected SMS sign-in destinations

## Outcome

An explicit SMS-provider rejection of an international-format destination asks the member to check the number and country code instead of reporting a service outage.

## Owner and scope

The existing Twilio Verify failure parser and shared hosted-auth JSON error response own this correction. Preserve successful sends, verification checks, provider outages, rate limits, fraud controls, and private-value redaction. No new dependency, state, network call, retry, or native app change.

## Product UX

- Outcome: correct the existing invalid-number recovery message.
- Reaches: browser and native SMS sign-in through the shared transport.
- Proof: provider-shaped synthetic HTTP responses through the real transport and JSON error mapper; successful and unavailable paths remain covered.

## Implementation

Recognize the provider's quoted `To` label only when followed by an E.164-shaped destination. Keep the existing exact labels and observation-only hints for other formats. Discard the destination before logs or public responses. Update the owner documentation and a narrow release note.

## Verification and delivery

Focused transport, companion-route and changelog-rendering tests passed (183 tests). Web typecheck and the complexity guard passed; the changed parser remains at complexity 20 with no added debt. Parent diff/privacy review passed. Final ReviewGPT and exact-head CI remain pending. Delivery requires the normal reviewed Web deployment. Production SMS delivery to a valid destination remains a separate user-triggered check; synthetic tests do not prove receipt.
