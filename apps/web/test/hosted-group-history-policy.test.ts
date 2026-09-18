import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildHostedVaultShareProjectionScopeKey as key, type HostedVaultShareProjectionScope } from "@murphai/hosted-execution/vault-share";
import {
  collapseSelectedHostedGroupHistoryScopes,
  freshHostedGroupHistoryOfferScopes,
  HOSTED_GROUP_JOIN_POLICY_SCHEMA,
  projectHostedVaultShareProjectionDisplays,
  readHostedGroupJoinPolicy,
  resolveHostedGroupAccessOfferProjectionScopes,
} from "../src/lib/hosted-groups/join-policy";
import { groupJoinPermissionsForDisplay } from "../src/components/hosted-groups/group-join-permission-groups";
import { readHostedVaultShareSupportedProjectionScopeKeysFromRequest } from "../src/lib/hosted-vault-share/supported-projection-scopes";

const sleep: HostedVaultShareProjectionScope = { projectionKind: "sleep-times.v0" };
const expanded: HostedVaultShareProjectionScope = { ...sleep, historyDays: 90 };
const email: HostedVaultShareProjectionScope = { projectionKind: "group-email.v0" };

describe("group history consent surfaces", () => {
  it("keeps saved offers immutable while fresh offers expand only the offered metrics", () => {
    const saved = { schema: HOSTED_GROUP_JOIN_POLICY_SCHEMA, requestedVaultShareProjectionScopes: [sleep, email] };
    assert.deepEqual(readHostedGroupJoinPolicy(saved).requestedVaultShareProjectionScopes, [email, sleep]);
    const fresh = freshHostedGroupHistoryOfferScopes([sleep, email]);
    assert.deepEqual(new Set(fresh.map(key)), new Set([key(expanded), key(email)]));
    assert.deepEqual(resolveHostedGroupAccessOfferProjectionScopes([sleep]), [expanded]);
    assert.deepEqual(readHostedGroupJoinPolicy(saved).requestedVaultShareProjectionScopes, [email, sleep]);
    assert.deepEqual(collapseSelectedHostedGroupHistoryScopes([sleep, expanded, email]), [email, expanded]);
    assert.deepEqual(collapseSelectedHostedGroupHistoryScopes([sleep]), [sleep]);
  });

  it("discloses both history lengths without treating a legacy selection as expansion", () => {
    const displays = projectHostedVaultShareProjectionDisplays([sleep, expanded]);
    assert.equal(displays.length, 2);
    assert.match(displays[0]!.description, /7 days/);
    assert.match(displays[1]!.description, /90 days/);
    assert.match(displays[1]!.description, /previous 89/);
    const cards = groupJoinPermissionsForDisplay(displays, new Set([key(sleep)]));
    assert.equal(cards.length, 2);
    assert.deepEqual(cards[1]!.legacyScopeKeys, []);
    const macros = projectHostedVaultShareProjectionDisplays([
      { projectionKind: "protein-days.v0" }, { projectionKind: "carbs-days.v0", historyDays: 90 },
    ]);
    assert.equal(groupJoinPermissionsForDisplay(macros, new Set()).length, 2);
  });

  it("keeps old capability requests seven-day and expands only explicit compatible consumers", () => {
    const request = (query: string) => new Request(`https://example.invalid/?${query}`);
    const base = `supportedProjectionScope=${key(sleep)}`;
    assert.deepEqual([...readHostedVaultShareSupportedProjectionScopeKeysFromRequest(request(base))], [key(sleep)]);
    assert.deepEqual([...readHostedVaultShareSupportedProjectionScopeKeysFromRequest(request(`${base}&supportedHistoryDays=90`))], [key(sleep), key(expanded)]);
    assert.ok(!readHostedVaultShareSupportedProjectionScopeKeysFromRequest(request("supportedHistoryDays=90")).has(key(expanded)));
    assert.equal(readHostedVaultShareSupportedProjectionScopeKeysFromRequest(request("supportedProjectionScope=future&supportedHistoryDays=90")).size, 0);
  });
});
