import { describe, expect, it } from "vitest";

import {
  buildHostedGroupSponsorshipDraftInput,
} from "@/src/lib/hosted-groups/group-sponsorship-contract";

describe("group sponsorship draft contract", () => {
  it("keeps public creative output off unless the sponsor explicitly enables it", () => {
    expect(buildHostedGroupSponsorshipDraftInput({
      creativeEnabled: false,
      creativeFormat: "song",
      creativePrompt: "Make this the group theme.",
      creativeStyleRequest: "Warm ensemble-sitcom theme.",
      publicAlias: "The Group Historian",
      runningBitAvailable: false,
      runningBitRequest: "Treat me like the exhausted CFO.",
    })).toEqual({
      publicAlias: "The Group Historian",
      runningBitRequest: null,
      sponsorMessage: null,
    });
  });

  it("keeps a song style reference only for the song format", () => {
    expect(buildHostedGroupSponsorshipDraftInput({
      creativeEnabled: true,
      creativeFormat: "song",
      creativePrompt: "Make this the group theme.",
      creativeStyleRequest: "Warm ensemble-sitcom theme.",
      publicAlias: "",
      runningBitAvailable: true,
      runningBitRequest: "Treat me like the exhausted CFO.",
    })).toEqual({
      creativeRequest: {
        format: "song",
        prompt: "Make this the group theme.",
        styleRequest: "Warm ensemble-sitcom theme.",
      },
      publicAlias: "",
      runningBitRequest: "Treat me like the exhausted CFO.",
      sponsorMessage: null,
    });

    expect(buildHostedGroupSponsorshipDraftInput({
      creativeEnabled: true,
      creativeFormat: "poem",
      creativePrompt: "Make this the group poem.",
      creativeStyleRequest: "This must not leak into a poem.",
      publicAlias: "",
      runningBitAvailable: false,
      runningBitRequest: "",
    })).toEqual({
      creativeRequest: {
        format: "poem",
        prompt: "Make this the group poem.",
        styleRequest: null,
      },
      publicAlias: "",
      runningBitRequest: null,
      sponsorMessage: null,
    });
  });
});
