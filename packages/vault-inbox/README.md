# @murphai/vault-inbox

Workspace-private vault, inbox, and shared usecase surface for Murph.

This package owns the still-diverged vault service assembly, inbox service assembly, inbox app/runtime orchestration, and higher-level vault/inbox seams used by the operator surface. Shared leaf helpers that remain byte-identical now re-export directly from `@murphai/assistant-engine` so only the local ownership hotspots stay here.
