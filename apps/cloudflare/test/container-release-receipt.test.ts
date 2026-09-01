import { describe, expect, it, vi } from "vitest";

import {
  buildContainerReleaseEntries,
  createCloudflareContainerApplicationLister,
  parseWranglerContainerActions,
  parseWranglerWorkerVersionId,
  readCloudflareContainerApplicationIdentities,
  readRenderedContainerIdentities,
  type CloudflareContainerApplicationIdentity,
  type WranglerContainerAction,
} from "../scripts/container-release-receipt.js";

const expectedContainers = [
  { applicationName: "worker-active", className: "RunnerContainer" },
  { applicationName: "worker-smoke", className: "DeploySmokeRunnerContainer" },
  { applicationName: "worker-standby", className: "StandbyRunnerContainer" },
] as const;

describe("container release receipt", () => {
  describe("rendered container identities", () => {
    it("reads explicit and Wrangler-derived application names from generated config", async () => {
      const readFile = vi.fn(async () => JSON.stringify({
        containers: [
          { class_name: "RunnerContainer" },
          { class_name: "DeploySmokeRunnerContainer", name: "hosted-smoke" },
        ],
        name: "Hosted Worker",
      }));

      await expect(readRenderedContainerIdentities("generated.json", readFile)).resolves.toEqual([
        {
          applicationName: "hosted-smoke",
          className: "DeploySmokeRunnerContainer",
        },
        {
          applicationName: "hosted-worker-runnercontainer",
          className: "RunnerContainer",
        },
      ]);
      expect(readFile).toHaveBeenCalledWith("generated.json", "utf8");
    });

    it.each([
      "not-json",
      JSON.stringify({ containers: [] }),
      JSON.stringify({ containers: [{ class_name: "RunnerContainer" }] }),
      JSON.stringify({
        containers: [
          { class_name: "RunnerContainer", name: "same-app" },
          { class_name: "SmokeContainer", name: "same-app" },
        ],
      }),
      JSON.stringify({
        containers: [
          { class_name: "RunnerContainer", name: "active" },
          { class_name: "RunnerContainer", name: "standby" },
        ],
      }),
      JSON.stringify({
        containers: [{ class_name: " RunnerContainer", name: "active" }],
      }),
      JSON.stringify({
        containers: [{ class_name: "RunnerContainer", name: "active\nleak" }],
      }),
    ])("rejects a malformed or duplicate generated identity set", async (config) => {
      await expect(readRenderedContainerIdentities(
        "generated.json",
        async () => config,
      )).rejects.toThrow(
        "Generated Wrangler config did not contain an exact container identity set.",
      );
    });
  });

  describe("Wrangler action evidence", () => {
    it("strips terminal controls and returns exactly one sorted action per expected app", () => {
      const output = [
        "\u001B[32m╰ Created application worker-smoke (Application ID: raw-provider-id)\u001B[0m",
        "\u001B[1m╰ Modified application worker-active (Application ID: raw-modified-id)\u001B[0m",
        "spinner\r╰ no changes worker-standby",
        "No changes to be made",
      ].join("\n");

      expect(parseWranglerContainerActions(output, expectedContainers)).toEqual([
        {
          action: "modified",
          applicationName: "worker-active",
          className: "RunnerContainer",
        },
        {
          action: "created",
          applicationName: "worker-smoke",
          className: "DeploySmokeRunnerContainer",
        },
        {
          action: "unchanged",
          applicationName: "worker-standby",
          className: "StandbyRunnerContainer",
        },
      ]);
      expect(JSON.stringify(parseWranglerContainerActions(output, expectedContainers)))
        .not.toMatch(/raw-provider-id|raw-modified-id/u);
    });

    it.each([
      "Modified application worker-active\nno changes worker-standby",
      "Modified application worker-active\nModified application worker-active"
        + "\nCreated application worker-smoke\nno changes worker-standby",
      "Modified application worker-active\nCreated application worker-smoke"
        + "\nno changes worker-standby\nCreated application unrelated-app",
      "Modified application worker-active\nno changes worker-active"
        + "\nCreated application worker-smoke",
    ])("rejects missing, duplicate, unexpected, or conflicting actions", (output) => {
      expect(() => parseWranglerContainerActions(output, expectedContainers)).toThrow(
        "Wrangler deploy output did not report exactly one action for every rendered container.",
      );
    });
  });

  describe("Wrangler Worker evidence", () => {
    it("reads the exact Worker version from terminal output", () => {
      expect(parseWranglerWorkerVersionId(
        "Uploaded hosted-worker\n\u001B[32mCurrent Version ID: version-123\u001B[0m\n",
      )).toBe("version-123");
    });

    it.each([
      "Uploaded hosted-worker",
      "Current Version ID: first\nCurrent Version ID: second",
      "Current Version ID: invalid value",
    ])("rejects missing or ambiguous Worker version evidence", (output) => {
      expect(() => parseWranglerWorkerVersionId(output)).toThrow(
        "Wrangler deploy output did not report exactly one Worker version.",
      );
    });
  });

  describe("Cloudflare provider state", () => {
    it("allows an exact missing application only in the pre-deploy snapshot", async () => {
      const expected = [
        { applicationName: "new-app", className: "NewContainer" },
        { applicationName: "old-app", className: "OldContainer" },
      ];
      const listApplications = vi.fn(async (applicationName: string) =>
        applicationName === "new-app"
          ? []
          : [providerIdentity("old-app", "old-id", 7, "old-image")]
      );

      await expect(readCloudflareContainerApplicationIdentities(
        expected,
        listApplications,
        "before",
      )).resolves.toEqual([
        {
          applicationId: "old-id",
          applicationName: "old-app",
          image: "old-image",
          version: 7,
        },
      ]);
      await expect(readCloudflareContainerApplicationIdentities(
        expected,
        listApplications,
        "after",
      )).rejects.toThrow(
        "Cloudflare container application state was incomplete or malformed.",
      );
    });

    it("requires one exact, well-formed provider application for each post-deploy app", async () => {
      const expected = [{ applicationName: "exact-app", className: "ExactContainer" }];

      await expect(readCloudflareContainerApplicationIdentities(
        expected,
        async () => [providerIdentity("wrong-app", "id", 1, "image")],
        "after",
      )).rejects.toThrow("Cloudflare container application state was incomplete or malformed.");
      await expect(readCloudflareContainerApplicationIdentities(
        expected,
        async () => [
          providerIdentity("exact-app", "id-1", 1, "image"),
          providerIdentity("exact-app", "id-2", 1, "image"),
        ],
        "after",
      )).rejects.toThrow("Cloudflare container application state was incomplete or malformed.");
      await expect(readCloudflareContainerApplicationIdentities(
        expected,
        async () => [{
          configuration: {},
          id: "id",
          name: "exact-app",
          version: 1,
        }],
        "after",
      )).rejects.toThrow("Cloudflare container application state was incomplete or malformed.");
    });

    it("lists one exact application through a no-cache, filtered Cloudflare request", async () => {
      const fetchImpl = vi.fn(async (_input: URL, _init: RequestInit) => ({
        json: async () => ({
          result: [providerIdentity("exact-app", "id", 4, "image")],
          result_info: { next_page_token: "", total_count: 1 },
          success: true,
        }),
        ok: true,
      }));
      const listApplications = createCloudflareContainerApplicationLister({
        accountId: "account-fixture",
        apiToken: "token-fixture",
        fetchImpl,
      });

      await expect(listApplications("exact-app")).resolves.toEqual([
        providerIdentity("exact-app", "id", 4, "image"),
      ]);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const request = fetchImpl.mock.calls[0];
      expect(request?.[0].toString()).toBe(
        "https://api.cloudflare.com/client/v4/accounts/account-fixture/containers/applications"
          + "?name=exact-app",
      );
      expect(request?.[1]).toEqual({
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer token-fixture",
        },
        method: "GET",
        signal: expect.any(AbortSignal),
      });
    });

    it.each([
      { result: [], success: false },
      { result: {}, success: true },
      { result: [], result_info: { next_page_token: "more" }, success: true },
      { result: [], result_info: { total_count: 1 }, success: true },
    ])("rejects invalid or non-exhaustive Cloudflare list responses", async (payload) => {
      const listApplications = createCloudflareContainerApplicationLister({
        accountId: "account-fixture",
        apiToken: "token-fixture",
        fetchImpl: async () => ({ json: async () => payload, ok: true }),
      });

      await expect(listApplications("exact-app")).rejects.toThrow(
        /^Cloudflare container application state was incomplete or malformed\.$/u,
      );
    });

    it("redacts transport, response, URL, and credential detail from list failures", async () => {
      const listApplications = createCloudflareContainerApplicationLister({
        accountId: "sensitive-account-fixture",
        apiToken: "sensitive-token-fixture",
        fetchImpl: async () => {
          throw new Error("raw transport failure with a private URL");
        },
      });

      try {
        await listApplications("exact-app");
        throw new Error("Expected the Cloudflare list to fail.");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        if (!(error instanceof Error)) {
          throw error;
        }
        expect(error.message).toBe(
          "Cloudflare container application state was incomplete or malformed.",
        );
        expect(error.message).not.toMatch(/sensitive|transport|URL/iu);
      }
    });
  });

  describe("provider transition classification", () => {
    const actions: WranglerContainerAction[] = [
      { action: "created", applicationName: "app-z", className: "ZContainer" },
      { action: "modified", applicationName: "app-b", className: "AContainer" },
      { action: "unchanged", applicationName: "app-a", className: "AContainerSibling" },
    ];
    const before: CloudflareContainerApplicationIdentity[] = [
      identity("app-b", "id-b", 4, "image-before"),
      identity("app-a", "id-a", 2, "image-stable"),
    ];
    const after: CloudflareContainerApplicationIdentity[] = [
      identity("app-z", "id-z", 1, "image-created"),
      identity("app-b", "id-b", 4, "image-updated"),
      identity("app-a", "id-a", 2, "image-stable"),
    ];

    it("emits only safe fields in stable class/application order", () => {
      const entries = buildContainerReleaseEntries({ actions, after, before });

      expect(entries).toEqual([
        {
          applicationName: "app-b",
          className: "AContainer",
          disposition: "updated",
          imageSha256: "9ff7d52d53b3639b959907155509b1795020364a2db9fdf186ba499792689655",
          version: 4,
        },
        {
          applicationName: "app-a",
          className: "AContainerSibling",
          disposition: "unchanged",
          imageSha256: "e1e5610d6721e99c7be86efd2945da7541caecdf2bc262a813daaa0cdfc06edd",
          version: 2,
        },
        {
          applicationName: "app-z",
          className: "ZContainer",
          disposition: "created",
          imageSha256: "39cb222ad972f26f504d159fe6d21782603d356d42941e4dd343446683609338",
          version: 1,
        },
      ]);
      expect(JSON.stringify(entries)).not.toMatch(/id-a|id-b|id-z|image-created|image-updated/u);
    });

    it("requires a newly created application to be absent before and at version one after", () => {
      const createdAction = [
        { action: "created", applicationName: "new-app", className: "NewContainer" },
      ] as const;

      expect(() => buildContainerReleaseEntries({
        actions: createdAction,
        after: [identity("new-app", "id", 2, "image")],
        before: [],
      })).toThrow("Container release evidence did not form an exact provider transition.");
      expect(() => buildContainerReleaseEntries({
        actions: createdAction,
        after: [identity("new-app", "id", 1, "image")],
        before: [identity("new-app", "id", 1, "image")],
      })).toThrow("Container release evidence did not form an exact provider transition.");
    });

    it("requires modified identity continuity without treating provider version as a counter", () => {
      const modifiedAction = [
        { action: "modified", applicationName: "app", className: "Container" },
      ] as const;

      expect(() => buildContainerReleaseEntries({
        actions: modifiedAction,
        after: [identity("app", "new-id", 3, "new-image")],
        before: [identity("app", "old-id", 2, "old-image")],
      })).toThrow("Container release evidence did not form an exact provider transition.");
      expect(() => buildContainerReleaseEntries({
        actions: modifiedAction,
        after: [identity("app", "id", 2, "new-image")],
        before: [],
      })).toThrow("Container release evidence did not form an exact provider transition.");

      expect(buildContainerReleaseEntries({
        actions: modifiedAction,
        after: [identity("app", "id", 2, "new-image")],
        before: [identity("app", "id", 2, "old-image")],
      })).toEqual([expect.objectContaining({ disposition: "updated", version: 2 })]);
      expect(buildContainerReleaseEntries({
        actions: modifiedAction,
        after: [identity("app", "id", 1, "newer-image")],
        before: [identity("app", "id", 2, "new-image")],
      })).toEqual([expect.objectContaining({ disposition: "updated", version: 1 })]);
    });

    it("requires unchanged identity, version, and exact image equality", () => {
      const unchangedAction = [
        { action: "unchanged", applicationName: "app", className: "Container" },
      ] as const;

      expect(() => buildContainerReleaseEntries({
        actions: unchangedAction,
        after: [identity("app", "id", 2, "new-image")],
        before: [identity("app", "id", 2, "old-image")],
      })).toThrow("Container release evidence did not form an exact provider transition.");
      expect(() => buildContainerReleaseEntries({
        actions: unchangedAction,
        after: [identity("app", "id", 3, "image")],
        before: [identity("app", "id", 2, "image")],
      })).toThrow("Container release evidence did not form an exact provider transition.");
    });

    it("rejects missing, extra, or duplicate provider state", () => {
      const unchangedAction = [
        { action: "unchanged", applicationName: "app", className: "Container" },
      ] as const;
      const stable = identity("app", "id", 1, "image");

      expect(() => buildContainerReleaseEntries({
        actions: unchangedAction,
        after: [],
        before: [stable],
      })).toThrow("Container release evidence did not form an exact provider transition.");
      expect(() => buildContainerReleaseEntries({
        actions: unchangedAction,
        after: [stable, stable],
        before: [stable],
      })).toThrow("Container release evidence did not form an exact provider transition.");
      expect(() => buildContainerReleaseEntries({
        actions: unchangedAction,
        after: [stable],
        before: [stable, identity("extra", "extra-id", 1, "extra-image")],
      })).toThrow("Container release evidence did not form an exact provider transition.");
    });
  });
});

function providerIdentity(
  applicationName: string,
  id: string,
  version: number,
  image: string,
): Record<string, unknown> {
  return {
    configuration: { image },
    id,
    name: applicationName,
    version,
  };
}

function identity(
  applicationName: string,
  applicationId: string,
  version: number,
  image: string,
): CloudflareContainerApplicationIdentity {
  return { applicationId, applicationName, image, version };
}
