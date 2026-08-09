# Generated Murph contact card

Status: completed
Updated: 2026-08-09
Completed: 2026-08-08

## Goal

Let a member explicitly ask Murph in a personal iMessage conversation for a new contact photo, generate a square image with the existing image pipeline, and receive a saveable `.vcf` containing that image and the current Murph line.

## Product behavior

- This is a one-shot contact-card send, not a persistent Murph profile setting.
- The personalized path requires fresh direct user input and an exact direct iMessage route.
- Murph generates a medium-quality square JPEG with `output_compression: 40` to reduce payload size against the existing vCard-photo envelope, durably captures it, publishes it through the existing short-lived private-image path, requires that photo to load, embeds it in the first-party vCard, and sends the vCard through the existing Linq attachment path.
- An unsupported route (direct SMS, or a missing or ambiguous direct route) is refused before any generation, capture, or publication work, so the member never waits out a slow tool for a card that could never be delivered.
- Personalized sends write no wall-clock reservation. They use the trusted accepted-request identity as the provider idempotency key, so a replay of one request collapses while a distinct request sends immediately; canonical shares alone retain the existing durable reservation.
- The operation-scope Linq delivery-context producer carries the event's real `threadIsDirect` value instead of admitting group threads only, which is what makes the direct route reachable at all. Group resolvers select `false` and the direct resolver selects `true`, so neither reads the other's route.
- The model chooses only the picture description. Photo quality and alt text are not member-visible choices, so the tool schema does not expose them.
- Contact-card images and group-chat avatars use distinct generated-capture namespaces even when a provider retry reuses the same RPC call id.
- iOS still owns whether the member saves or updates the contact.
- Existing canonical group contact-card sharing remains owner-only and unchanged.

## Trust boundaries

- The model never supplies route authority or a raw delivery target.
- Runtime and Web both validate the private image URL before Web fetches it.
- Direct and group Linq routes are resolved separately and fail closed when authority is missing or ambiguous; direct SMS rejects attachment delivery explicitly.
- The assistant can claim completion only after Web/Linq reports `sent`, or `already_shared` when Linq's exact same-key conflict proves that accepted request already reached the chat. An unresolved acknowledgement is reported as `unconfirmed`.

## Verification

- Focused package suites covering compact image request construction, generation, capture-scope isolation, private publication, parser validation, exact direct-route binding, SMS rejection, ambiguous-route refusal, and fresh-direct rejection.
- Focused Web suites covering exact canonical/personalized request shapes, authorization-path isolation, private URL validation, required-photo composition, stable per-request idempotency, timeout composition, and Linq attachment delivery.
- `pnpm typecheck:packages`.

## Deployment

Deploy Web first, then the Cloudflare/runner bundle. New Web remains compatible with canonical contact-card requests, while the new runtime may send `contactCardImageUrl`. Smoke-test one explicit generated contact-card request in a direct iMessage thread after both deploys.
