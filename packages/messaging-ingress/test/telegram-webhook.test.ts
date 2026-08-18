import assert from "node:assert/strict";

import {
  test,
  vi,
} from "vitest";

import {
  buildTelegramThreadId,
  summarizeTelegramUpdate,
} from "../src/telegram-webhook.ts";
import {
  assertTelegramWebhookSecretToken,
  minimizeTelegramUpdate,
  parseTelegramWebhookUpdate,
  readTelegramWebhookHeader,
  readTelegramWebhookSecretToken,
  verifyAndParseTelegramWebhookRequest,
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

test("verifyAndParseTelegramWebhookRequest validates the Telegram secret-token header before parsing", () => {
  const update = verifyAndParseTelegramWebhookRequest({
    headers: new Headers({
      "X-Telegram-Bot-Api-Secret-Token": "telegram-secret",
    }),
    rawBody: JSON.stringify({
      message: {
        chat: {
          id: 123,
          type: "private",
        },
        date: 1_774_522_600,
        message_id: 1,
        text: "hello",
      },
      update_id: 321,
    }),
    webhookSecret: "telegram-secret",
  });

  assert.equal(update.update_id, 321);
  assert.equal(readTelegramWebhookSecretToken({
    "x-telegram-bot-api-secret-token": ["telegram-secret"],
  }), "telegram-secret");
  assert.equal(
    readTelegramWebhookHeader(
      { "X-Telegram-Bot-Api-Secret-Token": "telegram-secret" },
      "x-telegram-bot-api-secret-token",
    ),
    "telegram-secret",
  );
});

test("verifyAndParseTelegramWebhookRequest rejects missing or mismatched secret tokens", () => {
  const rawBody = JSON.stringify({
    message: {
      chat: {
        id: 123,
        type: "private",
      },
      message_id: 1,
      text: "hello",
    },
    update_id: 321,
  });

  assert.throws(
    () =>
      verifyAndParseTelegramWebhookRequest({
        headers: {},
        rawBody,
        webhookSecret: "telegram-secret",
      }),
    /Invalid Telegram webhook secret token/u,
  );

  assert.throws(
    () =>
      verifyAndParseTelegramWebhookRequest({
        headers: {
          "x-telegram-bot-api-secret-token": "wrong-secret",
        },
        rawBody: new TextEncoder().encode(rawBody).buffer,
        webhookSecret: "telegram-secret",
      }),
    /Invalid Telegram webhook secret token/u,
  );

  assert.throws(
    () =>
      verifyAndParseTelegramWebhookRequest({
        headers: {
          "x-telegram-bot-api-secret-token": " telegram-secret ",
        },
        rawBody,
        webhookSecret: "telegram-secret",
      }),
    /Invalid Telegram webhook secret token/u,
  );

  assert.throws(
    () =>
      assertTelegramWebhookSecretToken({
        secretToken: "telegram-secret",
        webhookSecret: "",
      }),
    /Telegram webhook secret is required/u,
  );
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

test("minimizeTelegramUpdate stores only minimal telegram capture metadata with reply previews", () => {
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

  assert.deepEqual(minimized, {
    media_group_id: "album_123",
    message_id: 5,
    reply_context_preview: "Replying to: Earlier message",
    reply_to_message_id: 4,
    schema: "murph.telegram-capture.v1",
  });
});

test("minimizeTelegramUpdate keeps poll context without persisting actor identity", () => {
  const update = parseTelegramWebhookUpdate(JSON.stringify({
    message: {
      chat: {
        id: 123,
        type: "private",
      },
      message_id: 6,
      quote: {
        text: " Which option did you mean? ",
      },
      reply_to_message: {
        chat: {
          id: 123,
          type: "private",
        },
        from: {
          first_name: "Casey",
          username: "casey",
          id: 456,
        },
        message_id: 5,
        poll: {
          options: [{ text: "Sushi" }, { text: "Soup" }],
          question: "Lunch?",
        },
      },
    },
    update_id: 322,
  }));

  assert.deepEqual(minimizeTelegramUpdate(update), {
    message_id: 6,
    reply_context_preview:
      "Replying to: Poll Lunch? [Sushi | Soup]\nQuoted text: Which option did you mean?",
    reply_to_message_id: 5,
    schema: "murph.telegram-capture.v1",
  });
});

test("minimizeTelegramUpdate sanitizes venue reply context without leaking address details", () => {
  const update = parseTelegramWebhookUpdate(JSON.stringify({
    message: {
      chat: {
        id: 123,
        type: "private",
      },
      message_id: 7,
      reply_to_message: {
        chat: {
          id: 123,
          type: "private",
        },
        message_id: 6,
        venue: {
          address: "123 Main St",
          location: {
            latitude: 40.7128,
            longitude: -74.006,
          },
          title: "Cafe 123",
        },
      },
    },
    update_id: 323,
  }));

  assert.deepEqual(minimizeTelegramUpdate(update), {
    message_id: 7,
    reply_context_preview: "Replying to: Shared venue Cafe 123",
    reply_to_message_id: 6,
    schema: "murph.telegram-capture.v1",
  });
});

test("minimizeTelegramUpdate caps the final assembled reply preview", () => {
  const update = parseTelegramWebhookUpdate(JSON.stringify({
    message: {
      chat: {
        id: 123,
        type: "private",
      },
      message_id: 8,
      quote: {
        text: "Q".repeat(220),
      },
      reply_to_message: {
        chat: {
          id: 123,
          type: "private",
        },
        message_id: 7,
        poll: {
          options: Array.from({ length: 6 }, (_, index) => ({
            text: `Option ${index + 1} ${"X".repeat(60)}`,
          })),
          question: `Lunch ${"Y".repeat(80)}?`,
        },
      },
    },
    update_id: 324,
  }));

  const minimized = minimizeTelegramUpdate(update);
  assert.equal(minimized.schema, "murph.telegram-capture.v1");
  assert.equal(minimized.message_id, 8);
  assert.equal(minimized.reply_to_message_id, 7);
  const preview = minimized.reply_context_preview;
  assert.equal(typeof preview, "string");
  assert.equal((preview as string).length, 240);
  assert.ok((preview as string).startsWith("Replying to: Poll Lunch "));
  assert.ok((preview as string).endsWith("..."));
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

  assert.equal(update.business_message?.photo?.[0]?.width, 200);
  assert.equal(update.business_message?.poll?.options?.[1]?.text, "No");
  assert.deepEqual(minimized, {
    message_id: 77,
    reply_context_preview: "Quoted text: quoted",
    schema: "murph.telegram-capture.v1",
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

test("parseTelegramWebhookUpdate validates a callback query and keeps its binding", () => {
  const update = parseTelegramWebhookUpdate(JSON.stringify({
    callback_query: {
      data: "murph:group:join",
      from: { first_name: "Member", id: 4242, is_bot: false },
      id: "cbq_1",
      message: {
        chat: { id: -100777, type: "supergroup" },
        message_id: 55,
        message_thread_id: 9,
      },
    },
    update_id: 7,
  }));

  assert.equal(update.callback_query?.id, "cbq_1");
  assert.equal(update.callback_query?.data, "murph:group:join");
  assert.equal(update.callback_query?.from.id, 4242);
  assert.equal(update.callback_query?.message?.chat.id, -100777);
  assert.equal(update.callback_query?.message?.message_id, 55);
  // The topic must survive so a tap resolves to the same thread as the card.
  assert.equal(
    buildTelegramThreadId(update.callback_query!.message!),
    "-100777:topic:9",
  );
});

test("parseTelegramWebhookUpdate rejects malformed callback identities", () => {
  const cases = [
    { callback_query: { from: { id: 1 }, id: "" }, update_id: 1 },
    { callback_query: { from: { id: 1 } }, update_id: 1 },
    { callback_query: { from: {}, id: "cbq" }, update_id: 1 },
    { callback_query: { id: "cbq" }, update_id: 1 },
    {
      callback_query: {
        from: { id: 1 },
        id: "cbq",
        message: { chat: {}, message_id: 5 },
      },
      update_id: 1,
    },
    {
      callback_query: {
        from: { id: 1 },
        id: "cbq",
        message: { chat: { id: -1 } },
      },
      update_id: 1,
    },
  ];

  for (const payload of cases) {
    assert.throws(
      () => parseTelegramWebhookUpdate(JSON.stringify(payload)),
      TypeError,
      `expected rejection for ${JSON.stringify(payload)}`,
    );
  }
});

test("parseTelegramWebhookUpdate leaves ordinary message updates alone", () => {
  const update = parseTelegramWebhookUpdate(JSON.stringify({
    message: { chat: { id: 5, type: "private" }, message_id: 1, text: "hi" },
    update_id: 8,
  }));

  assert.equal(update.callback_query, undefined);
  assert.equal(update.message?.text, "hi");
});
