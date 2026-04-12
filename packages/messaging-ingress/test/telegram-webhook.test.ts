import assert from "node:assert/strict";

import {
  test,
  vi,
} from "vitest";

import {
  summarizeTelegramUpdate,
} from "../src/telegram-webhook.ts";
import {
  minimizeTelegramUpdate,
  parseTelegramWebhookUpdate,
} from "../src/telegram-webhook-payload.ts";

test("parseTelegramWebhookUpdate validates supported message fields", () => {
  const update = parseTelegramWebhookUpdate(JSON.stringify({
    message: {
      chat: {
        id: 123,
        is_direct_messages: true,
        type: "private",
      },
      date: 1_774_522_600,
      direct_messages_topic: {
        title: "Business DM",
        topic_id: 7,
      },
      from: {
        first_name: "Alice",
        id: 456,
      },
      message_id: 1,
      reply_to_message: {
        chat: {
          id: 123,
          type: "private",
        },
        direct_messages_topic: {
          title: "Earlier",
          topic_id: 6,
        },
        from: {
          first_name: "Alice",
          id: 456,
        },
        message_id: 2,
        text: "Earlier message",
      },
      text: "hello",
    },
    update_id: 321,
  }));

  assert.equal(update.update_id, 321);
  assert.equal(update.message?.direct_messages_topic?.topic_id, 7);
  assert.equal(update.message?.reply_to_message?.direct_messages_topic?.topic_id, 6);
});

test("parseTelegramWebhookUpdate rejects invalid direct message topics", () => {
  assert.throws(
    () =>
      parseTelegramWebhookUpdate(JSON.stringify({
        message: {
          chat: {
            id: 123,
            type: "private",
          },
          direct_messages_topic: {
            topic_id: "nope",
          },
          message_id: 1,
        },
        update_id: 321,
      })),
    /message\.direct_messages_topic\.topic_id must be an integer/u,
  );
});

test("parseTelegramWebhookUpdate rejects invalid envelopes and malformed media records", () => {
  assert.throws(() => parseTelegramWebhookUpdate("{"), /must be valid JSON/u);
  assert.throws(() => parseTelegramWebhookUpdate("null"), /must be a JSON object/u);

  assert.throws(
    () =>
      parseTelegramWebhookUpdate(JSON.stringify({
        message: {
          chat: {
            id: {
              nope: true,
            },
            type: "private",
          },
          message_id: 1,
        },
        update_id: 321,
      })),
    /message\.chat\.id must be a string or finite number/u,
  );

  assert.throws(
    () =>
      parseTelegramWebhookUpdate(JSON.stringify({
        message: {
          chat: {
            id: 123,
            type: "private",
          },
          message_id: 1,
          photo: [null],
        },
        update_id: 322,
      })),
    /message\.photo\[0\] must be a JSON object/u,
  );
});

test("summarizeTelegramUpdate infers hosted bot identity only when asked", () => {
  const update = parseTelegramWebhookUpdate(JSON.stringify({
    message: {
      chat: {
        id: 123,
        type: "private",
      },
      date: 1_774_522_600,
      from: {
        first_name: "Murph Bot",
        id: 999,
        is_bot: true,
      },
      message_id: 1,
      text: "hello",
    },
    update_id: 321,
  }));

  const localSummary = summarizeTelegramUpdate({ update });
  const hostedSummary = summarizeTelegramUpdate({
    inferBotUserIdFromMessage: true,
    update,
  });

  assert.equal(localSummary?.botUserId, null);
  assert.equal(localSummary?.actor.isSelf, false);
  assert.equal(hostedSummary?.botUserId, "999");
  assert.equal(hostedSummary?.actor.isSelf, true);
});

test("minimizeTelegramUpdate preserves allowlisted nested reply metadata", () => {
  const update = parseTelegramWebhookUpdate(JSON.stringify({
    business_message: {
      business_connection_id: "biz_123",
      caption: "album caption",
      chat: {
        id: "123",
        is_direct_messages: true,
        title: "Business",
        type: "private",
      },
      date: 1_774_522_600,
      direct_messages_topic: {
        title: "Business DM",
        topic_id: 7,
      },
      from: {
        first_name: "Alice",
        id: 456,
      },
      media_group_id: "album_123",
      message_id: 5,
      reply_to_message: {
        business_connection_id: "biz_123",
        chat: {
          id: "123",
          is_direct_messages: true,
          type: "private",
        },
        direct_messages_topic: {
          title: "Earlier DM",
          topic_id: 6,
        },
        from: {
          first_name: "Alice",
          id: 456,
        },
        message_id: 4,
        text: "Earlier message",
      },
    },
    update_id: 321,
  }));

  const minimized = minimizeTelegramUpdate(update);
  const businessMessage =
    minimized.business_message && typeof minimized.business_message === "object"
      ? (minimized.business_message as Record<string, unknown>)
      : null;
  const replyToMessage =
    businessMessage?.reply_to_message && typeof businessMessage.reply_to_message === "object"
      ? (businessMessage.reply_to_message as Record<string, unknown>)
      : null;

  assert.equal(minimized.update_id, 321);
  assert.equal(minimized.message, null);
  assert.equal(businessMessage?.business_connection_id, "biz_123");
  assert.equal(businessMessage?.caption, "album caption");
  assert.equal(businessMessage?.media_group_id, "album_123");
  assert.deepEqual(businessMessage?.direct_messages_topic, {
    title: "Business DM",
    topic_id: 7,
  });
  assert.deepEqual(replyToMessage?.direct_messages_topic, {
    title: "Earlier DM",
    topic_id: 6,
  });
  assert.equal(replyToMessage?.business_connection_id, "biz_123");
  assert.equal(replyToMessage?.text, "Earlier message");
});

test("parseTelegramWebhookUpdate validates rich optional Telegram message fields", () => {
  const update = parseTelegramWebhookUpdate(JSON.stringify({
    business_message: {
      animation: {
        file_id: "anim_1",
        file_name: "wave.gif",
        file_size: 512,
        file_unique_id: "anim_u1",
        mime_type: "image/gif",
      },
      audio: {
        file_id: "audio_1",
        file_name: "song.mp3",
        file_size: 2048,
        file_unique_id: "audio_u1",
        mime_type: "audio/mpeg",
      },
      business_connection_id: "biz_789",
      caption: "rich payload",
      chat: {
        first_name: "Inbox",
        id: "chat_789",
        is_direct_messages: true,
        type: "private",
      },
      contact: {
        first_name: "Alice",
        last_name: "Sender",
        phone_number: "+15551234567",
        user_id: 456,
        vcard: "BEGIN:VCARD",
      },
      date: 1_774_522_600,
      document: {
        file_id: "doc_1",
        file_name: "report.pdf",
        file_size: 1024,
        file_unique_id: "doc_u1",
        mime_type: "application/pdf",
      },
      from: {
        first_name: "Alice",
        id: 456,
      },
      location: {
        latitude: 40.7128,
        longitude: -74.006,
      },
      message_id: 77,
      photo: [
        {
          file_id: "photo_1",
          file_name: "photo.jpg",
          file_size: 256,
          file_unique_id: "photo_u1",
          height: 100,
          mime_type: "image/jpeg",
          width: 200,
        },
      ],
      poll: {
        options: [{ text: "Yes" }, { text: "No" }],
        question: "Lunch?",
      },
      quote: {
        text: "quoted",
      },
      sender_business_bot: {
        first_name: "Murph Bot",
        id: 999,
        is_bot: true,
      },
      sender_chat: {
        id: -1001,
        title: "Announcements",
        type: "channel",
      },
      sticker: {
        file_id: "sticker_1",
        file_name: "sticker.webp",
        file_size: 128,
        file_unique_id: "sticker_u1",
        mime_type: "image/webp",
      },
      venue: {
        address: "1 Main St",
        location: {
          latitude: 40.7128,
          longitude: -74.006,
        },
        title: "Cafe 123",
      },
      video: {
        file_id: "video_1",
        file_name: "clip.mp4",
        file_size: 4096,
        file_unique_id: "video_u1",
        mime_type: "video/mp4",
      },
      video_note: {
        file_id: "video_note_1",
        file_size: 512,
        file_unique_id: "video_note_u1",
      },
      voice: {
        file_id: "voice_1",
        file_size: 256,
        file_unique_id: "voice_u1",
        mime_type: "audio/ogg",
      },
    },
    update_id: 654,
  }));

  const minimized = minimizeTelegramUpdate(update);
  const businessMessage =
    minimized.business_message && typeof minimized.business_message === "object"
      ? (minimized.business_message as Record<string, unknown>)
      : null;

  assert.equal(update.business_message?.photo?.[0]?.width, 200);
  assert.equal(update.business_message?.poll?.options?.[1]?.text, "No");
  assert.deepEqual(businessMessage?.venue, {
    address: "1 Main St",
    location: {
      latitude: 40.7128,
      longitude: -74.006,
    },
    title: "Cafe 123",
  });
  assert.deepEqual(businessMessage?.poll, {
    options: [{ text: "Yes" }, { text: "No" }],
    question: "Lunch?",
  });
  assert.deepEqual(businessMessage?.quote, {
    text: "quoted",
  });
  assert.deepEqual(businessMessage?.photo, [
    {
      file_id: "photo_1",
      file_name: "photo.jpg",
      file_size: 256,
      file_unique_id: "photo_u1",
      height: 100,
      mime_type: "image/jpeg",
      width: 200,
    },
  ]);
  assert.deepEqual(businessMessage?.voice, {
    file_id: "voice_1",
    file_name: null,
    file_size: 256,
    file_unique_id: "voice_u1",
    mime_type: "audio/ogg",
  });
});

test("parseTelegramWebhookUpdate rejects invalid poll option payloads", () => {
  assert.throws(
    () =>
      parseTelegramWebhookUpdate(JSON.stringify({
        message: {
          chat: {
            id: 123,
            type: "private",
          },
          message_id: 1,
          poll: {
            options: "nope",
            question: "Lunch?",
          },
        },
        update_id: 321,
      })),
    /message\.poll\.options must be an array/u,
  );
});

test("summarizeTelegramUpdate formats fallback message text and infers sender business bots", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-08T03:04:05.000Z"));

  try {
    const baseMessage = {
      business_connection_id: "biz_555",
      chat: {
        first_name: "Murph Inbox",
        id: "chat_555",
        is_direct_messages: true,
        type: "private",
      },
      direct_messages_topic: {
        title: "Priority",
        topic_id: 9,
      },
      message_id: 5,
      sender_business_bot: {
        first_name: "Murph Bot",
        id: 777,
        is_bot: true,
      },
    };

    const contactSummary = summarizeTelegramUpdate({
      inferBotUserIdFromMessage: true,
      update: {
        business_message: {
          ...baseMessage,
          contact: {
            first_name: "Alice",
            phone_number: "+15551234567",
          },
        },
        update_id: 1,
      },
    });
    const venueSummary = summarizeTelegramUpdate({
      update: {
        message: {
          chat: {
            id: -200,
            title: "Team Chat",
            type: "group",
          },
          location: {
            latitude: 1,
            longitude: 2,
          },
          message_id: 6,
          sender_chat: {
            id: -201,
            title: "Status Bot",
            type: "channel",
          },
          venue: {
            address: "Main Street",
            location: {
              latitude: 1,
              longitude: 2,
            },
            title: "Cafe",
          },
        },
        update_id: 2,
      },
    });
    const pollSummary = summarizeTelegramUpdate({
      update: {
        message: {
          chat: {
            id: 123,
            type: "private",
            username: "alice",
          },
          message_id: 7,
          poll: {
            options: [{ text: "Yes" }, { text: "No" }],
            question: "Lunch?",
          },
        },
        update_id: 3,
      },
    });
    const locationSummary = summarizeTelegramUpdate({
      update: {
        message: {
          chat: {
            id: 124,
            type: "private",
          },
          location: {
            latitude: 12.34,
            longitude: 56.78,
          },
          message_id: 8,
        },
        update_id: 4,
      },
    });

    assert.equal(contactSummary?.botUserId, "777");
    assert.equal(contactSummary?.actor.isSelf, true);
    assert.equal(contactSummary?.occurredAt, "2026-04-08T03:04:05.000Z");
    assert.equal(contactSummary?.text, "Shared contact: Alice (+15551234567)");
    assert.equal(contactSummary?.thread.id, "chat_555:business:biz_555:dm-topic:9");
    assert.equal(contactSummary?.thread.title, "Murph Inbox / Priority");

    assert.equal(venueSummary?.actor.id, "chat:-201");
    assert.equal(venueSummary?.actor.displayName, "Status Bot");
    assert.equal(
      venueSummary?.text,
      "Shared venue: Cafe | Main Street | Shared location: 1, 2",
    );

    assert.equal(pollSummary?.text, "Shared poll: Lunch? [Yes | No]");
    assert.equal(pollSummary?.thread.title, "@alice");
    assert.equal(locationSummary?.text, "Shared location: 12.34, 56.78");

    assert.equal(
      summarizeTelegramUpdate({
        update: {
          message: {
            chat: {
              id: 125,
              type: "private",
            },
            message_id: 9,
            poll: {
              options: [],
            },
          },
          update_id: 5,
        },
      })?.text,
      null,
    );
    assert.equal(
      summarizeTelegramUpdate({
        update: {
          message: {
            chat: {
              id: 126,
              type: "private",
            },
            message_id: 10,
            venue: {},
          },
          update_id: 6,
        },
      })?.text,
      null,
    );
  } finally {
    vi.useRealTimers();
  }
});

test("summarizeTelegramUpdate returns null for empty updates and empty fallback payloads", () => {
  assert.equal(summarizeTelegramUpdate({ update: { update_id: 99 } }), null);
  assert.equal(
    summarizeTelegramUpdate({
      update: {
        message: {
          chat: {
            id: 127,
            type: "private",
          },
          contact: {},
          location: {
            latitude: 12.34,
          },
          message_id: 11,
        },
        update_id: 100,
      },
    })?.text,
    null,
  );
});
