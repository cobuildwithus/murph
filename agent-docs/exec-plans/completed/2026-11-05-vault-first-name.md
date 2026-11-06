# Vault first-name persistence

Status: completed
Created: 2026-11-05
Updated: 2026-11-06

## Outcome

A member whose vault already holds a usable first name is no longer asked for it
in the app. A name saved in the app also reaches the vault. The app needs no
change: it shows name entry only when Home returns a null `me.firstName`.

## Design

The app store and the vault are separate, and the game never read the vault.
Demographics already works in both directions, so this reuses its seams: a
replica field for reads and a member action for writes. No new tables, columns,
routes, dispatch events, flags or backfill.

1. Runtime: optional `displayName` on the replica and core shard, sourced from
   `readProjectableProfileName`, plus a `display-name.set` member action. The
   digest segment forces a rebuild on the next refresh; generation stays 18.
2. Web: `adoptVaultGameProfile` creates a missing profile only. It rechecks the
   session and member authority inside its transaction and never overwrites a
   raced app save. A member with a profile never reaches the replica.
3. Native login runs that adoption after `otp/verify` commits, so the read sits
   under the login loading state instead of Home's blank screen. Home keeps a
   1.5-second lookup as the fallback for members already signed in.

## Decisions

- Silent, not prefilled: with a usable name there is no name screen at all.
- Adoption takes a single word only, and never guesses from a longer name.
- Reading at `otp/send` was rejected. The Worker keeps nothing per person, so
  warming it saves nothing, and saving a profile before the code is proven would
  be visible to other players' game setup.
- The login step has one 2.5-second deadline covering the game code load. A
  synchronous replica parse can finish past it, by about 80 ms for a 6.4 MB core
  in review's reproduction; the largest production core is 3.3 MB stored.
- Declined after review, as disproportionate: ordering for two renames in the
  same moment, retry state after a failed vault write, and a replay receipt. A
  new key in the strict memory frontmatter would stop older runtimes reading
  memory after a rollback.

## Rollout

The runtime consumer ships and deploys first; the Web producer follows. A replica
without the field is a miss, which shows today's name screen. Keep the consumer
while accepted actions can remain queued or restored.
Completed: 2026-11-06
