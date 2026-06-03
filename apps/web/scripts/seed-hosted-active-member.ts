import { seedHostedActiveMember } from "../test/support/hosted-member-seeds";

const memberId = process.env.MURPH_E2E_MEMBER_ID?.trim() || "";

async function main(): Promise<void> {
  await seedHostedActiveMember({ memberId });
}

void main();
