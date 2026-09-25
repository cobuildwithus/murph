---
title: 'Public main merges cancel production candidate verification'
severity: 'minor'
---

## Expected Behavior

An immutable production candidate can finish required proof while later changes
merge. Proof remains bound to the exact tested source and live compatibility.

## Current Behavior

Required workflows share a branch concurrency group with cancellation enabled.
Web admission separately requires public main to equal the candidate throughout
proof. Private release planning also chooses the moving main tip for checkout.

## Minimal Reproducible Example

Start release proof for commit A on main. Merge descendant B before A finishes.
A loses its required checks and cannot complete admission even when its own
source and the deployed readers are unchanged.

## Context

Keep merge throughput independent of active production candidate verification.
Use immutable source identity and existing workflow/deployment owners.
