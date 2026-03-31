import { PrismaClient } from "@prisma/client";

import { isUniqueViolation } from "./prisma-errors";

export class PrismaHostedBrowserAssertionNonceStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async consumeBrowserAssertionNonce(input: {
    nonceHash: string;
    userId: string;
    method: string;
    path: string;
    now: string;
    expiresAt: string;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.deviceBrowserAssertionNonce.deleteMany({
        where: {
          expiresAt: {
            lte: new Date(input.now),
          },
        },
      });

      try {
        await tx.deviceBrowserAssertionNonce.create({
          data: {
            nonceHash: input.nonceHash,
            userId: input.userId,
            method: input.method,
            path: input.path,
            createdAt: new Date(input.now),
            expiresAt: new Date(input.expiresAt),
          },
        });
        return true;
      } catch (error) {
        if (isUniqueViolation(error)) {
          return false;
        }

        throw error;
      }
    });
  }
}
