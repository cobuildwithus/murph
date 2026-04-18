import { createHostedWebSmokeEnvironment } from "../next-artifacts";
import { seedHostedActiveLinqMember } from "../src/lib/hosted-onboarding/hosted-member-test-seed";

const runtimeEnv = createHostedWebSmokeEnvironment(process.env);

Object.assign(process.env, runtimeEnv);

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
