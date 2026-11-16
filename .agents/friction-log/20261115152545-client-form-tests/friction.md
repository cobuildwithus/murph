---
title: 'Client form tests need an input event adapter for controlled inputs'
severity: 'minor'
issue: 'cobuildwithus/murph#5047'
---

## Expected Behavior

A client component rendered with renderClientComponent should receive a React onChange when a test sets an input value and dispatches a bubbling input event.

## Current Behavior

The happy-dom harness leaves controlled input state unchanged. A subsequent form submission uses the empty initial value. Several Ops tests work around this by replacing the shared Input component with an onInput-to-onChange adapter, so new form tests must rediscover and duplicate the adapter.

## Possible Solution

Provide a supported input helper in the client test harness, or initialize React event support after installing the DOM, so tests exercise the real shared Input component consistently.

## Minimal Reproducible Example

Render BlockedNumbers with renderClientComponent. Set the input value to synthetic@example.invalid, dispatch a bubbling input event, then submit the form. Without the Input mock in ops-blocked-numbers.test.tsx, the request contains an empty contact. The existing ops-member-email-client.test.tsx uses the same adapter.

## Context

This blocked a focused Ops block-list form test. The task uses the existing test-only adapter; production input behavior is unchanged.
