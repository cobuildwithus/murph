import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

export const GOAL_CONTACT_RESOLUTION_PATH = "/api/goals/contact";

export interface GoalContactResolution {
  option: MurphContactOption;
}
