import { createHostedWebSmokeEnvironment } from "../next-artifacts";
import { seedHostedActiveLinqMember } from "../test/support/hosted-member-seeds";

const runtimeEnv = createHostedWebSmokeEnvironment(process.env);

const memberId = runtimeEnv.MURPH_E2E_MEMBER_ID?.trim() || "";
const memberPhone = runtimeEnv.MURPH_E2E_MEMBER_PHONE?.trim() || "";
const homePhone = runtimeEnv.MURPH_E2E_HOME_PHONE?.trim() || "";

async function main(): Promise<void> {
  await seedHostedActiveLinqMember({
    environment: runtimeEnv,
    homePhone,
    memberId,
    memberPhone,
  });
}

void main();
