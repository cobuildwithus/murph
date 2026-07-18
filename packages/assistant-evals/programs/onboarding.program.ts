import {
  currentMurphOnboardingTarget,
  onboardingScenarios,
} from "../src/onboarding.js";
import { defineEvalProgram } from "../src/program.js";

export default defineEvalProgram({
  id: "onboarding",
  description:
    "Synthetic onboarding episodes against the current Murph assistant.",
  scenarios: onboardingScenarios,
  targets: [currentMurphOnboardingTarget],
});
