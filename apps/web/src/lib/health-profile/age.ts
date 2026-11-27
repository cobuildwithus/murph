import { isYouAgePinCurrent, readYouAgeForPin } from "../health-you/read";

export const profileAge = { read: readYouAgeForPin, current: isYouAgePinCurrent };
