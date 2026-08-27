---
title: 'Code Mode timeout yields hide reply-critical cell lifecycle'
severity: 'major'
target: 'openai/codex'
---

## Friction

A Code Mode cell that yields because its execution timeout elapsed is returned as a successful tool output while the cell remains live. The yield reason and live-cell completion requirement are not visible to App Server consumers.

## Impact

A downstream assistant runtime cannot distinguish an automatically yielded reply-critical cell from an intentionally backgrounded cell. It can either accept a premature final answer or add brittle status-text parsing and shadow lifecycle state.

## Workaround

Trace the native Code Mode runtime and enforce completion in Codex itself. Do not parse the rendered `Script running with cell ID ...` string in the downstream runtime.

## Suggested improvement

Carry an internal timeout-versus-explicit yield reason through Code Mode and suppress final-answer delivery only while automatically yielded cells remain nonterminal. Preserve explicit `yield_control()` as background-capable.
