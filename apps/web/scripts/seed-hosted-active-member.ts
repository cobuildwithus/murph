import { getPrisma } from "../src/lib/prisma";
import { createHostedMember } from "../src/lib/hosted-onboarding/hosted-member-store";

const memberId = process.env.MURPH_E2E_MEMBER_ID?.trim() || "";

async function main(): Promise<void> {
  if (!memberId) {
    throw new Error("Hosted member seed requires MURPH_E2E_MEMBER_ID.");
  }

  const prisma = getPrisma();

  try {
    await createHostedMember({
      billingStatus: "active",
      memberId,
      prisma,
    });
  } finally {
    await prisma.$disconnect();
  }
}

void main();
