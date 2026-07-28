import {
  matchHostedPrivateMediaCapabilityPath,
  readHostedPrivateMedia,
  readHostedPrivateMediaCapabilitySecret,
} from "../../private-media.ts";
import type {
  WorkerEnvironmentSource,
} from "../../worker-routes/shared.ts";
import type {
  DeclarativeRoute,
} from "../routes.ts";

export const privateMediaRoutes: readonly DeclarativeRoute<{
  env: Pick<
    WorkerEnvironmentSource,
    "BUNDLES" | "HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET"
  >;
  request: Request;
  url: URL;
}>[] = [
  {
    async handle(context, params) {
      const capabilitySecret = readHostedPrivateMediaCapabilitySecret(
        context.env,
      );
      const expiresAtUnixSeconds = readCapabilityExpiry(context.url);
      if (!capabilitySecret || expiresAtUnixSeconds === null) {
        return privateMediaNotFound();
      }
      const media = await readHostedPrivateMedia({
        bucket: context.env.BUNDLES,
        capability: params.capability ?? "",
        capabilitySecret,
        expiresAtUnixSeconds,
      });
      if (!media) {
        return privateMediaNotFound();
      }

      return new Response(copyBytesToArrayBuffer(media.bytes), {
        headers: {
          "cache-control": "private, no-store",
          "content-disposition":
            `inline; filename="group-avatar.${extensionForContentType(media.contentType)}"`,
          "content-length": String(media.bytes.byteLength),
          "content-type": media.contentType,
          "x-content-type-options": "nosniff",
        },
        status: 200,
      });
    },
    match(pathname) {
      const capability = matchHostedPrivateMediaCapabilityPath(pathname);
      return capability ? { capability } : null;
    },
    methods: ["GET"],
    name: "private-media-delivery",
    wrongMethodResponse: "not-found",
  },
];

function readCapabilityExpiry(url: URL): number | null {
  const entries = [...url.searchParams.entries()];
  if (
    entries.length !== 1
    || entries[0]?.[0] !== "exp"
    || !/^[1-9][0-9]*$/u.test(entries[0]?.[1] ?? "")
  ) {
    return null;
  }
  const expiresAtUnixSeconds = Number(entries[0]?.[1]);
  return Number.isSafeInteger(expiresAtUnixSeconds)
    ? expiresAtUnixSeconds
    : null;
}

function extensionForContentType(
  contentType: "image/jpeg" | "image/png" | "image/webp",
): "jpg" | "png" | "webp" {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
  }
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function privateMediaNotFound(): Response {
  return new Response(null, {
    headers: {
      "cache-control": "private, no-store",
    },
    status: 404,
  });
}
