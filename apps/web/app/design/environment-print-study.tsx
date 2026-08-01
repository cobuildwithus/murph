import { deriveCategoryNote, overallGrade } from "../(dashboard)/environment/category-notes";
import { EnvironmentPrintReport } from "../(dashboard)/environment/environment-print-report";
import {
  type HabitatValues,
  resolveEnvironmentCoverage,
  resolveHabitatScene,
} from "../(dashboard)/environment/home-model";

const DESIGN_VALUES: HabitatValues = {
  "home-location": {
    area_type: "urban_center",
    location: "Warsaw",
  },
  "home-air": {
    damp_or_mold: "none",
    smoke_sources: "none",
    ventilation: "mechanical",
  },
  lighting: {
    daytime_light: "by_window",
    evening_light: "warm_dim",
    morning_light_access: "outdoor_routine",
  },
  "sleep-environment": {
    bedding_overheating: "never",
    darkness: "blackout",
    mattress_satisfaction: "good",
    night_noise: "quiet",
    night_temp_c: 20,
    phone_by_bed: false,
    tv_in_bedroom: false,
  },
  workspace: {
    breaks: "systematic",
    chair: "ordinary",
    screen_at_eye_level: true,
    wrist_complaints: false,
  },
};

export function EnvironmentPrintStudy() {
  const scene = resolveHabitatScene(DESIGN_VALUES);
  const notes = scene.categories.map((category) =>
    deriveCategoryNote(category, DESIGN_VALUES),
  );

  return (
    <div
      className="overflow-hidden rounded-xl border border-border bg-background"
      data-design-section="environment-private-print"
      id="environment-private-print"
      inert
    >
      <EnvironmentPrintReport
        context={{ areaType: "urban center", location: "Warsaw" }}
        coverage={resolveEnvironmentCoverage(scene)}
        generatedOn="July 31, 2026"
        grade={overallGrade(notes)}
        notes={notes}
      />
    </div>
  );
}
