import { deriveCategoryNote, overallGrade } from "../(dashboard)/environment/category-notes";
import {
  EnvironmentPrintLoading,
  EnvironmentPrintReport,
} from "../(dashboard)/environment/environment-print-report";
import {
  type HabitatIndicatorNotes,
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
    air_purifier: "hepa",
    air_quality_meter: "combined",
    damp_or_mold: "none",
    smoke_sources: "none",
    ventilation: "mechanical",
  },
  "health-devices": {
    bp_cuff: true,
  },
  lighting: {
    daytime_light: "dim",
    evening_light: "warm_dim",
    morning_light_access: "outdoor_routine",
  },
  "sleep-environment": {
    bedding_overheating: "never",
    darkness: "blackout",
    mattress_satisfaction: "good",
    night_noise: "quiet",
    night_temp_c: 24,
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

const DESIGN_NOTES: HabitatIndicatorNotes = {
  "sleep-environment": {
    night_temp_c: "Usually 19°C, with the window closed and AC available.",
  },
  workspace: {
    screen_setup:
      "Large external display. Eyes line up with the middle of the screen.",
  },
};

export function EnvironmentPrintStudy() {
  const scene = resolveHabitatScene(DESIGN_VALUES);
  const notes = scene.categories.map((category) =>
    deriveCategoryNote(category, DESIGN_VALUES, DESIGN_NOTES),
  );

  return (
    <div
      className="space-y-10"
      data-design-section="environment-private-print"
      id="environment-private-print"
      inert
    >
      <div className="space-y-3" data-design-state="loading">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
          Loading
        </p>
        <EnvironmentPrintLoading />
      </div>
      <div className="space-y-3" data-design-state="ready">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
          Ready
        </p>
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          <EnvironmentPrintReport
            context={{ areaType: "urban center", location: "Warsaw" }}
            coverage={resolveEnvironmentCoverage(scene)}
            generatedOn="July 31, 2026"
            grade={overallGrade(notes, DESIGN_VALUES)}
            notes={notes}
          />
        </div>
      </div>
    </div>
  );
}
