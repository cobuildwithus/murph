import { expect, test } from "vitest";

import {
  buildGroupJoinPostAuthReturnPath,
  readGroupJoinPostAuthHandoff,
  resolveGroupJoinPostJoinDestination,
} from "@/src/lib/hosted-groups/group-join-handoff";

test("keeps a new accessible member on the group link with an initial-visit handoff", () => {
  expect(buildGroupJoinPostAuthReturnPath({
    currentPath: "/groups/join/JOIN123?source=text#sharing",
    payload: {
      initialVisitEligible: true,
      stage: "active",
    },
  })).toBe("/groups/join/JOIN123?source=text&postJoin=initial-visit#sharing");
});

test("removes a stale post-join marker for an existing accessible member", () => {
  expect(buildGroupJoinPostAuthReturnPath({
    currentPath: "/groups/join/JOIN123?postJoin=setup&source=text",
    payload: {
      initialVisitEligible: false,
      stage: "activating",
    },
  })).toBe("/groups/join/JOIN123?source=text");
});

test.each(["checkout", "blocked"] as const)(
  "keeps a %s member on the group link with a setup handoff",
  (stage) => {
    expect(buildGroupJoinPostAuthReturnPath({
      currentPath: "/groups/join/JOIN123",
      payload: { stage },
    })).toBe("/groups/join/JOIN123?postJoin=setup");
  },
);

test("maps only bounded handoff markers to fixed internal destinations", () => {
  expect(resolveGroupJoinPostJoinDestination(
    readGroupJoinPostAuthHandoff("initial-visit"),
  )).toBe("/home?initialVisit=true");
  expect(resolveGroupJoinPostJoinDestination(
    readGroupJoinPostAuthHandoff(["setup", "initial-visit"]),
  )).toBe("/join");
  expect(resolveGroupJoinPostJoinDestination(
    readGroupJoinPostAuthHandoff("https://example.test"),
  )).toBe("/home");
});
