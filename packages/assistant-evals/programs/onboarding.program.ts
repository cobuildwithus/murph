import {
  currentMurphOnboardingTarget,
  onboardingScenarios,
} from "../src/onboarding.js";
import { defineEvalProgram } from "../src/program.js";
import { createEvalScenarioRegistry } from "../src/registry.js";

export default defineEvalProgram({
  id: "onboarding",
  description:
    "Synthetic onboarding episodes against the current Murph assistant.",
  registry: createEvalScenarioRegistry(onboardingScenarios),
  targets: [currentMurphOnboardingTarget],
});
