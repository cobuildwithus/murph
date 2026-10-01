import "server-only";

import { readFile } from "node:fs/promises";

import { resolveRuntimeAssetPath } from "@/app/runtime-asset-files";
import {
  encodeMurphHostedLinqContactCardVcfPhoto,
  type MurphHostedLinqContactCardVcfPhoto,
} from "@/src/lib/hosted-onboarding/linq-contact-card";
import { findMurphContactAvatarOption } from "@/src/lib/murph-contact-avatars";

export async function readMurphContactCardAvatarPhoto(
  avatarId: string,
): Promise<MurphHostedLinqContactCardVcfPhoto | null> {
  const avatar = findMurphContactAvatarOption(avatarId);
  if (!avatar.src || !avatar.src.toLowerCase().endsWith(".png")) {
    return null;
  }

  try {
    const bytes = await readFile(
      resolveRuntimeAssetPath(`public${avatar.src}`),
    );
    return encodeMurphHostedLinqContactCardVcfPhoto({ bytes, type: "PNG" });
  } catch {
    return null;
  }
}
