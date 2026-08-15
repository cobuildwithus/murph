# Hosted Contact-Privacy Rotation

Last verified: 2026-08-11

## Goal

Hosted blind indexes keep a future rotation seam without widening raw-identifier storage in Postgres, carrying prelaunch cutover tooling, or allowing configured key history to create unbounded read and lock fanout.

## Current Model

- `apps/web` owns the authoritative encrypted raw values for lookup-backed hosted-member identifiers.
- Postgres stores one canonical blind lookup key per field, not parallel `current` and `previous` columns.
- Contact-privacy writes always use one `current` key version.
- Contact-privacy configuration accepts at most two keys: `HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION` first for reads, followed by one configured lower prior version. Extra historical keys and staged future versions fail closed at startup.
- The current repo intentionally does not ship an active backfill script or cutover runbook for prelaunch rotation.

This keeps the steady state simple:

- one encrypted owner-table source of truth
- one canonical lookup key in Postgres
- one current write version
- one bounded current-plus-prior read seam when rotation is actually needed
- write-time conflict checks across the same bounded read-candidate set before a Telegram, Linq, reply-alias, or Stripe binding moves to a different member
- fail-closed read behavior when that candidate set resolves to more than one member instead of choosing an arbitrary row

## Required Envs

- `HOSTED_CONTACT_PRIVACY_KEYS`
  Format: comma-separated `version:base64key` entries such as `v1:...,v2:...`
- `HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION`
  Required when the keyring contains more than one version

Do not stage future or extra historical versions in the runtime keyring. Rotate with exactly the new current key and, while migration is incomplete, one lower prior key; remove the prior key after re-derivation and verification.

## Future Rotation Coverage

The encrypted owner-table fields already preserve the raw values needed to re-derive these canonical lookup-key columns in a future rotation-specific migration:

- `HostedMemberIdentity.phoneLookupKey`
- `HostedMemberIdentity.privyUserLookupKey`
- `HostedMemberIdentity.walletAddressLookupKey`
- `HostedMemberRouting.linqChatLookupKey`
- `HostedMemberRouting.linqRecipientPhoneLookupKey`
- `HostedMemberRouting.pendingLinqChatLookupKey`
- `HostedMemberRouting.pendingLinqRecipientPhoneLookupKey`
- `HostedMemberRouting.pendingLinqParticipantContactLookupKey`
- `HostedMemberRouting.replyAliasLookupKey`
- `HostedMemberRouting.telegramUserLookupKey`
- `HostedMemberBillingRef.stripeCustomerLookupKey`
- `HostedMemberBillingRef.stripeSubscriptionLookupKey`
- `HostedGroupDisclosurePermission.permissionDigest`, re-derived from the
  group-owned encrypted permission text and owning group id

## Current Guidance

- Treat `HOSTED_CONTACT_PRIVACY_KEYS` plus `HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION` as the durable seam that preserves future rotation options.
- Keep the lookup-key storage model at one canonical stored key per field. During one rotation, writes and conflict checks scan only current plus one prior so a legacy key cannot silently coexist on another member without making runtime work depend on keyring history.
- Serialize Telegram, Linq, reply-alias, and Stripe rebinds with a transaction-scoped advisory lock whose conflict token stays stable across current-version flips for the same raw external identity; candidate scans alone are not sufficient to prevent mixed-version write races.
- If current-plus-prior reads find more than one member for the same Telegram, Linq, reply-alias, or Stripe raw identifier, fail closed and repair the duplicate binding instead of ordering or `findFirst` heuristics.
- Complete re-derivation of every persisted prior-version lookup before advancing current a second time. Runtime does not provide a multi-generation compatibility bridge, and an identifier left on an older version intentionally fails closed once it falls outside current plus prior.
- Do not add parallel lookup columns, permanent dual-write logic, or deploy-history backfill commands just to keep the option open.
- For group-disclosure permission digests, preserve the prior version through the ten-minute in-flight Assistant Ask drain, run targeted re-derivation from the group-owned encrypted permission text, and verify that no prior-version digests remain before the next current-version advance. Request ids and provider idempotency keys do not depend on the rotating digest.
- If a real deployed rotation is needed later, design a targeted procedure against the then-current runtime behavior, queue semantics, and stored data shape instead of reviving the removed prelaunch campaign tooling unchanged.
