# Repo

Last verified: 2026-04-06

## Current State

- This repository is Murph's canonical monorepo.
- `README.md`, `ARCHITECTURE.md`, and `docs/architecture.md` describe the live system rather than a planned scaffold.
- The hosted web schema currently uses an incremental Prisma migration chain rooted at the current baseline; a one-shot reset is future cleanup, not current repo truth.
- Historical architecture reviews, migration guides, and legacy-removal audits do not belong in the live repo surface.

## Success Criteria

1. The top-level architecture docs name the current local, hosted web, and hosted execution boundaries accurately.
2. Agent-facing docs route engineers to current canonical docs instead of bootstrap or historical snapshots.
3. Verification docs describe the commands that actually gate work in this repo today.
4. The hosted Prisma migration docs and tests agree on the current intentional migration chain until a future reset is explicitly landed.
5. New work extends the current canonical design directly instead of reintroducing compatibility-era framing.
