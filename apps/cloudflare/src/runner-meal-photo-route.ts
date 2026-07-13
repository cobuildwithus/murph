const HOSTED_MEAL_PHOTO_KEY_PATTERN = /^[a-f0-9]{40}$/u;

export const HOSTED_EXECUTION_RUNNER_MEAL_PHOTO_PATH_PREFIX = "/meal-photos";

export function buildHostedExecutionRunnerMealPhotoPath(mealPhotoKey: string): string {
  if (!HOSTED_MEAL_PHOTO_KEY_PATTERN.test(mealPhotoKey)) {
    throw new TypeError("Hosted meal photo key is invalid.");
  }
  return `${HOSTED_EXECUTION_RUNNER_MEAL_PHOTO_PATH_PREFIX}/${mealPhotoKey}`;
}

export function matchHostedExecutionRunnerMealPhotoPath(pathname: string): string | null {
  const match = /^\/meal-photos\/(?<mealPhotoKey>[a-f0-9]{40})$/u.exec(pathname);
  return match?.groups?.mealPhotoKey ?? null;
}
