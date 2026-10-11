// The preferred voice. In the monorepo this was mirrored onto a server-side
// user record so the mobile app would agree with the web app; with no server
// state here it's simply localStorage, read synchronously so a
// server-rendered page can pick it up on mount. A document's own saved voice
// still wins over this.

import { VOICES, isKnownVoice, clampSpeed } from "@/lib/shared";

const VOICE_KEY = "tts-voice";
// The reader's typography + speed preferences, written by the reader.
export const READER_PREFS_KEY = "tts-reader-prefs";

function readLocal(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem(VOICE_KEY);
    return isKnownVoice(saved) ? saved : null;
  } catch {
    return null;
  }
}

// The voice picked last time, so playback with no voice of its own (a new
// document, a library entry saved before voices were stored) starts with the
// one the reader actually chose.
export function loadVoicePref(): string {
  return readLocal() ?? VOICES[0].id;
}

export function saveVoicePref(id: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(VOICE_KEY, id);
  } catch {
    // Storage disabled or over quota; the preference just doesn't persist.
  }
}

// The reading speed last set in the reader, so MP3 exports started outside
// it (the library, the home page) match what the listener hears in it.
export function loadSpeedPref(): number {
  if (typeof window === "undefined") return 1;
  try {
    return clampSpeed(JSON.parse(localStorage.getItem(READER_PREFS_KEY) ?? "{}").speed);
  } catch {
    return 1;
  }
}
