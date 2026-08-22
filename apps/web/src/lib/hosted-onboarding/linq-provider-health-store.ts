import { Prisma, type PrismaClient } from "@prisma/client";

import {
  createHostedLinqChatLookupKey,
  createHostedLinqChatLookupKeyReadCandidates,
} from "./contact-privacy";
import {
  createHostedLinqProviderEventLookupKey,
} from "./linq-observability-identifiers";
import {
  prepareHostedLinqLinePhones,
  type PreparedHostedLinqLinePhone,
} from "./linq-line-store";
import {
  parseHostedLinqChatHealthStatus,
  parseHostedLinqLineReputationStatus,
  parseHostedLinqLineServiceStatus,
  type HostedLinqChatHealthStatus,
} from "./linq-provider-status";
import { normalizePhoneNumber } from "./phone";
import { normalizeNullableString } from "./shared";

type HostedLinqProviderHealthClient = PrismaClient | Prisma.TransactionClient;

export const HOSTED_LINQ_CHAT_HEALTH_PROJECTION_CHUNK_SIZE = 250;
const HOSTED_LINQ_CHAT_HEALTH_CHUNK_LOCK_TIMEOUT_MS = 2_000;

export type HostedLinqChatHealthSnapshot = {
  linqChatLookupKey: string;
  phoneNumberLookupKey: string | null;
  providerObservedAt: Date;
  providerStatus: HostedLinqChatHealthStatus;
  providerUpdatedAt: Date;
};

export type HostedLinqChatHealthInventoryProjectionInput = {
  chatId: string;
  isGroup: boolean | null;
  linePhoneNumber: string | null;
  providerStatus: HostedLinqChatHealthStatus;
  providerUpdatedAt: Date;
  service: string | null;
};

export type PreparedHostedLinqChatHealthInventoryProjection = {
  currentLookupKey: string;
  isGroup: boolean | null;
  line: PreparedHostedLinqLinePhone | null;
  lookupKeyReadCandidates: readonly string[];
  projectsChatHealth: boolean;
  providerStatus: HostedLinqChatHealthStatus;
  providerUpdatedAt: Date;
  service: string | null;
};

export async function projectHostedLinqLineProviderStateTx(input: {
  eventId?: string | null;
  observedAt?: Date;
  phoneNumberLookupKey: string;
  prisma: HostedLinqProviderHealthClient;
  providerUpdatedAt?: Date | null;
  reputationStatus?: unknown;
  serviceStatus?: unknown;
}): Promise<boolean> {
  const phoneNumberLookupKey = normalizeNullableString(input.phoneNumberLookupKey);
  const serviceStatus = parseHostedLinqLineServiceStatus(input.serviceStatus);
  const reputationStatus = parseHostedLinqLineReputationStatus(input.reputationStatus);
  if (
    !phoneNumberLookupKey
    || (!serviceStatus && !reputationStatus)
  ) {
    return false;
  }

  const providerObservedAt = input.observedAt ?? new Date();
  const providerUpdatedAt = input.providerUpdatedAt ?? providerObservedAt;
  const lastStatusEventId = input.eventId
    ? createHostedLinqProviderEventLookupKey(input.eventId)
    : null;
  const serviceSameTimestampWhere: Prisma.HostedLinqLineWhereInput[] =
    lastStatusEventId
      ? [
          {
            providerServiceUpdatedAt: providerUpdatedAt,
            OR: [
              { lastServiceStatusEventId: null },
              { lastServiceStatusEventId: { lt: lastStatusEventId } },
            ],
          },
        ]
      : [];
  const reputationSameTimestampWhere: Prisma.HostedLinqLineWhereInput[] =
    lastStatusEventId
      ? [
          {
            providerReputationUpdatedAt: providerUpdatedAt,
            OR: [
              { lastReputationStatusEventId: null },
              { lastReputationStatusEventId: { lt: lastStatusEventId } },
            ],
          },
        ]
      : [];
  const serviceUpdated = serviceStatus
    ? await input.prisma.hostedLinqLine.updateMany({
        data: {
          lastServiceStatusEventId: lastStatusEventId,
          providerServiceStatus: serviceStatus,
          providerServiceUpdatedAt: providerUpdatedAt,
        },
        where: {
          phoneNumberLookupKey,
          OR: [
            { providerServiceUpdatedAt: null },
            { providerServiceUpdatedAt: { lt: providerUpdatedAt } },
            ...serviceSameTimestampWhere,
          ],
        },
      })
    : { count: 0 };
  const reputationUpdated = reputationStatus
    ? await input.prisma.hostedLinqLine.updateMany({
        data: {
          lastReputationStatusEventId: lastStatusEventId,
          providerReputationStatus: reputationStatus,
          providerReputationUpdatedAt: providerUpdatedAt,
        },
        where: {
          phoneNumberLookupKey,
          OR: [
            { providerReputationUpdatedAt: null },
            { providerReputationUpdatedAt: { lt: providerUpdatedAt } },
            ...reputationSameTimestampWhere,
          ],
        },
      })
    : { count: 0 };

  await input.prisma.hostedLinqLine.updateMany({
    data: {
      providerLastSeenAt: providerObservedAt,
      providerSeenAt: providerObservedAt,
    },
    where: {
      phoneNumberLookupKey,
      OR: [
        { providerLastSeenAt: null },
        { providerLastSeenAt: { lt: providerObservedAt } },
      ],
    },
  });
  return serviceUpdated.count === 1 || reputationUpdated.count === 1;
}

export async function projectHostedLinqChatHealthTx(input: {
  chatId: string | null | undefined;
  observedAt?: Date;
  phoneNumberLookupKey?: string | null;
  prisma: HostedLinqProviderHealthClient;
  providerStatus: unknown;
  providerUpdatedAt: Date;
  isGroup?: boolean | null;
  service?: string | null;
}): Promise<boolean> {
  const currentLookupKey = createHostedLinqChatLookupKey(input.chatId);
  const lookupKeyCandidates = createHostedLinqChatLookupKeyReadCandidates(input.chatId);
  const providerStatus = parseHostedLinqChatHealthStatus(input.providerStatus);
  if (
    !currentLookupKey
    || lookupKeyCandidates.length === 0
    || !providerStatus
    || Number.isNaN(input.providerUpdatedAt.getTime())
  ) {
    return false;
  }

  const existing = await input.prisma.hostedLinqChatHealth.findMany({
    select: { linqChatLookupKey: true },
    where: {
      linqChatLookupKey: { in: lookupKeyCandidates },
    },
  });
  const existingKeys = new Set(existing.map((row) => row.linqChatLookupKey));
  const linqChatLookupKey = existingKeys.has(currentLookupKey)
    ? currentLookupKey
    : lookupKeyCandidates.find((candidate) => existingKeys.has(candidate))
      ?? currentLookupKey;
  const providerObservedAt = input.observedAt ?? new Date();
  const phoneNumberLookupKeySupplied =
    input.phoneNumberLookupKey !== undefined;
  const phoneNumberLookupKey = normalizeNullableString(
    input.phoneNumberLookupKey ?? null,
  );
  if (existingKeys.size === 0) {
    const created = await input.prisma.hostedLinqChatHealth.createMany({
      data: {
        linqChatLookupKey: currentLookupKey,
        phoneNumberLookupKey,
        providerObservedAt,
        providerStatus,
        providerUpdatedAt: input.providerUpdatedAt,
        isGroup: input.isGroup ?? null,
        service: normalizeNullableString(input.service ?? null),
      } satisfies Prisma.HostedLinqChatHealthCreateManyInput,
      skipDuplicates: true,
    });
    if (created.count === 1) {
      return true;
    }
  }

  const updated = await input.prisma.hostedLinqChatHealth.updateMany({
    data: {
      ...(linqChatLookupKey !== currentLookupKey
        ? { linqChatLookupKey: currentLookupKey }
        : {}),
      ...(phoneNumberLookupKeySupplied ? { phoneNumberLookupKey } : {}),
      providerObservedAt,
      providerStatus,
      providerUpdatedAt: input.providerUpdatedAt,
      ...(input.isGroup === undefined ? {} : { isGroup: input.isGroup }),
      ...(input.service === undefined
        ? {}
        : { service: normalizeNullableString(input.service) }),
    },
    where: {
      linqChatLookupKey,
      providerUpdatedAt: { lte: input.providerUpdatedAt },
    },
  });
  return updated.count === 1;
}

/**
 * Freezes privacy-derived lookup candidates and encrypted line material for one
 * complete provider inventory before any database statement begins. Provider
 * order is retained while one global winner is frozen for every logical chat.
 * Every duplicate still carries its line observation, but only the newest
 * provider timestamp (and the later provider row on an equal timestamp) may
 * project chat health. This makes independently committed chunks replay-safe.
 */
export function prepareHostedLinqChatHealthInventoryProjection(
  chats: readonly HostedLinqChatHealthInventoryProjectionInput[],
): PreparedHostedLinqChatHealthInventoryProjection[] {
  type PreparedChatWithoutLine = Omit<
    PreparedHostedLinqChatHealthInventoryProjection,
    "line" | "projectsChatHealth"
  > & { linePhoneNumber: string | null };

  const preparedChats: PreparedChatWithoutLine[] = chats.map((chat) => {
    const currentLookupKey = createHostedLinqChatLookupKey(chat.chatId);
    const lookupKeyReadCandidates =
      createHostedLinqChatLookupKeyReadCandidates(chat.chatId);
    const providerStatus = parseHostedLinqChatHealthStatus(chat.providerStatus);
    if (
      !currentLookupKey
      || lookupKeyReadCandidates.length === 0
      || !providerStatus
      || Number.isNaN(chat.providerUpdatedAt.getTime())
    ) {
      throw new TypeError(
        "Hosted Linq chat-health inventory requires valid parsed chat records.",
      );
    }

    return {
      currentLookupKey,
      isGroup: chat.isGroup,
      linePhoneNumber: chat.linePhoneNumber,
      lookupKeyReadCandidates,
      providerStatus,
      providerUpdatedAt: chat.providerUpdatedAt,
      service: normalizeNullableString(chat.service),
    };
  });

  const linePhoneNumbers = [
    ...new Set(preparedChats.flatMap((chat) =>
      chat.linePhoneNumber ? [chat.linePhoneNumber] : []
    )),
  ];
  const preparedLines = prepareHostedLinqLinePhones({
    maxLines: preparedChats.length,
    phoneNumbers: linePhoneNumbers,
  });
  const lineByPhoneNumber = new Map(
    preparedLines.map((line) => [line.normalizedPhoneNumber, line]),
  );
  const winningChatIndexByLookupKey = new Map<string, number>();
  for (const [index, chat] of preparedChats.entries()) {
    const existingIndex = winningChatIndexByLookupKey.get(chat.currentLookupKey);
    const existing = existingIndex === undefined
      ? null
      : preparedChats[existingIndex] ?? null;
    if (
      !existing
      || existing.providerUpdatedAt.getTime() <= chat.providerUpdatedAt.getTime()
    ) {
      winningChatIndexByLookupKey.set(chat.currentLookupKey, index);
    }
  }

  return preparedChats.map(({ linePhoneNumber, ...chat }, index) => {
    const normalizedLinePhoneNumber = normalizePhoneNumber(linePhoneNumber);
    return {
      ...chat,
      line: normalizedLinePhoneNumber
        ? lineByPhoneNumber.get(normalizedLinePhoneNumber) ?? null
        : null,
      projectsChatHealth:
        winningChatIndexByLookupKey.get(chat.currentLookupKey) === index,
    };
  });
}

/**
 * Applies one bounded chat-health inventory chunk under canonical chat/line
 * locks. Callers deliberately sequence chunks without an encompassing
 * transaction so a provider-wide retry can replay committed chunks
 * idempotently.
 */
export async function projectHostedLinqChatHealthInventoryChunk(input: {
  chats: readonly PreparedHostedLinqChatHealthInventoryProjection[];
  observedAt: Date;
  prisma: PrismaClient;
}): Promise<number> {
  if (input.chats.length === 0) {
    return 0;
  }
  if (input.chats.length > HOSTED_LINQ_CHAT_HEALTH_PROJECTION_CHUNK_SIZE) {
    throw new RangeError(
      `Hosted Linq chat-health projection requires at most ${HOSTED_LINQ_CHAT_HEALTH_PROJECTION_CHUNK_SIZE} chat(s) per chunk.`,
    );
  }
  if (!input.chats.some((chat) => chat.projectsChatHealth || chat.line)) {
    return 0;
  }

  return input.prisma.$transaction(async (tx) => {
    await acquireHostedLinqChatHealthInventoryChunkLocksTx(tx, input.chats);
    const rows = await tx.$queryRaw<Array<{ syncedCount: bigint }>>(
      buildHostedLinqChatHealthInventoryChunkQuery(input),
    );
    return Number(rows[0]?.syncedCount ?? 0);
  }, { maxWait: 5_000, timeout: 15_000 });
}

async function acquireHostedLinqChatHealthInventoryChunkLocksTx(
  tx: Prisma.TransactionClient,
  chats: readonly PreparedHostedLinqChatHealthInventoryProjection[],
): Promise<void> {
  const lockValues = [...new Set(chats.flatMap((chat) => [
    ...(chat.projectsChatHealth
      ? chat.lookupKeyReadCandidates.map((lookupKey) => `chat:${lookupKey}`)
      : []),
    ...(chat.line
      ? chat.line.lookupKeyReadCandidates.map((lookupKey) => `line:${lookupKey}`)
      : []),
  ]))].sort();
  await tx.$executeRaw(Prisma.sql`
    WITH lock_budget AS MATERIALIZED (
      SELECT set_config(
        'lock_timeout',
        ${`${HOSTED_LINQ_CHAT_HEALTH_CHUNK_LOCK_TIMEOUT_MS}ms`},
        true
      )
    ),
    ordered_locks AS MATERIALIZED (
      SELECT lock_value
      FROM unnest(ARRAY[${Prisma.join(lockValues)}]::text[])
        AS inventory_lock(lock_value)
      ORDER BY lock_value
    )
    SELECT pg_advisory_xact_lock(
      hashtext('hosted_linq_chat_health_inventory'),
      hashtext(lock_value)
    )
    FROM ordered_locks
    CROSS JOIN lock_budget
    ORDER BY lock_value
  `);
}

function buildHostedLinqChatHealthInventoryChunkQuery(input: {
  chats: readonly PreparedHostedLinqChatHealthInventoryProjection[];
  observedAt: Date;
}): Prisma.Sql {
  const observedAt = Prisma.sql`${input.observedAt}::timestamp`;
  const linesByCurrentLookupKey = new Map<string, PreparedHostedLinqLinePhone>();
  for (const chat of input.chats) {
    if (chat.line) {
      linesByCurrentLookupKey.set(chat.line.currentLookupKey, chat.line);
    }
  }
  const lines = [...linesByCurrentLookupKey.values()].sort((left, right) =>
    left.currentLookupKey.localeCompare(right.currentLookupKey)
  );
  const chats = input.chats.filter((chat) => chat.projectsChatHealth);
  const inputLineRows = lines.length > 0
    ? Prisma.sql`VALUES ${Prisma.join(lines.map((line) => Prisma.sql`(
        ${line.currentLookupKey}::text,
        ARRAY[${Prisma.join(line.lookupKeyReadCandidates)}]::text[],
        ${line.phoneNumberEncrypted}::text,
        ${line.phoneNumberHint}::text
      )`))}`
    : Prisma.sql`
        SELECT
          NULL::text,
          ARRAY[]::text[],
          NULL::text,
          NULL::text
        WHERE FALSE
      `;
  const inputChatRows = chats.length > 0
    ? Prisma.sql`VALUES ${Prisma.join(chats.map((chat) => Prisma.sql`(
        ${chat.currentLookupKey}::text,
        ARRAY[${Prisma.join(chat.lookupKeyReadCandidates)}]::text[],
        ${chat.line?.currentLookupKey ?? null}::text,
        ${chat.providerStatus}::text,
        ${chat.providerUpdatedAt}::timestamp,
        ${chat.isGroup}::boolean,
        ${chat.service}::text
      )`))}`
    : Prisma.sql`
        SELECT
          NULL::text,
          ARRAY[]::text[],
          NULL::text,
          NULL::text,
          NULL::timestamp,
          NULL::boolean,
          NULL::text
        WHERE FALSE
      `;

  return Prisma.sql`
    WITH input_line (
      current_lookup_key,
      lookup_key_candidates,
      phone_number_encrypted,
      phone_number_hint
    ) AS (
      ${inputLineRows}
    ),
    resolved_line AS MATERIALIZED (
      SELECT
        input.current_lookup_key,
        COALESCE(existing.phone_number_lookup_key, input.current_lookup_key)
          AS target_lookup_key,
        input.phone_number_encrypted,
        input.phone_number_hint
      FROM input_line AS input
      LEFT JOIN LATERAL (
        SELECT line.phone_number_lookup_key
        FROM unnest(input.lookup_key_candidates) WITH ORDINALITY
          AS candidate(lookup_key, candidate_ordinal)
        INNER JOIN hosted_linq_line AS line
          ON line.phone_number_lookup_key = candidate.lookup_key
        ORDER BY
          (line.phone_number_lookup_key = input.current_lookup_key) DESC,
          candidate.candidate_ordinal
        LIMIT 1
      ) AS existing ON TRUE
    ),
    upserted_line AS (
      INSERT INTO hosted_linq_line (
        phone_number_lookup_key,
        phone_number_encrypted,
        phone_number_hint,
        source,
        configured_at,
        provider_seen_at,
        provider_first_seen_at,
        provider_last_seen_at,
        health_status,
        egress_policy,
        assignment_weight,
        created_at,
        updated_at
      )
      SELECT
        resolved.target_lookup_key,
        resolved.phone_number_encrypted,
        resolved.phone_number_hint,
        'provider',
        NULL,
        ${observedAt},
        ${observedAt},
        ${observedAt},
        'unknown',
        'enabled',
        100,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM resolved_line AS resolved
      ORDER BY resolved.current_lookup_key
      ON CONFLICT (phone_number_lookup_key) DO UPDATE SET
        phone_number_encrypted = EXCLUDED.phone_number_encrypted,
        phone_number_hint = EXCLUDED.phone_number_hint,
        provider_seen_at = GREATEST(
          hosted_linq_line.provider_seen_at,
          EXCLUDED.provider_seen_at
        ),
        provider_first_seen_at = COALESCE(
          hosted_linq_line.provider_first_seen_at,
          EXCLUDED.provider_first_seen_at
        ),
        provider_last_seen_at = GREATEST(
          hosted_linq_line.provider_last_seen_at,
          EXCLUDED.provider_last_seen_at
        ),
        updated_at = CURRENT_TIMESTAMP
      RETURNING phone_number_lookup_key
    ),
    line_write_barrier AS MATERIALIZED (
      SELECT count(*) AS line_count
      FROM upserted_line
    ),
    input_chat (
      current_lookup_key,
      lookup_key_candidates,
      line_current_lookup_key,
      provider_status,
      provider_updated_at,
      is_group,
      service
    ) AS (
      ${inputChatRows}
    ),
    resolved_chat AS MATERIALIZED (
      SELECT
        input.current_lookup_key,
        existing.linq_chat_lookup_key AS target_lookup_key,
        resolved_line.target_lookup_key AS phone_number_lookup_key,
        input.provider_status,
        input.provider_updated_at,
        input.is_group,
        input.service
      FROM input_chat AS input
      LEFT JOIN LATERAL (
        SELECT chat.linq_chat_lookup_key
        FROM unnest(input.lookup_key_candidates) WITH ORDINALITY
          AS candidate(lookup_key, candidate_ordinal)
        INNER JOIN hosted_linq_chat_health AS chat
          ON chat.linq_chat_lookup_key = candidate.lookup_key
        ORDER BY
          (chat.linq_chat_lookup_key = input.current_lookup_key) DESC,
          candidate.candidate_ordinal
        LIMIT 1
      ) AS existing ON TRUE
      LEFT JOIN resolved_line
        ON resolved_line.current_lookup_key = input.line_current_lookup_key
      CROSS JOIN line_write_barrier
    ),
    updated_chat AS (
      UPDATE hosted_linq_chat_health AS chat
      SET
        linq_chat_lookup_key = resolved.current_lookup_key,
        phone_number_lookup_key = resolved.phone_number_lookup_key,
        provider_status = resolved.provider_status,
        provider_updated_at = resolved.provider_updated_at,
        provider_observed_at = ${observedAt},
        is_group = resolved.is_group,
        service = resolved.service,
        updated_at = CURRENT_TIMESTAMP
      FROM resolved_chat AS resolved
      WHERE resolved.target_lookup_key IS NOT NULL
        AND chat.linq_chat_lookup_key = resolved.target_lookup_key
        AND (
          chat.provider_updated_at < resolved.provider_updated_at
          OR (
            chat.provider_updated_at = resolved.provider_updated_at
            AND chat.provider_observed_at <= ${observedAt}
          )
        )
      RETURNING chat.linq_chat_lookup_key
    ),
    inserted_chat AS (
      INSERT INTO hosted_linq_chat_health (
        linq_chat_lookup_key,
        phone_number_lookup_key,
        provider_status,
        provider_updated_at,
        provider_observed_at,
        is_group,
        service,
        created_at,
        updated_at
      )
      SELECT
        resolved.current_lookup_key,
        resolved.phone_number_lookup_key,
        resolved.provider_status,
        resolved.provider_updated_at,
        ${observedAt},
        resolved.is_group,
        resolved.service,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM resolved_chat AS resolved
      WHERE resolved.target_lookup_key IS NULL
      ORDER BY resolved.current_lookup_key
      ON CONFLICT (linq_chat_lookup_key) DO UPDATE SET
        phone_number_lookup_key = EXCLUDED.phone_number_lookup_key,
        provider_status = EXCLUDED.provider_status,
        provider_updated_at = EXCLUDED.provider_updated_at,
        provider_observed_at = EXCLUDED.provider_observed_at,
        is_group = EXCLUDED.is_group,
        service = EXCLUDED.service,
        updated_at = CURRENT_TIMESTAMP
      WHERE hosted_linq_chat_health.provider_updated_at
          < EXCLUDED.provider_updated_at
        OR (
          hosted_linq_chat_health.provider_updated_at
            = EXCLUDED.provider_updated_at
          AND hosted_linq_chat_health.provider_observed_at
            <= EXCLUDED.provider_observed_at
        )
      RETURNING linq_chat_lookup_key
    )
    SELECT (
      (SELECT count(*) FROM updated_chat)
      + (SELECT count(*) FROM inserted_chat)
    )::bigint AS "syncedCount"
  `;
}

export async function readHostedLinqChatHealth(input: {
  chatId: string | null | undefined;
  prisma: HostedLinqProviderHealthClient;
}): Promise<HostedLinqChatHealthSnapshot | null> {
  const lookupKeyCandidates = createHostedLinqChatLookupKeyReadCandidates(input.chatId);
  if (lookupKeyCandidates.length === 0) {
    return null;
  }

  const state = await input.prisma.hostedLinqChatHealth.findFirst({
    orderBy: [
      { providerUpdatedAt: "desc" },
      { providerObservedAt: "desc" },
    ],
    where: {
      linqChatLookupKey: { in: lookupKeyCandidates },
    },
  });
  const providerStatus = parseHostedLinqChatHealthStatus(state?.providerStatus);
  if (!state || !providerStatus) {
    return null;
  }
  return {
    linqChatLookupKey: state.linqChatLookupKey,
    phoneNumberLookupKey: state.phoneNumberLookupKey,
    providerObservedAt: state.providerObservedAt,
    providerStatus,
    providerUpdatedAt: state.providerUpdatedAt,
  };
}
