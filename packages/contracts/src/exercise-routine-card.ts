import * as z from "./zod-runtime.ts";

export const exerciseRoutineCardV1Bounds = {
  exerciseCount: 8,
  exerciseSeconds: 900,
  fallbackTextLength: 4_096,
  imageAltLength: 500,
  imageCount: 8,
  instructionCount: 3,
  textLength: 160,
  totalSeconds: 3_600,
  transitionSeconds: 600,
} as const;

export type ExerciseRoutineCardImageV1 = {
  alt: string;
  source: string;
  step: string;
  url: string;
};

export type ExerciseRoutineCardExerciseV1 = {
  dose: string;
  estimatedSeconds: number;
  images: ExerciseRoutineCardImageV1[];
  instructions: string[];
  name: string;
};

export type ExerciseRoutineResponseCardV1 = {
  exercises: ExerciseRoutineCardExerciseV1[];
  footer: string | null;
  intensity: string;
  kind: "exercise_routine";
  labels: {
    dose: string;
    exercise: string;
    time: string;
    visualGuide: string;
  };
  safety: string;
  subtitle: string | null;
  title: string;
  totalSeconds: number;
  transitionSeconds: number;
  version: 1;
};

export function renderExerciseRoutineResponseCardTextV1(
  card: ExerciseRoutineResponseCardV1,
): string {
  const heading = card.subtitle === null
    ? card.title
    : `${card.title} — ${card.subtitle}`;
  const exercises = card.exercises.flatMap((exercise, index) => [
    "",
    `${index + 1}. ${exercise.name} — ${exercise.dose} (${formatExerciseRoutineDurationV1(exercise.estimatedSeconds)})`,
    ...exercise.instructions.map((instruction) => `   • ${instruction}`),
  ]);
  const footer = card.footer === null ? [] : ["", card.footer];
  return [
    heading,
    `${card.intensity} · ${formatExerciseRoutineDurationV1(card.totalSeconds)}`,
    ...exercises,
    "",
    `⚠️ ${card.safety}`,
    ...footer,
  ].join("\n");
}

function formatExerciseRoutineDurationV1(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0
    ? `${minutes} min`
    : `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

const boundedTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(exerciseRoutineCardV1Bounds.textLength);

const boundedImageAltSchema = z
  .string()
  .trim()
  .min(1)
  .max(exerciseRoutineCardV1Bounds.imageAltLength);

export const exerciseRoutineCardImageV1Schema: z.ZodType<
  ExerciseRoutineCardImageV1
> = z
  .object({
    alt: boundedImageAltSchema,
    source: z
      .string()
      .regex(/^exercise_catalog:[A-Za-z0-9][A-Za-z0-9_-]*:[1-8]$/u)
      .max(exerciseRoutineCardV1Bounds.textLength),
    step: boundedTextSchema,
    url: z.string().url().max(500).refine((value) => value.startsWith("https://"), {
      message: "Exercise routine image URLs must use HTTPS.",
    }),
  })
  .strict();

export const exerciseRoutineCardExerciseV1Schema: z.ZodType<
  ExerciseRoutineCardExerciseV1
> = z
  .object({
    dose: boundedTextSchema,
    estimatedSeconds: z
      .number()
      .int()
      .positive()
      .max(exerciseRoutineCardV1Bounds.exerciseSeconds),
    images: z
      .array(exerciseRoutineCardImageV1Schema)
      .max(exerciseRoutineCardV1Bounds.imageCount),
    instructions: z
      .array(boundedTextSchema)
      .min(1)
      .max(exerciseRoutineCardV1Bounds.instructionCount),
    name: boundedTextSchema,
  })
  .strict();

export const exerciseRoutineResponseCardV1Schema: z.ZodType<
  ExerciseRoutineResponseCardV1
> = z
  .object({
    exercises: z
      .array(exerciseRoutineCardExerciseV1Schema)
      .min(1)
      .max(exerciseRoutineCardV1Bounds.exerciseCount),
    footer: boundedTextSchema.nullable(),
    intensity: boundedTextSchema,
    kind: z.literal("exercise_routine"),
    labels: z
      .object({
        dose: boundedTextSchema,
        exercise: boundedTextSchema,
        time: boundedTextSchema,
        visualGuide: boundedTextSchema,
      })
      .strict(),
    safety: boundedTextSchema,
    subtitle: boundedTextSchema.nullable(),
    title: boundedTextSchema,
    totalSeconds: z
      .number()
      .int()
      .positive()
      .max(exerciseRoutineCardV1Bounds.totalSeconds),
    transitionSeconds: z
      .number()
      .int()
      .nonnegative()
      .max(exerciseRoutineCardV1Bounds.transitionSeconds),
    version: z.literal(1),
  })
  .strict()
  .superRefine((card, context) => {
    const exerciseSeconds = card.exercises.reduce(
      (total, exercise) => total + exercise.estimatedSeconds,
      0,
    );
    if (exerciseSeconds + card.transitionSeconds !== card.totalSeconds) {
      context.addIssue({
        code: "custom",
        message:
          "totalSeconds must equal exercise time plus transitionSeconds.",
        path: ["totalSeconds"],
      });
    }

    const imageCount = card.exercises.reduce(
      (total, exercise) => total + exercise.images.length,
      0,
    );
    if (imageCount > exerciseRoutineCardV1Bounds.imageCount) {
      context.addIssue({
        code: "custom",
        message: `A routine can include at most ${exerciseRoutineCardV1Bounds.imageCount} images.`,
        path: ["exercises"],
      });
    }

    if (
      renderExerciseRoutineResponseCardTextV1(card).length >
      exerciseRoutineCardV1Bounds.fallbackTextLength
    ) {
      context.addIssue({
        code: "custom",
        message: `Exercise routine text fallback must fit ${exerciseRoutineCardV1Bounds.fallbackTextLength} characters.`,
        path: ["exercises"],
      });
    }
  });
