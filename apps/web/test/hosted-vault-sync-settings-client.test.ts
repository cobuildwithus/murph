import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { HostedVaultSyncSettingsClient } from "../src/components/settings/hosted-vault-sync-settings-client";

test("HostedVaultSyncSettingsClient renders the compact local vault sync card copy", () => {
  const markup = renderToStaticMarkup(
    createElement(HostedVaultSyncSettingsClient, {
      authenticated: true,
      initialError: null,
      initialSessions: [],
    }),
  );

  assert.match(markup, /Sync local vault/);
  assert.match(markup, /Local-to-hosted import/);
  assert.match(markup, /Adds missing local records while preserving hosted data\./);
  assert.match(markup, /Start sync/);
  assert.doesNotMatch(markup, /Upload your local Murph vault/);
  assert.doesNotMatch(markup, /not committed as a replacement snapshot/);
});
