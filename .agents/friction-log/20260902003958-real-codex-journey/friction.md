---
title: 'Real-Codex journey cannot collect after duplicate group tool import'
severity: 'minor'
issue: 'cobuildwithus/murph#2733'
---

The focused live assistant runner fails during Vitest collection because assistant-codex-real-e2e.test.ts imports MURPH_GROUP_DATA_TOOL from both dynamic-tools.ts and dynamic-tool-catalog.ts. This blocks every focused real-Codex journey before model execution. Remove the duplicate catalog import and keep the existing public dynamic-tools import.
