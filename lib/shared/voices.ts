export type Voice = { id: string; label: string; lang: string };

// Edge neural voices, grouped loosely by language. `lang` is the BCP-47 prefix
// so the client can suggest an OCR language (see OCR_LANG_BY_VOICE_LANG in
// lib/server/extract) and group the picker by language.
export const VOICES: Voice[] = [
  { id: "en-US-AriaNeural", label: "Aria — English (US, female)", lang: "en" },
  { id: "en-US-GuyNeural", label: "Guy — English (US, male)", lang: "en" },
  { id: "en-US-JennyNeural", label: "Jenny — English (US, female)", lang: "en" },
  { id: "en-US-AndrewNeural", label: "Andrew — English (US, male)", lang: "en" },
  { id: "en-US-EmmaNeural", label: "Emma — English (US, female)", lang: "en" },
  { id: "en-GB-SoniaNeural", label: "Sonia — English (UK, female)", lang: "en" },
  { id: "en-GB-RyanNeural", label: "Ryan — English (UK, male)", lang: "en" },
  { id: "en-AU-NatashaNeural", label: "Natasha — English (AU, female)", lang: "en" },
  { id: "en-IN-NeerjaNeural", label: "Neerja — English (India, female)", lang: "en" },
  { id: "zh-CN-XiaoxiaoNeural", label: "Xiaoxiao — Chinese (Mandarin, female)", lang: "zh" },
  { id: "zh-CN-YunxiNeural", label: "Yunxi — Chinese (Mandarin, male)", lang: "zh" },
  { id: "zh-TW-HsiaoChenNeural", label: "HsiaoChen — Chinese (Taiwan, female)", lang: "zh" },
  { id: "es-ES-ElviraNeural", label: "Elvira — Spanish (Spain, female)", lang: "es" },
  { id: "es-MX-DaliaNeural", label: "Dalia — Spanish (Mexico, female)", lang: "es" },
  { id: "fr-FR-DeniseNeural", label: "Denise — French (female)", lang: "fr" },
  { id: "fr-FR-HenriNeural", label: "Henri — French (male)", lang: "fr" },
  { id: "de-DE-KatjaNeural", label: "Katja — German (female)", lang: "de" },
  { id: "de-DE-ConradNeural", label: "Conrad — German (male)", lang: "de" },
  { id: "it-IT-ElsaNeural", label: "Elsa — Italian (female)", lang: "it" },
  { id: "pt-BR-FranciscaNeural", label: "Francisca — Portuguese (Brazil, female)", lang: "pt" },
  { id: "ru-RU-SvetlanaNeural", label: "Svetlana — Russian (female)", lang: "ru" },
  { id: "ja-JP-NanamiNeural", label: "Nanami — Japanese (female)", lang: "ja" },
  { id: "ja-JP-KeitaNeural", label: "Keita — Japanese (male)", lang: "ja" },
  { id: "ko-KR-SunHiNeural", label: "SunHi — Korean (female)", lang: "ko" },
  { id: "hi-IN-SwaraNeural", label: "Swara — Hindi (female)", lang: "hi" },
  { id: "ar-SA-ZariyahNeural", label: "Zariyah — Arabic (female)", lang: "ar" },
];

export const VOICE_IDS: ReadonlySet<string> = new Set(VOICES.map((v) => v.id));

export function isKnownVoice(id: string | null | undefined): id is string {
  return !!id && VOICE_IDS.has(id);
}
