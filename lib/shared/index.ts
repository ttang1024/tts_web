// Vendored copy of the monorepo's `@tts/shared` package. This app is a single
// standalone Next.js deployment, so the pure text/playback utilities live here
// rather than in a workspace package. The HTTP client is gone: nothing here
// talks to a separate API server any more.
export { normalizeText, segmentText, segmentMarkdown, stripMarkdown, chunkText } from "./segment";
export { VOICES, VOICE_IDS, isKnownVoice, type Voice } from "./voices";
export { SPEED_MIN, SPEED_MAX, SPEED_STEP, adjustSpeed, formatSpeed } from "./speed";
export { normalizeUrl } from "./url";
export { foldForSearch, findMatches, nearestMatch, stepMatch } from "./search";
export {
  estimateListeningSeconds,
  estimateSpeechSeconds,
  estimateMp3Bytes,
  speechRate,
  formatDuration,
} from "./time";
export { PlaybackController, type PlaybackAdapter } from "./playback";
