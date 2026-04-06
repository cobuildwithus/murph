# Repo Scope

Last verified: 2026-04-06

## Current Scope

- `murph` is the canonical Murph product monorepo.
- It owns the local operator product (`murph` / `vault-cli`, vault, daemons, parser and query layers) plus the hosted web and hosted execution surfaces.
- Use this repo for Murph runtime code, product docs, operational docs, tests, and deploy helpers that describe the current system.

## Routing Rule

If a task clearly belongs to another established repo (`interface`, `v1-core`, `wire`, `chat-api`, `cli`, `indexer`), do not place it here just because this repo is new.

## Out Of Scope

- Do not add speculative cross-repo placeholders or bootstrap-era scaffolding docs here.
- If a new subsystem is not part of Murph's current local or hosted product, document that boundary before landing code.
