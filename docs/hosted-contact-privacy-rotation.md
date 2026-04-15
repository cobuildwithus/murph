# Hosted Contact-Privacy Rotation

Last verified: 2026-04-09

## Goal

Hosted blind indexes keep a future rotation seam without widening raw-identifier storage in Postgres or carrying prelaunch cutover tooling in the current launch posture.

## Current Model

- `apps/web` owns the authoritative encrypted raw values for lookup-backed hosted-member identifiers.
- Postgres stores one canonical blind lookup key per field, not parallel `current` and `previous` columns.
- Contact-privacy writes always use one `current` key version.
- Contact-privacy reads derive candidates for every configured version in `HOSTED_CONTACT_PRIVACY_KEYS`, ordered with `HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION` first.
- The current repo intentionally does not ship an active backfill script or cutover runbook for prelaunch rotation.

This keeps the steady state simple:

- one encrypted owner-table source of truth
- one canonical lookup key in Postgres
- one current write version
- one multi-version read seam available when future rotation work is actually needed

## Required Envs

- `HOSTED_CONTACT_PRIVACY_KEYS`
  Format: comma-separated `version:base64key` entries such as `v1:...,v2:...`
- `HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION`
  Required when the keyring contains more than one version

## Future Rotation Coverage

The encrypted owner-table fields already preserve the raw values needed to re-derive these canonical lookup-key columns in a future rotation-specific migration:

- `HostedMemberIdentity.phoneLookupKey`
- `HostedMemberIdentity.privyUserLookupKey`
- `HostedMemberIdentity.walletAddressLookupKey`
- `HostedMemberRouting.linqChatLookupKey`
- `HostedMemberRouting.telegramUserLookupKey`
- `HostedMemberBillingRef.stripeCustomerLookupKey`
- `HostedMemberBillingRef.stripeSubscriptionLookupKey`

## Current Guidance

- Treat `HOSTED_CONTACT_PRIVACY_KEYS` plus `HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION` as the durable seam that preserves future rotation options.
- Do not add parallel lookup columns, permanent dual-write logic, or deploy-history backfill commands just to keep the option open.
- If a real deployed rotation is needed later, design a targeted procedure against the then-current runtime behavior, queue semantics, and stored data shape instead of reviving the removed prelaunch campaign tooling unchanged.
