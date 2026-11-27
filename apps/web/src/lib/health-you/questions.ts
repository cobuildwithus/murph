import { readCompanionClientInfo } from "../companion/client-info";
import type { Bundle, YouView } from "./contract";
import type { YouInputs } from "./evidence";
import { coef, effectiveAnswer, eligible, type Rows } from "./engine/model";

type Question = YouView["questions"][number];
const options = (...pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));
const yesNo = options(["yes", "Yes"], ["no", "No"], ["unsure", "Not sure"]);
const questions: Record<string, Question> = {
  eligibility: { key: "ageEligibility", text: "Does pregnancy or recovery after childbirth apply to you now?",
    options: options(["pregnant", "Currently pregnant"], ["postpartum", "Gave birth in the past 180 days"], ["neither", "Neither"]) },
  smoking: { key: "smoking", text: "Have you smoked at least 100 cigarettes in your life? If so, do you smoke now?",
    options: options(["never", "Fewer than 100"], ["former", "100 or more and stopped"], ["current", "100 or more and smoke now"], ["unsure", "Not sure"]) },
  quitDate: { key: "quitDate", text: "When did you last stop smoking cigarettes and stay stopped?", inputKind: "date", options: [] },
  alcohol: { key: "alcoholDrinksPerWeek", text: "How many standard drinks are typical for you in a week?", inputKind: "number", unit: "standard drinks per week", min: 0, max: 150, options: [] },
  disease: { key: "seriousDisease", text: "Has a clinician ever told you that you had heart failure, a heart attack, a stroke or cancer?", options: yesNo },
  diabetes: { key: "diabetes", text: "Have you been diagnosed with diabetes outside of pregnancy?", options: yesNo },
  health: { key: "selfRatedHealth", text: "How would you rate your overall health?",
    options: options(["excellent", "Excellent"], ["veryGood", "Very good"], ["good", "Good"], ["fair", "Fair"], ["poor", "Poor"]) },
  whoopZones: { key: "whoopZones", text: "Are your WHOOP heart rate zones set to the standard ranges?",
    options: options(["yes", "Yes"], ["no", "No"], ["notSure", "Not sure"]) },
};

export function nextQuestion(input: YouInputs, rows: Rows, optionsOnly = false, paused = false): Question[] {
  const answers = (input.evidence.checkins ?? []).filter(r => r.answerKey && eligible(r, input.asOf) && effectiveAnswer(r, input.asOf));
  if (answers.some(r => r.reported_at === input.asOf)) return [];
  const answered = new Set(answers.map(r => r.answerKey));
  const candidates: Question[] = [];
  if (input.hasAnswerProjection) {
    if (answers.some(r => r.pregnant || r.postpartum)) return [questions.eligibility];
    if (paused) return [];
    if (input.evidence.profile.sex === "female") candidates.push(questions.eligibility);
    if (answers.some(r => r.smoking === "former")) candidates.push(questions.quitDate);
    // The scorer uses squared joint coefficients for the uncertainty of missing factors.
    const factors = ["smoking", "health", "disease", "diabetes", "alcohol"]
      .filter(key => !rows[key]).sort((a, b) => Math.abs(coef[b]) - Math.abs(coef[a]));
    candidates.push(...factors.map(key => questions[key]));
  }
  if (!paused && input.needsWhoopAnswer) candidates.push(questions.whoopZones);
  return candidates.filter(q => (!optionsOnly || q.options.length > 0) && !answered.has(q.key)).slice(0, 1);
}

const TYPED_QUESTIONS_IOS_BUILD = 128;

export function questionsForClient(views: Bundle, headers?: Headers) {
  const client = headers && readCompanionClientInfo(headers);
  if (client?.platform === "ios" && Number(client.build) >= TYPED_QUESTIONS_IOS_BUILD) return views.you.questions;
  return (views.optionQuestions ?? views.you.questions).filter(q => q.options.length > 0);
}

export function keepDailyQuestions(views: Bundle, previous?: Bundle) {
  if (previous?.you.asOf !== views.you.asOf) return;
  const prior = previous.you.questions[0]?.key;
  const priorOption = (previous.optionQuestions ?? previous.you.questions)[0]?.key;
  views.you.questions = views.you.questions.filter(question => question.key === prior);
  views.optionQuestions = views.optionQuestions?.filter(question => question.key === priorOption);
}
