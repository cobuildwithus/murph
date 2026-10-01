import { describe, expect, it, vi } from "vitest";

import {
  recordHostedGrowthGroupPrivateRosterConversions,
} from "@/src/lib/hosted-ops/growth-group-private-observations";

vi.mock("server-only", () => ({}));

describe("group participant growth observations", () => {
  it("attributes only live observations that precede first private activation", async () => {
    const executeRaw = vi.fn().mockResolvedValue(2);
    const trackedAt = new Date("2026-08-26T12:00:00.000Z");

    await expect(recordHostedGrowthGroupPrivateRosterConversions({
      prisma: { $executeRaw: executeRaw } as never,
      trackedAt,
    })).resolves.toBe(2);

    const query = executeRaw.mock.calls[0]?.[0] as {
      sql?: unknown;
      values?: unknown;
    };
    expect(query.sql).toContain(
      "FROM hosted_group_participant_observation AS observation",
    );
    expect(query.sql).toContain(
      "identity.phone_lookup_key = observation.contact_lookup_key",
    );
    expect(query.sql).toContain(
      "email.verified_email_lookup_key = observation.contact_lookup_key",
    );
    expect(query.sql).toContain("email.verified_email_verified_at IS NOT NULL");
    expect(query.sql).toContain("activation.kind = 'member.activated'");
    expect(query.sql).toContain(
      "activation.created_at > first_observation.first_observed_at",
    );
    expect(query.sql).toContain("member.group_private_conversion_tracked_at IS NULL");
    expect(query.sql).toContain("FROM hosted_group");
    expect(query.sql).toContain("FROM hosted_thread_container");
    expect(query.values).toEqual([trackedAt, trackedAt, trackedAt, trackedAt]);
  });
});
