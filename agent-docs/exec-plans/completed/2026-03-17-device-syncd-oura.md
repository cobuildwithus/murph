# Device syncd Oura integration

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Add Oura as a first-class Healthy Bob wearable provider with a connect-once OAuth flow, background auto-sync, and importer normalization that fits the existing WHOOP/device-sync seams.
- Generalize provider registration and device-sync provider capabilities so polling-first providers do not need webhook plumbing to work.

## Success criteria

- `@healthybob/importers` normalizes Oura snapshots through the shared device-provider registry with Oura registered by default.
- `@healthybob/device-syncd` can load Oura from env config, exchange OAuth codes, rotate refresh tokens, and import Oura snapshots on backfill/reconcile jobs.
- End users can follow a connect-once, auto-sync path for Oura without webhook setup.
- WHOOP behavior stays intact while provider descriptors/configuration become reusable for future providers.
- Focused tests cover Oura normalization plus the new device-sync capability/config behavior.

## Scope

- In scope:
  - new Oura importer adapter and device-sync provider
  - default wearable-provider registration cleanup in importer/device-sync layers
  - polling-first Oura auto-sync implementation using OAuth refresh tokens
  - docs for the updated multi-provider wearable architecture and Oura env/config
- Out of scope:
  - Oura webhook subscription automation and verification handshakes
  - unrelated assistant/web/runtime work outside the ledgered files

## Constraints

- Preserve the current WHOOP integration and do not regress provider-independent device-sync behavior.
- Do not require webhook setup for Oura's basic auto-sync path.
- Keep secrets, tokens, and runtime state outside the vault and continue importing snapshots through `@healthybob/importers`.
- Do not touch `.env*`.

## Tasks

1. Compare the supplied patch series against current importer/device-syncd state and merge any drift cleanly.
2. Add Oura snapshot normalization plus reusable default device-provider registration in `packages/importers`.
3. Add Oura provider/config/service support in `packages/device-syncd`, including optional webhooks and callback scope preservation.
4. Update focused tests and architecture/runtime docs, then run required verification plus completion audits.
Completed: 2026-03-17
