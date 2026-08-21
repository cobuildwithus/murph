export type EnvironmentVoiceLanguage = {
  code: string;
  label: string;
  nativeLabel: string;
};

export const ENVIRONMENT_VOICE_LANGUAGES: readonly EnvironmentVoiceLanguage[] = [
  { code: "af", label: "Afrikaans", nativeLabel: "Afrikaans" },
  { code: "ar", label: "Arabic", nativeLabel: "العربية" },
  { code: "bn", label: "Bengali", nativeLabel: "বাংলা" },
  { code: "bg", label: "Bulgarian", nativeLabel: "Български" },
  { code: "ca", label: "Catalan", nativeLabel: "Català" },
  { code: "zh", label: "Chinese", nativeLabel: "中文" },
  { code: "hr", label: "Croatian", nativeLabel: "Hrvatski" },
  { code: "cs", label: "Czech", nativeLabel: "Čeština" },
  { code: "da", label: "Danish", nativeLabel: "Dansk" },
  { code: "nl", label: "Dutch", nativeLabel: "Nederlands" },
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "et", label: "Estonian", nativeLabel: "Eesti" },
  { code: "fi", label: "Finnish", nativeLabel: "Suomi" },
  { code: "fr", label: "French", nativeLabel: "Français" },
  { code: "de", label: "German", nativeLabel: "Deutsch" },
  { code: "el", label: "Greek", nativeLabel: "Ελληνικά" },
  { code: "he", label: "Hebrew", nativeLabel: "עברית" },
  { code: "hi", label: "Hindi", nativeLabel: "हिन्दी" },
  { code: "hu", label: "Hungarian", nativeLabel: "Magyar" },
  { code: "is", label: "Icelandic", nativeLabel: "Íslenska" },
  { code: "id", label: "Indonesian", nativeLabel: "Bahasa Indonesia" },
  { code: "it", label: "Italian", nativeLabel: "Italiano" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語" },
  { code: "ko", label: "Korean", nativeLabel: "한국어" },
  { code: "lv", label: "Latvian", nativeLabel: "Latviešu" },
  { code: "lt", label: "Lithuanian", nativeLabel: "Lietuvių" },
  { code: "ms", label: "Malay", nativeLabel: "Bahasa Melayu" },
  { code: "no", label: "Norwegian", nativeLabel: "Norsk" },
  { code: "fa", label: "Persian", nativeLabel: "فارسی" },
  { code: "pl", label: "Polish", nativeLabel: "Polski" },
  { code: "pt", label: "Portuguese", nativeLabel: "Português" },
  { code: "ro", label: "Romanian", nativeLabel: "Română" },
  { code: "ru", label: "Russian", nativeLabel: "Русский" },
  { code: "sr", label: "Serbian", nativeLabel: "Српски" },
  { code: "sk", label: "Slovak", nativeLabel: "Slovenčina" },
  { code: "sl", label: "Slovenian", nativeLabel: "Slovenščina" },
  { code: "es", label: "Spanish", nativeLabel: "Español" },
  { code: "sw", label: "Swahili", nativeLabel: "Kiswahili" },
  { code: "sv", label: "Swedish", nativeLabel: "Svenska" },
  { code: "ta", label: "Tamil", nativeLabel: "தமிழ்" },
  { code: "th", label: "Thai", nativeLabel: "ไทย" },
  { code: "tr", label: "Turkish", nativeLabel: "Türkçe" },
  { code: "uk", label: "Ukrainian", nativeLabel: "Українська" },
  { code: "ur", label: "Urdu", nativeLabel: "اردو" },
  { code: "vi", label: "Vietnamese", nativeLabel: "Tiếng Việt" },
];

export function findEnvironmentVoiceLanguage(
  code: string | null | undefined,
): EnvironmentVoiceLanguage | null {
  if (!code) {
    return null;
  }
  const normalizedCode = code.trim().toLowerCase().split("-")[0];
  return ENVIRONMENT_VOICE_LANGUAGES.find(
    (language) => language.code === normalizedCode,
  ) ?? null;
}
