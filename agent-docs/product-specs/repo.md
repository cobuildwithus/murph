# Repo

Last verified: 2026-04-23

## Current State

- This repository is Murph's canonical monorepo.
- `README.md`, `ARCHITECTURE.md`, and `docs/architecture.md` describe the live system rather than a planned scaffold.
- Historical architecture reviews, migration guides, and legacy-removal audits do not belong in canonical live docs unless they are explicitly retained as historical context.
- Current external compatibility references, including the device-provider compatibility matrix, remain part of the live repo surface when they describe active provider requirements rather than internal migration paths.

## Success Criteria

1. The top-level architecture docs name the current local, hosted web, and hosted execution boundaries accurately.
2. Agent-facing docs route engineers to current canonical docs instead of bootstrap or historical snapshots.
3. Verification docs describe the commands that actually gate work in this repo today.
4. Internal greenfield-v1 docs describe the current baseline directly instead of keeping migration-era compatibility instructions live.
5. New work extends the current canonical design directly instead of reintroducing compatibility-era framing.
