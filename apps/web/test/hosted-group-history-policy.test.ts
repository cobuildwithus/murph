import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildHostedVaultShareProjectionScopeKey as key, type HostedVaultShareProjectionScope } from "@murphai/hosted-execution/vault-share";
import {
  HOSTED_GROUP_JOIN_POLICY_SCHEMA,
  projectHostedVaultShareProjectionDisplays,
  readHostedGroupJoinPolicy,
  resolveHostedGroupAccessOfferProjectionScopes,
} from "../src/lib/hosted-groups/join-policy";
import { groupJoinPermissionsForDisplay } from "../src/components/hosted-groups/group-join-permission-groups";
import { readHostedVaultShareSupportedProjectionScopeKeysFromRequest } from "../src/lib/hosted-vault-share/supported-projection-scopes";

const sleep: HostedVaultShareProjectionScope = { projectionKind: "sleep-times.v0" };
const email: HostedVaultShareProjectionScope = { projectionKind: "group-email.v0" };

describe("plain-grant group history surfaces", () => {
  it("preserves an immutable seven-day offer's scopes while presenting the current horizon", () => {
    const saved = { schema: HOSTED_GROUP_JOIN_POLICY_SCHEMA, requestedVaultShareProjectionScopes: [sleep, email],
      description: "Shares 7 days of sleep timing." };
    const before = JSON.stringify(saved);
    const scopes = readHostedGroupJoinPolicy(saved).requestedVaultShareProjectionScopes;
    assert.deepEqual(scopes, [email, sleep]);
    assert.deepEqual(resolveHostedGroupAccessOfferProjectionScopes([sleep]), [sleep]);
    const displays = projectHostedVaultShareProjectionDisplays(scopes);
    assert.match(displays.find((display) => display.projectionScopeKey === key(sleep))!.description, /90 days/);
    assert.equal(JSON.stringify(saved), before);
  });

  it("shows one current-policy choice per metric without changing a mixed macro selection", () => {
    const displays = projectHostedVaultShareProjectionDisplays([sleep]);
    assert.equal(displays.length, 1);
    assert.match(displays[0]!.description, /90 days/);
    assert.match(displays[0]!.description, /previous 89/);
    for (const selected of [new Set<string>(), new Set([key(sleep)])]) {
      const cards = groupJoinPermissionsForDisplay(displays, selected);
      assert.equal(cards.length, 1);
      assert.deepEqual(cards[0]!.scopeKeys, [key(sleep)]);
      assert.deepEqual(cards[0]!.legacyScopeKeys, []);
    }
    const macros = projectHostedVaultShareProjectionDisplays([
      { projectionKind: "protein-days.v0" }, { projectionKind: "carbs-days.v0" },
    ]);
    assert.equal(groupJoinPermissionsForDisplay(macros, new Set(["protein-days.v0"])).length, 2);
    const grouped = groupJoinPermissionsForDisplay(macros, new Set());
    assert.equal(grouped.length, 1);
    assert.match(grouped[0]!.description, /90 days/);
  });

  it("negotiates exact plain capabilities without a second history registry", () => {
    const request = (query: string) => new Request(`https://example.invalid/?${query}`);
    const base = `supportedProjectionScope=${key(sleep)}`;
    assert.deepEqual([...readHostedVaultShareSupportedProjectionScopeKeysFromRequest(request(base))], [key(sleep)]);
    assert.deepEqual([...readHostedVaultShareSupportedProjectionScopeKeysFromRequest(request(`${base}&supportedHistoryDays=90`))], [key(sleep)]);
    assert.ok(readHostedVaultShareSupportedProjectionScopeKeysFromRequest(request("")).has(key(sleep)));
    assert.equal(readHostedVaultShareSupportedProjectionScopeKeysFromRequest(request("supportedProjectionScope=future")).size, 0);
  });
});
