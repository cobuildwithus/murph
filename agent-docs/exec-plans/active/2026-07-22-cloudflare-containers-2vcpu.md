# Upgrade Cloudflare containers to 2 vCPU

Status: active
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Make the checked-in Cloudflare runner and deploy defaults provision every
  hosted runner and deploy-smoke container with 2 vCPU.
- Preserve the existing single sizing owner, generated deploy path, rollout
  controls, and environment override behavior.

## Success criteria

- The deploy automation default and checked-in Wrangler scaffold use a valid
  2-vCPU custom instance shape.
- The protected Cloudflare deploy workflow, focused config-contract tests, and
  deploy documentation stay aligned with that default.
- Focused verification, full acceptance, preliminary specialist review,
  parent final review, CI, and final ReviewGPT pass for the exact PR head.

## Scope

- Cloudflare container sizing defaults in deploy automation and the checked-in
  Wrangler scaffold.
- The protected deploy workflow fallback, focused alignment tests, and current
  Cloudflare deploy documentation.

## Constraints

- Use Cloudflare's native custom `instance_type` configuration; add no new
  service, state owner, or dependency.
- Keep the minimum valid memory and disk allocation for the requested 2-vCPU
  shape: 6 GiB memory and 12 GB disk.
- Do not deploy from this branch or mutate production environment variables.
- Require an immediate container rollout when the merged change is deployed so
  warm one-vCPU containers do not remain active during a gradual rollout.

## Tasks

1. Update the one deploy default and every checked-in alignment surface from
   1 vCPU / 3 GiB / 6 GB to 2 vCPU / 6 GiB / 12 GB.
2. Run the focused Cloudflare deploy-automation and container-contract proof.
3. Run the required canonical verification and review gates.
4. Commit, push, open the draft PR, and complete the exact-head PR gates.

## Evidence

- Cloudflare's current Containers limits document permits custom instance
  types from 1 to 4 vCPU with at least 3 GiB memory per vCPU and at most 2 GB
  disk per GiB memory.
- The selected `{ vcpu: 2, memory_mib: 6144, disk_mb: 12000 }` shape is the
  smallest valid custom configuration that preserves the current resource
  ratios while doubling CPU.
- The current production GitHub environment has an explicit one-vCPU override;
  deployment must update that variable after merge because repository changes
  alone do not override environment configuration.
