import type { PrismaClient } from "@prisma/client";
import type { HostedMailboxLane } from "@murphai/hosted-execution/runtime-control";

interface HostedMailboxLaneCounterStoreClient {
  hostedMailboxLaneCounter: PrismaClient["hostedMailboxLaneCounter"];
}

export async function advanceHostedMailboxLaneConsumedSeq(input: {
  consumedSeq: bigint;
  lane: HostedMailboxLane;
  prisma: HostedMailboxLaneCounterStoreClient;
  userId: string;
}): Promise<bigint> {
  const row = await input.prisma.hostedMailboxLaneCounter.findUnique({
    where: {
      userId_lane: {
        lane: input.lane,
        userId: input.userId,
      },
    },
  });
  if (!row) {
    return 0n;
  }

  // Never acknowledge beyond the lane's append high-water, and never let a
  // late or replayed acknowledgement move the durable watermark backwards.
  const maxConsumableSeq = row.nextSeq - 1n;
  const consumedSeq = input.consumedSeq < maxConsumableSeq
    ? input.consumedSeq
    : maxConsumableSeq;
  if (consumedSeq > row.consumedSeq) {
    await input.prisma.hostedMailboxLaneCounter.updateMany({
      data: {
        consumedSeq,
      },
      where: {
        consumedSeq: {
          lt: consumedSeq,
        },
        lane: input.lane,
        userId: input.userId,
      },
    });
  }

  const updated = await input.prisma.hostedMailboxLaneCounter.findUnique({
    where: {
      userId_lane: {
        lane: input.lane,
        userId: input.userId,
      },
    },
  });
  return updated?.consumedSeq ?? row.consumedSeq;
}
