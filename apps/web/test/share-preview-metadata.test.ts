import { existsSync } from "node:fs";

import type { Metadata } from "next";
import { describe, expect, it, vi } from "vitest";

// The share-preview contract: every route with a dedicated Open Graph card
// must advertise that card explicitly, because createMurphPageMetadata
// injects the site default otherwise and that explicit default also defeats
// file-convention inheritance from parent segments.

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedDashboardPageAuthSnapshot: vi.fn(),
  getHostedPageAuthSnapshot: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  buildHostedInvitePageData: vi.fn(),
}));

vi.mock("@/src/components/biomarkers/biomarker-detail/biomarker-research", () => ({
  BiomarkerResearch: () => null,
}));

vi.mock("@/src/components/experiments/experiment-detail/research-tab", () => ({
  ExperimentResearchTab: () => null,
  ResearchTab: () => null,
}));

vi.mock("@/src/components/hosted-onboarding/join-invite-preview", () => ({
  JoinInvitePreview: () => null,
}));

vi.mock("@/src/components/hosted-onboarding/join-invite-success-client", () => ({
  JoinInviteSuccessClient: () => null,
}));

function expectDedicatedImage(
  metadata: Metadata,
  expected: { alt: string; url: string },
) {
  const image = expect.objectContaining({
    alt: expected.alt,
    height: 630,
    type: "image/png",
    url: expected.url,
    width: 1200,
  });
  expect(metadata.openGraph?.images).toEqual([image]);
  expect(metadata.twitter?.images).toEqual([image]);
}

function expectRouteFile(relativePath: string) {
  expect(existsSync(new URL(relativePath, import.meta.url))).toBe(true);
}

describe("share preview metadata", () => {
  it("signup referral pages advertise the referral card", async () => {
    const { generateMetadata } = await import(
      "../app/r/[referralCode]/page-metadata"
    );
    const metadata = await generateMetadata({
      params: Promise.resolve({ referralCode: "ref-code" }),
    });

    expect(metadata.title).toBe("Join Murph");
    expectDedicatedImage(metadata, {
      alt: "You’re invited to Murph, your private health assistant.",
      url: "/r/ref-code/opengraph-image",
    });
    expect(metadata.robots).toEqual({ follow: false, index: false });
    expectRouteFile("../app/r/[referralCode]/opengraph-image.tsx");
  });

  it("connect advertises the device card", async () => {
    const { metadata } = await import(
      "../app/(dashboard)/connect/connect-page-metadata"
    );

    expect(metadata.title).toBe("Connect Devices — Murph");
    expectDedicatedImage(metadata, {
      alt: "Let’s connect your device. Wearables and health data sources.",
      url: "/connect/opengraph-image",
    });
    expectRouteFile("../app/(dashboard)/connect/opengraph-image.tsx");
  });

  it("group funding pages advertise the sponsor card", async () => {
    const { generateMetadata } = await import(
      "../app/groups/fund/[joinCode]/page-metadata"
    );
    const metadata = await generateMetadata({
      params: Promise.resolve({ joinCode: "join-code" }),
    });

    expect(metadata.title).toBe("Sponsor Murph in this chat");
    expectDedicatedImage(metadata, {
      alt: "Keep Murph in this chat. Sponsor Murph for the whole chat.",
      url: "/groups/fund/join-code/opengraph-image",
    });
    expectRouteFile("../app/groups/fund/[joinCode]/opengraph-image.tsx");
  });

  it("settings advertises the settings card", async () => {
    const { metadata } = await import(
      "../app/(dashboard)/settings/page-metadata"
    );

    expect(metadata.title).toBe("Settings — Murph");
    expectDedicatedImage(metadata, {
      alt: "Manage your Murph. Account, plan, usage, and privacy.",
      url: "/settings/opengraph-image",
    });
    expectRouteFile("../app/(dashboard)/settings/opengraph-image.tsx");
  });

  it("biomarker research keeps the parent biomarker card", async () => {
    const { generateMetadata } = await import(
      "../app/(dashboard)/biomarkers/[biomarkerId]/research/page"
    );
    const metadata = await generateMetadata({
      params: Promise.resolve({ biomarkerId: "deep-sleep-minutes" }),
    });

    expectDedicatedImage(metadata, {
      alt: "A Murph biomarker.",
      url: "/biomarkers/deep-sleep-minutes/opengraph-image",
    });
  });

  it("experiment research keeps the parent experiment card", async () => {
    const { generateMetadata } = await import(
      "../app/(dashboard)/experiments/[experimentId]/research/page"
    );
    const metadata = await generateMetadata({
      params: Promise.resolve({ experimentId: "cold-plunge" }),
    });

    expectDedicatedImage(metadata, {
      alt: "A Murph experiment.",
      url: "/experiments/cold-plunge/opengraph-image",
    });
  });

  it("experiment results keeps the parent experiment card", async () => {
    const { generateMetadata } = await import(
      "../app/(dashboard)/experiments/[experimentId]/results/page"
    );
    const metadata = await generateMetadata({
      params: Promise.resolve({ experimentId: "cold-plunge" }),
    });

    expectDedicatedImage(metadata, {
      alt: "A Murph experiment.",
      url: "/experiments/cold-plunge/opengraph-image",
    });
  });

  it("join checkout outcome pages keep the invite card", async () => {
    const successPage = await import("../app/join/[inviteCode]/success/page");
    const cancelPage = await import("../app/join/[inviteCode]/cancel/page");

    for (const generateMetadata of [
      successPage.generateMetadata,
      cancelPage.generateMetadata,
    ]) {
      const metadata = await generateMetadata({
        params: Promise.resolve({ inviteCode: "invite-code" }),
      });
      expectDedicatedImage(metadata, {
        alt: "You’re invited to Murph.",
        url: "/join/invite-code/opengraph-image",
      });
    }
  });
});
