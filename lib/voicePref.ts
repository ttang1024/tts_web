// The preferred voice. In the monorepo this was mirrored onto a server-side
// user record so the mobile app would agree with the web app; with no server
// state here it's simply localStorage, read synchronously so a
// server-rendered page can pick it up on mount. A document's own saved voice
// still wins over this.

import { VOICES, isKnownVoice } from "@/lib/shared";

const VOICE_KEY = "tts-voice";

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
