---
title: 'No repo lane renders an opengraph-image route to a PNG for visual verification'
severity: 'minor'
issue: 'cobuildwithus/murph#1903'
---

Verifying an OG card visually requires a hand-rolled harness: import the route module from a scratch tsx script, work around the classic JSX transform (tsconfig jsx: preserve makes tsx emit React.createElement, so the script must set globalThis.React), and write the ImageResponse body to disk. Each session reinvents this.

Repository-actionable shape: a small script (for example scripts/render-og-image.ts <route-dir> <out.png>) that loads an app/**/opengraph-image.tsx default export and writes the PNG, so design iteration and PR proof captures are one command.
