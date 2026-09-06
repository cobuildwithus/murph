---
title: 'Hosted-local OAuth start compares the callback host with the reverse-proxy upstream host'
severity: 'minor'
issue: 'cobuildwithus/murph#2728'
---

## Expected Behavior

A hosted-local browser request through the public HTTPS proxy should compare the device OAuth callback with the browser-facing host.

## Current Behavior

The OAuth start path uses the server request URL. Behind the local reverse proxy, that URL contains the internal localhost upstream. The callback uses the public local host, so every new hosted-local project rejects the connection.

## Possible Solution

After the mutation-origin check succeeds, use the validated browser Origin for the callback hostname comparison. Keep the request URL as the fallback for requests without Origin.

## Minimal Reproducible Example

Send an authenticated OAuth start request to an internal localhost URL with `Origin: https://local.withmurph.ai:3443`. Configure the callback base URL with the same public origin. The start must succeed.

## Context

This blocks local device connection checks and can look like a bad provider configuration.
