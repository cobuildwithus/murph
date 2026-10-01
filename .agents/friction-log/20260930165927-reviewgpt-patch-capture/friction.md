---
title: 'ReviewGPT patch capture omits downloadable artifact controls'
severity: 'minor'
issue: 'cobuildwithus/murph#3937'
---

## Expected Behavior

The pinned ReviewGPT tool should preserve the assistant-owned patch attachment in a completed waited response and download it from that exact capture.

## Current Behavior

A completed authoring response advertises a patch and checksum, but its capture metadata contains an empty artifact list. Exact-capture export cannot resolve the assistant identity after reload. An ordinary export still finds the single expected user turn and assistant response, but exposes no attachment buttons. The legacy label-based download path also fails. This blocks applying the externally authored patch through the repository completion workflow.

## Minimal Reproducible Example

With the repository-pinned ReviewGPT 0.5.151 and managed browser configuration, request a synthetic unified patch as a downloadable attachment using a waited send. Inspect the resulting capture artifact list, attempt exact-metadata export and download, and compare with an ordinary export of the same conversation. Preserve accepted-turn identity; do not replace capture metadata or resend the implementation request.

## Context

Repository-edit work requires ReviewGPT-authored implementation. A separate delivery-only request for the identical patch as text is needed when the download controls cannot be recovered. Investigate current rendered assistant identity aliases and attachment link shapes in the dependency integration. Keep private conversations and machine paths out of fixtures and reports.
