import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "vitest";

import { GROUP_MEMBERS } from "@/src/components/homepage/group-chat-cards";
import { MURPH_HEADSHOT_SOURCES } from "@/src/components/homepage/murph-headshot-avatar";

const AVATAR_SOURCES = [
  ...MURPH_HEADSHOT_SOURCES,
  ...GROUP_MEMBERS.map((member) => member.avatarSrc),
];

test("homepage avatars use compact modern-format derivatives", async () => {
  expect(new Set(AVATAR_SOURCES).size).toBe(7);

  for (const source of AVATAR_SOURCES) {
    expect(source).toMatch(/-avatar\.avif$/);

    const asset = await stat(
      resolve(import.meta.dirname, "..", "public", source.slice(1)),
    );
    expect(asset.size, `${source} should stay below 16 KiB`).toBeLessThan(
      16 * 1024,
    );
  }
});
