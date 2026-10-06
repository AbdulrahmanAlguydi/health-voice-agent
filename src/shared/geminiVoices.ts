// Google's curated Live voice catalog:
// https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/live-api/configure-language-voice
export const GEMINI_VOICES = [
  { name: "Zephyr", descriptionEn: "Bright", descriptionAr: "مشرق" },
  { name: "Puck", descriptionEn: "Upbeat", descriptionAr: "مرح" },
  { name: "Charon", descriptionEn: "Informative", descriptionAr: "توضيحي" },
  { name: "Kore", descriptionEn: "Firm", descriptionAr: "حازم" },
  { name: "Fenrir", descriptionEn: "Excitable", descriptionAr: "حماسي" },
  { name: "Leda", descriptionEn: "Youthful", descriptionAr: "شبابي" },
  { name: "Orus", descriptionEn: "Firm", descriptionAr: "حازم" },
  { name: "Aoede", descriptionEn: "Breezy", descriptionAr: "خفيف" },
  { name: "Callirrhoe", descriptionEn: "Easy-going", descriptionAr: "مريح" },
  { name: "Autonoe", descriptionEn: "Bright", descriptionAr: "مشرق" },
  { name: "Enceladus", descriptionEn: "Breathy", descriptionAr: "ناعم بنَفَس" },
  { name: "Iapetus", descriptionEn: "Clear", descriptionAr: "واضح" },
  { name: "Umbriel", descriptionEn: "Easy-going", descriptionAr: "مريح" },
  { name: "Algieba", descriptionEn: "Smooth", descriptionAr: "سلس" },
  { name: "Despina", descriptionEn: "Smooth", descriptionAr: "سلس" },
  { name: "Erinome", descriptionEn: "Clear", descriptionAr: "واضح" },
  { name: "Algenib", descriptionEn: "Gravelly", descriptionAr: "أجش" },
  { name: "Rasalgethi", descriptionEn: "Informative", descriptionAr: "توضيحي" },
  { name: "Laomedeia", descriptionEn: "Upbeat", descriptionAr: "مرح" },
  { name: "Achernar", descriptionEn: "Soft", descriptionAr: "ناعم" },
  { name: "Alnilam", descriptionEn: "Firm", descriptionAr: "حازم" },
  { name: "Schedar", descriptionEn: "Even", descriptionAr: "متزن" },
  { name: "Gacrux", descriptionEn: "Mature", descriptionAr: "ناضج" },
  { name: "Pulcherrima", descriptionEn: "Forward", descriptionAr: "مباشر" },
  { name: "Achird", descriptionEn: "Friendly", descriptionAr: "ودود" },
  { name: "Zubenelgenubi", descriptionEn: "Casual", descriptionAr: "عفوي" },
  { name: "Vindemiatrix", descriptionEn: "Gentle", descriptionAr: "لطيف" },
  { name: "Sadachbia", descriptionEn: "Lively", descriptionAr: "حيوي" },
  { name: "Sadaltager", descriptionEn: "Knowledgeable", descriptionAr: "واسع المعرفة" },
  { name: "Sulafat", descriptionEn: "Warm", descriptionAr: "دافئ" },
] as const;

export type GeminiVoiceName = typeof GEMINI_VOICES[number]["name"];
export const DEFAULT_GEMINI_VOICE: GeminiVoiceName = "Kore";

export function isGeminiVoiceName(value: unknown): value is GeminiVoiceName {
  return typeof value === "string" && GEMINI_VOICES.some(voice => voice.name === value);
}

export function resolveGeminiVoiceDefault(value: unknown): GeminiVoiceName {
  return isGeminiVoiceName(value) ? value : DEFAULT_GEMINI_VOICE;
}
