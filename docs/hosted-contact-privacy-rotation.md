# Hosted Contact-Privacy Rotation

Last verified: 2026-04-07

## Goal

Hosted blind indexes must be rotatable before production without widening raw-identifier storage in Postgres or freezing one HMAC key forever.

## Long-Term Model

- `apps/web` owns the authoritative encrypted raw values for lookup-backed hosted-member identifiers.
- Postgres stores one canonical blind lookup key per field, not parallel `current` and `previous` columns.
- Contact-privacy writes always use one `current` key version.
- Contact-privacy reads derive candidates for every configured version in `HOSTED_CONTACT_PRIVACY_KEYS`, ordered with `HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION` first.
- Rotation is an in-place backfill of canonical lookup-key columns, not a permanent dual-write architecture.

This keeps the steady state simple:

- one encrypted owner-table source of truth
- one canonical lookup key in Postgres
- one current write version
- a temporary multi-version read window only during rotation

## Required Envs

- `HOSTED_CONTACT_PRIVACY_KEYS`
  Format: comma-separated `version:base64key` entries such as `v1:...,v2:...`
- `HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION`
  Required when the keyring contains more than one version

## Backfill Scope

The rotation backfill rewrites the canonical lookup-key columns that can be re-derived from encrypted owner-table values:

- `HostedMemberIdentity.phoneLookupKey`
- `HostedMemberIdentity.privyUserLookupKey`
- `HostedMemberIdentity.walletAddressLookupKey`
- `HostedMemberRouting.linqChatLookupKey`
- `HostedMemberRouting.telegramUserLookupKey`
- `HostedMemberBillingRef.stripeCustomerLookupKey`
- `HostedMemberBillingRef.stripeSubscriptionLookupKey`

The same pass also fills any missing encrypted owner-table source fields now required for future re-derivation, such as the canonical encrypted hosted phone number and Telegram user id.

## Cutover Playbook

1. Add the new versioned key to `HOSTED_CONTACT_PRIVACY_KEYS` and set `HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION` to the new version.
2. Pause hosted onboarding/webhook traffic or otherwise hold the system in a state where new lookup-bearing events are not being generated.
3. Drain lookup-bearing hosted execution outbox rows for `member.activated` and `linq.message.received`.
4. Run `pnpm --dir apps/web contact-privacy:backfill` first and inspect the dry-run JSON.
5. Resolve any blockers. A blocker means a stored lookup key exists but the encrypted owner-table raw value needed to re-derive it is missing.
6. Run `pnpm --dir apps/web contact-privacy:backfill --write`.
7. Re-run the dry-run and confirm it reports zero pending rewrites and zero blockers.
8. Resume hosted traffic.
9. After the old version has been fully backfilled and no runtime still depends on it, remove the old version from `HOSTED_CONTACT_PRIVACY_KEYS`.

## Why Queue Drain Is Required

`member.activated` and `linq.message.received` use reference-only hosted execution payload storage. During the dual-read window, database lookups can tolerate old keys, but queued staged payload refs may still point at older lookup identities. Draining those events before write-mode backfill keeps the rotation story deterministic and avoids a second payload-rewrite system.
