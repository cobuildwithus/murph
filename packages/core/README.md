# `@murphai/core`

Workspace-private canonical mutation owner for vault initialization, filesystem primitives, audit emission, domain mutation APIs, and current-format vault validation. No other package may mutate canonical vault data directly.

Device imports reuse their prepared persistence plan under the canonical lock
when delivery history inspection is unchanged. Expanding a bounded
inspection to full history still rebuilds the plan before publication, preserving
exact-delivery replay and evidence-repair checks.

See [the Docker CPU benchmark](bench/README.md) for synthetic import profiling
and one-/two-vCPU comparisons without production credentials.
