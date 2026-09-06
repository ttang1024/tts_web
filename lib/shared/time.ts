// Edge neural voices speak roughly 15 characters per second at 1x speed in
// languages written with an alphabet — about 180 words per minute.
const ALPHABETIC_CPS = 15;
// Chinese, Japanese, and Korean pack a whole syllable (often a whole word) into
// one character, so the same character count takes far longer to say. Assuming
// 15 c/s there told someone with a Chinese book it was a 20-minute listen when
// it was closer to an hour.
const SYLLABIC_CPS = 5.5;
// Enough of the start of a document to tell what it is written in, without
// walking a whole book every time a library row renders.
const SAMPLE_CHARS = 4_000;

// Whether a code point carries a syllable's worth of speech: kana, CJK
// ideographs (and their compatibility forms), Hangul, and the full-width
// punctuation that goes with them.
function isSyllabic(code: number): boolean {
  return (
    (code >= 0x3000 && code <= 0x30ff) || // CJK punctuation, hiragana, katakana
    (code >= 0x3400 && code <= 0x4dbf) || // CJK extension A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK unified ideographs
    (code >= 0xac00 && code <= 0xd7af) || // Hangul syllables
    (code >= 0x1100 && code <= 0x11ff) || // Hangul jamo
    (code >= 0xf900 && code <= 0xfaff) // CJK compatibility ideographs
  );
}

// Characters spoken per second for this text. Mixed text (a Chinese article
// quoting English, say) blends the two: seconds add up, rates don't, so the
// blend is over seconds-per-character.
export function speechRate(text: string): number {
  const end = Math.min(text.length, SAMPLE_CHARS);
  let syllabic = 0;
  let counted = 0;
  for (let i = 0; i < end; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x20) continue; // whitespace and control characters
    counted++;
    if (isSyllabic(code)) syllabic++;
  }
  if (counted === 0) return ALPHABETIC_CPS;
  const fraction = syllabic / counted;
  return 1 / (fraction / SYLLABIC_CPS + (1 - fraction) / ALPHABETIC_CPS);
}

// `rate` comes from speechRate() where the text is at hand, or from a document
// summary's speech_rate where only a character count is.
export function estimateListeningSeconds(
  charCount: number,
  speed = 1,
  rate = ALPHABETIC_CPS
): number {
  return charCount / (rate * speed);
}

export function estimateSpeechSeconds(text: string, speed = 1): number {
  return estimateListeningSeconds(text.length, speed, speechRate(text));
}

// The synthesis route returns 96 kbps mono MP3, so a document's rendered size
// follows from how long it takes to say. Only an estimate — it is what turns
// "bytes received so far" into a progress bar for an export whose real length
// isn't known until it finishes streaming.
const MP3_BYTES_PER_SECOND = 96_000 / 8;

export function estimateMp3Bytes(text: string): number {
  return estimateSpeechSeconds(text) * MP3_BYTES_PER_SECOND;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
