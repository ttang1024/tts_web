"use client";

import {
  createElement,
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  SPEED_MIN,
  SPEED_MAX,
  SPEED_STEP,
  formatSpeed,
  estimateListeningSeconds,
  formatDuration,
  speechRate,
  normalizeText,
  segmentText,
  segmentMarkdown,
  stripMarkdown,
  PlaybackController,
  type PlaybackAdapter,
} from "@/lib/shared";
import {
  ArrowLeft,
  Minus,
  Plus,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Repeat,
  List,
  Bookmark as BookmarkIcon,
  Highlighter,
  Pencil,
  Download,
  Type,
  Check,
  X,
  Search,
  FileText,
  Keyboard,
  ChevronUp,
  ChevronDown,
  LoaderCircle,
} from "lucide-react";
import { classifyBlock, renderInline } from "@/lib/markdown";
import { updateDocument, type Bookmark, type Chapter } from "@/lib/documents";
import {
  isAbortError,
  synthesizeSentence,
  synthesizeTextToMp3,
  downloadBlob,
  safeFilename,
} from "@/lib/tts";
import { saveVoicePref } from "@/lib/voicePref";
import ErrorBanner from "./ErrorBanner";
import { useBookmarks } from "./reader/useBookmarks";
import { useChapters } from "./reader/useChapters";
import { useMediaSession } from "./reader/useMediaSession";
import { useSleepTimer } from "./reader/useSleepTimer";
import { useFind } from "./reader/useFind";

const FONT_SIZES = [15, 17, 19, 22];
const LINE_HEIGHTS = [1.6, 1.85, 2.1];
const SLEEP_OPTIONS = [0, 15, 30, 60];
const PREFS_KEY = "tts-reader-prefs";
// Heading font scale by level (1-6), relative to the reader's base text size.
const HEADING_SCALE = [1.8, 1.5, 1.3, 1.15, 1.05, 1];
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950";

// What the keydown handler below (and useBookmarks) actually binds. Listed
// here so the "?" panel can't drift from the behaviour it describes.
const SHORTCUTS: [string[], string][] = [
  [["Space"], "Play or pause"],
  [["←", "→"], "Previous / next sentence"],
  [["+", "−"], "Faster / slower"],
  [["/"], "Find in document"],
  [["Enter"], "Next match (Shift for previous)"],
  [["b"], "Bookmark this sentence"],
  [["h"], "Highlight this sentence"],
  [["?"], "This list"],
];

type WordTiming = { text: string; start: number; end: number };
type SentenceAudio = { url: string; words: WordTiming[] };
// Stable empty-array reference for non-current sentences, so it doesn't
// defeat React.memo's shallow prop comparison on every render (see
// PlainSentence below).
const EMPTY_WORDS: WordTiming[] = [];

type Props = {
  title: string;
  paragraphs: string[][];
  voice: string;
  voices: { id: string; label: string }[];
  onClose: () => void;
  documentId?: number | null;
  isMarkdown?: boolean;
  initialIndex?: number;
  // The raw document body. Required for in-place text editing, which is only
  // offered when a documentId is present to save back to.
  text?: string;
  onProgress?: (index: number) => void;
  onVoiceChange?: (voice: string) => void;
  // Notified after the body is edited and saved, so the parent can refresh.
  onTextSave?: (text: string) => void;
  // Notified after the title is renamed and saved, so the parent can refresh.
  onTitleSave?: (title: string) => void;
  // Starts playback immediately on mount — used when opened as part of a
  // library queue (see web/app/library/page.tsx), where the previous
  // document just finished and this one should pick up without a tap.
  autoPlay?: boolean;
  // Called once when playback reaches the end of the document (not on a
  // manual stop/pause) — the library uses this to advance its queue.
  onEnded?: () => void;
  // When set, renders a "Queue i/total" indicator with a way to cancel the
  // queue and keep reading just this document.
  queueInfo?: { index: number; total: number; loop: boolean } | null;
  onStopQueue?: () => void;
  // Bumping this value pauses playback — used by the library's auto-stop
  // timer, which spans the whole queue rather than a single document.
  stopSignal?: number;
};

// Finds where a timed word starts in the sentence, from `from` onward. Tries
// an exact match first, then falls back to case-insensitive — the TTS
// engine's word text occasionally differs in case from the source (e.g. an
// acronym or sentence-initial capitalization) even though it's the same word.
function findWordIndex(sentence: string, word: string, from: number): number {
  const idx = sentence.indexOf(word, from);
  if (idx !== -1) return idx;
  return sentence.toLowerCase().indexOf(word.toLowerCase(), from);
}

// Maps word timings back onto the sentence string so the spoken word can be
// highlighted; characters between timed words (punctuation, spaces) become
// unhighlighted filler segments. A word with no match at all (rare — the
// engine's text isn't even a case-insensitive substring) is skipped rather
// than aborting the rest of the sentence: search resumes from the same `pos`
// for the next word, so one bad timing doesn't cascade into misaligning the
// ones after it.
function buildSegments(
  sentence: string,
  words: WordTiming[]
): { text: string; word: number | null }[] {
  const segments: { text: string; word: number | null }[] = [];
  let pos = 0;
  words.forEach((w, i) => {
    if (!w.text) return;
    const idx = findWordIndex(sentence, w.text, pos);
    if (idx === -1) return;
    if (idx > pos) segments.push({ text: sentence.slice(pos, idx), word: null });
    // Render the sentence's own characters, not the engine's word text, so a
    // case-insensitive match still displays with the source's original case.
    segments.push({ text: sentence.slice(idx, idx + w.text.length), word: i });
    pos = idx + w.text.length;
  });
  if (pos < sentence.length) segments.push({ text: sentence.slice(pos), word: null });
  return segments;
}

const SENTENCE_CLASS =
  "cursor-pointer rounded px-0.5 transition-colors";
const SENTENCE_CURRENT_CLASS = "bg-amber-200 dark:bg-amber-500/40";
const SENTENCE_IDLE_CLASS = "hover:bg-zinc-100 dark:hover:bg-zinc-800";
// Persistent (non-current) styling for a highlighted sentence, so it stays
// visible after playback moves on.
const SENTENCE_HIGHLIGHT_CLASS = "bg-amber-100 dark:bg-amber-500/10";

// Small marker rendered before a bookmarked/highlighted sentence so it's
// visible at a glance without disrupting the flowing text.
function SentenceMark({ kind }: { kind: "bookmark" | "highlight" }) {
  return (
    <span aria-hidden className="mr-0.5 inline-flex select-none align-middle opacity-70">
      {kind === "bookmark" ? (
        <BookmarkIcon className="inline h-[0.85em] w-[0.85em]" />
      ) : (
        <Highlighter className="inline h-[0.85em] w-[0.85em]" />
      )}
    </span>
  );
}

// Plain-text sentence span, with per-word highlight while it's the current
// one. Memoized so the ~4x/sec activeWord updates during playback only
// re-render (and re-run buildSegments for) the one sentence that changed,
// instead of every sentence in the document.
const PlainSentence = memo(function PlainSentence({
  id,
  text,
  isCurrent,
  words,
  activeWord,
  highlighted,
  bookmarked,
  onSelect,
}: {
  id: number;
  text: string;
  isCurrent: boolean;
  words: WordTiming[];
  activeWord: number;
  highlighted: boolean;
  bookmarked: boolean;
  onSelect: (id: number) => void;
}) {
  return (
    <span
      id={`sentence-${id}`}
      onClick={() => onSelect(id)}
      className={`${SENTENCE_CLASS} ${isCurrent
        ? SENTENCE_CURRENT_CLASS
        : highlighted
          ? `${SENTENCE_HIGHLIGHT_CLASS} ${SENTENCE_IDLE_CLASS}`
          : SENTENCE_IDLE_CLASS
        }`}
    >
      {bookmarked && <SentenceMark kind="bookmark" />}
      {isCurrent && words.length > 0
        ? buildSegments(text, words).map((seg, s) => (
          <span
            key={s}
            className={
              seg.word !== null && seg.word === activeWord
                ? "rounded bg-amber-400 dark:bg-amber-400/80 dark:text-zinc-900"
                : undefined
            }
          >
            {seg.text}
          </span>
        ))
        : text}{" "}
    </span>
  );
});

// Markdown sentence span. No per-word highlight (the rendered/formatted text
// no longer lines up with the spoken text), but the inline-markdown parse is
// still only worth paying for when this sentence's own props actually change.
const MarkdownSentenceSpan = memo(function MarkdownSentenceSpan({
  id,
  sentence,
  isCurrent,
  highlighted,
  bookmarked,
  onSelect,
}: {
  id: number;
  sentence: string;
  isCurrent: boolean;
  highlighted: boolean;
  bookmarked: boolean;
  onSelect: (id: number) => void;
}) {
  return (
    <span
      id={`sentence-${id}`}
      onClick={() => onSelect(id)}
      className={`${SENTENCE_CLASS} ${isCurrent
        ? SENTENCE_CURRENT_CLASS
        : highlighted
          ? `${SENTENCE_HIGHLIGHT_CLASS} ${SENTENCE_IDLE_CLASS}`
          : SENTENCE_IDLE_CLASS
        }`}
    >
      {bookmarked && <SentenceMark kind="bookmark" />}
      {renderInline(classifyBlock(sentence).text)}{" "}
    </span>
  );
});

// One row in the bookmarks/highlights panel: jump to the sentence, edit its
// note inline, or delete it.
function BookmarkRow({
  bookmark,
  isCurrent,
  onJump,
  onDelete,
  onSaveNote,
}: {
  bookmark: Bookmark;
  isCurrent: boolean;
  onJump: () => void;
  onDelete: () => void;
  onSaveNote: (note: string) => void;
}) {
  const [editingNote, setEditingNote] = useState(false);
  const [draft, setDraft] = useState(bookmark.note ?? "");

  return (
    <div
      className={`group flex items-start gap-2 rounded-md px-2 py-1.5 ${isCurrent ? "bg-amber-100 dark:bg-amber-500/10" : ""
        }`}
    >
      <button
        onClick={onJump}
        className={`min-w-0 flex-1 text-left ${FOCUS_RING}`}
        title="Jump to this sentence"
      >
        <div className="flex items-center gap-1 text-zinc-400">
          {bookmark.kind === "highlight" ? (
            <Highlighter className="h-3.5 w-3.5" />
          ) : (
            <BookmarkIcon className="h-3.5 w-3.5" />
          )}
          <span>Sentence {bookmark.sentence_index + 1}</span>
        </div>
        {bookmark.quote && <p className="mt-0.5 truncate text-zinc-700 dark:text-zinc-300">{bookmark.quote}</p>}
        {!editingNote && bookmark.note && (
          <p className="mt-0.5 truncate italic text-zinc-500">{bookmark.note}</p>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {editingNote ? (
          <>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onSaveNote(draft);
                  setEditingNote(false);
                } else if (e.key === "Escape") {
                  setDraft(bookmark.note ?? "");
                  setEditingNote(false);
                }
              }}
              placeholder="Note…"
              className={`w-28 rounded border border-zinc-300 bg-transparent px-1.5 py-0.5 outline-none focus:border-blue-500 dark:border-zinc-700 ${FOCUS_RING}`}
            />
            <button
              onClick={() => {
                onSaveNote(draft);
                setEditingNote(false);
              }}
              aria-label="Save note"
              className={`rounded px-1 py-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 ${FOCUS_RING}`}
            >
              <Check className="h-4 w-4" />
            </button>
          </>
        ) : (
          <button
            onClick={() => setEditingNote(true)}
            aria-label="Edit note"
            title="Edit note"
            className={`rounded px-1 py-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 ${FOCUS_RING}`}
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={onDelete}
          aria-label="Delete"
          title="Delete"
          className={`rounded px-1 py-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 ${FOCUS_RING}`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function loadPrefs(): { fontSize?: number; lineHeight?: number; speed?: number } {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export default function Reader({
  title,
  paragraphs,
  voice: initialVoice,
  voices,
  onClose,
  documentId,
  isMarkdown = false,
  initialIndex = 0,
  text,
  onProgress,
  onVoiceChange,
  onTextSave,
  onTitleSave,
  autoPlay = false,
  onEnded,
  queueInfo = null,
  onStopQueue,
  stopSignal,
}: Props) {
  // Segmentation is held locally so an in-place edit can re-segment without a
  // round trip through the parent. Kept in sync if the parent swaps documents.
  const [paras, setParas] = useState(paragraphs);
  useEffect(() => setParas(paragraphs), [paragraphs]);
  const flat = useMemo(() => paras.flat(), [paras]);
  const [voice, setVoice] = useState(initialVoice);
  // Reading speed is a preference, not a per-document setting: someone who
  // listens at 1.4x listens at 1.4x in the next document too, so it persists
  // alongside the typography settings instead of resetting to 1x every open.
  const [speed, setSpeed] = useState(() => {
    const saved = loadPrefs().speed;
    return typeof saved === "number" ? Math.min(Math.max(saved, SPEED_MIN), SPEED_MAX) : 1;
  });
  const [current, setCurrent] = useState(() =>
    Math.min(Math.max(initialIndex, 0), Math.max(flat.length - 1, 0))
  );
  const [playing, setPlaying] = useState(false);
  // When on, reaching the last sentence restarts from the top instead of
  // stopping — a per-document repeat, independent of the library's queue-wide
  // loop (see useQueuePlayback). Read through a ref by the audio.onended
  // handler, which is bound once at mount.
  const [loop, setLoop] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [words, setWords] = useState<WordTiming[]>([]);
  const [activeWord, setActiveWord] = useState(-1);
  // Which dropdown panel (if any) is open below the toolbar; mutually
  // exclusive so opening one closes the others.
  const [panel, setPanel] = useState<
    "settings" | "bookmarks" | "chapters" | "shortcuts" | null
  >(null);
  const [fontSize, setFontSize] = useState(() => loadPrefs().fontSize ?? 17);
  const [lineHeight, setLineHeight] = useState(() => loadPrefs().lineHeight ?? 1.85);
  // Null when idle, otherwise the render's progress as a percentage. Exporting
  // a book takes minutes, so the button reports how far along it is and a
  // second click abandons it.
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const downloading = downloadPercent !== null;
  const [savedText, setSavedText] = useState(text ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setSavedText(text ?? ""), [text]);
  const canEdit = documentId != null && text != null;

  // The title is held locally so a rename shows immediately without waiting on
  // the parent to pass a new one down. Kept in sync if the parent swaps
  // documents (or renames it elsewhere).
  const [docTitle, setDocTitle] = useState(title);
  useEffect(() => setDocTitle(title), [title]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const [savingTitle, setSavingTitle] = useState(false);
  // Renaming writes back to the library, so it needs a document to write to.
  const canRename = documentId != null;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  // The shared sentence-by-sentence playback engine (fetch caching, the
  // generation counter that guards against a stale fetch/load clobbering a
  // newer jump, prefetching, resume-vs-reload) — see shared/playback.ts. The
  // native reader (app/screens/ReaderScreen.tsx) drives the same engine
  // against expo-audio instead of HTMLAudioElement.
  const controllerRef = useRef<PlaybackController<SentenceAudio> | null>(null);
  // Which sentence the <audio> element currently has loaded; read by the
  // adapter's canResume() below.
  const loadedIndexRef = useRef(-1);
  const wordsRef = useRef<WordTiming[]>([]);
  // fetchSource and onended (bound once at mount, see below) read live values
  // through refs so an in-place edit, a markdown-ness change, or a jump
  // elsewhere doesn't require rebuilding the adapter or going stale.
  const flatRef = useRef(flat);
  flatRef.current = flat;
  const isMarkdownRef = useRef(isMarkdown);
  isMarkdownRef.current = isMarkdown;
  const currentRef = useRef(current);
  currentRef.current = current;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const loopRef = useRef(loop);
  loopRef.current = loop;

  // Keep the controller's view of state current every render — mirrors the
  // stateRef pattern the readers used before this was extracted: async
  // callbacks (onended, fetch resolutions) need to read live values without
  // resubscribing effects.
  controllerRef.current?.sync({ voice, speed, current, playing, loading }, flat.length);

  // Stable identity (via the refs above) so it can be handed to every
  // sentence span as a prop without defeating their React.memo — see
  // PlainSentence/MarkdownSentenceSpan.
  const selectSentence = useCallback((idx: number) => {
    if (playingRef.current || loadingRef.current) void controllerRef.current?.playFrom(idx);
    else setCurrent(idx);
  }, []);

  const {
    findOpen,
    findQuery,
    findInputRef,
    matches,
    matchNumber,
    changeQuery,
    openFind,
    closeFind,
    goToMatch,
  } = useFind(flat, currentRef, selectSentence);

  useEffect(() => {
    const audio = new Audio();

    const adapter: PlaybackAdapter<SentenceAudio> = {
      fetchSource(index, voiceId) {
        // Markdown sentences are stripped to plain prose so symbols aren't read.
        const text = isMarkdownRef.current
          ? stripMarkdown(flatRef.current[index])
          : flatRef.current[index];
        return synthesizeSentence(text, voiceId);
      },
      async loadAndPlay(index, source, rate) {
        audio.src = source.url;
        loadedIndexRef.current = index;
        audio.playbackRate = rate;
        await audio.play();
      },
      async resume(rate) {
        audio.playbackRate = rate;
        await audio.play();
      },
      canResume(index) {
        return (
          loadedIndexRef.current === index && !!audio.src && audio.currentTime > 0 && !audio.ended
        );
      },
      pause() {
        audio.pause();
      },
      setPlaybackRate(rate) {
        audio.playbackRate = rate;
      },
      release(source) {
        URL.revokeObjectURL(source.url);
      },
    };

    const controller = new PlaybackController<SentenceAudio>(
      adapter,
      {
        setCurrent,
        setPlaying,
        setLoading,
        setError,
        onLoaded(_index, source) {
          wordsRef.current = source.words;
          setWords(source.words);
          setActiveWord(-1);
        },
      },
      { voice, speed, current, playing, loading, flatLength: flat.length }
    );
    controllerRef.current = controller;

    if (autoPlay) void controller.playFrom(current);

    audio.onended = () => {
      const i = currentRef.current;
      if (i + 1 < flatRef.current.length) void controller.playFrom(i + 1);
      else if (loopRef.current && flatRef.current.length > 0) {
        // End of the document with looping on: start over from the top and
        // keep playing, rather than stopping or advancing a queue.
        void controller.playFrom(0);
      } else {
        setPlaying(false);
        onEndedRef.current?.();
      }
    };

    audioRef.current = audio;
    return () => {
      audio.onended = null;
      controller.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document
      .getElementById(`sentence-${current}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [current]);

  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  // Report the reading position (debounced so rapid skipping doesn't spam).
  useEffect(() => {
    if (!onProgressRef.current) return;
    const timer = setTimeout(() => onProgressRef.current?.(current), 1000);
    return () => clearTimeout(timer);
  }, [current]);

  // Track the spoken word while audio plays.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio && wordsRef.current.length) {
        const t = audio.currentTime;
        let index = -1;
        for (let i = 0; i < wordsRef.current.length; i++) {
          if (wordsRef.current[i].start <= t) index = i;
          else break;
        }
        setActiveWord((prev) => (prev === index ? prev : index));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Keyboard shortcuts: space play/pause, arrows prev/next, +/- speed.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName) ||
          target.isContentEditable)
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "+" || e.key === "=") {
        stepSpeed(SPEED_STEP);
      } else if (e.key === "-") {
        stepSpeed(-SPEED_STEP);
      } else if (e.key === "/") {
        // The browser's own find can't move playback; this one jumps the
        // reader to the sentence.
        e.preventDefault();
        openFind();
      } else if (e.key === "?") {
        e.preventDefault();
        setPanel((p) => (p === "shortcuts" ? null : "shortcuts"));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // togglePlay/step/stepSpeed only proxy to controllerRef (a stable ref)
    // and setSpeed, and openFind/setPanel are stable too, so this can
    // subscribe once instead of on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { sleepMinutes, setSleep } = useSleepTimer(playing, stop);

  // External stop request (the library's queue-wide auto-stop timer). Only
  // acts once `stopSignal` actually changes from the value last seen, so a
  // signal inherited from a prior document in the queue doesn't immediately
  // pause the next one. Compares against a stored value rather than a
  // "have I run yet" boolean ref: React's Strict Mode double-invokes this
  // effect on mount, and a boolean flag gets consumed by the phantom first
  // invocation, leaving the real one to call stop() right after playback
  // starts.
  const lastStopSignalRef = useRef(stopSignal);
  useEffect(() => {
    if (stopSignal === lastStopSignalRef.current) return;
    lastStopSignalRef.current = stopSignal;
    controllerRef.current?.stop();
  }, [stopSignal]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ fontSize, lineHeight, speed }));
    } catch {
      // Private browsing or storage full; prefs just won't persist.
    }
  }, [fontSize, lineHeight, speed]);

  const { bookmarks, bookmarksBusy, marksByIndex, toggleMark, deleteMark, saveNote } = useBookmarks(
    documentId,
    currentRef,
    flatRef,
    setError
  );
  const { chapters, chapterIndex } = useChapters(documentId);
  useMediaSession(docTitle, playing, loading, togglePlay, step);

  // Don't leave a render streaming into a closed reader.
  useEffect(() => () => downloadAbortRef.current?.abort(), []);

  // Reflect play state in the tab title, and restore it on unmount.
  useEffect(() => {
    const original = document.title;
    return () => {
      document.title = original;
    };
  }, []);
  useEffect(() => {
    document.title = playing ? `▶ ${docTitle}` : docTitle;
  }, [playing, docTitle]);

  // Thin wrappers so the JSX below reads the same as before the playback
  // engine moved into the shared controller.
  function stop() {
    controllerRef.current?.stop();
  }

  function togglePlay() {
    controllerRef.current?.togglePlay();
  }

  function step(delta: number) {
    controllerRef.current?.step(delta);
  }

  function stepSpeed(delta: number) {
    const value = controllerRef.current?.stepSpeed(delta);
    if (value !== undefined) setSpeed(value);
  }

  function changeVoice(id: string) {
    setVoice(id);
    saveVoicePref(id);
    onVoiceChange?.(id);
    controllerRef.current?.changeVoice(id);
  }

  // Renders the whole document to an MP3 and saves it. The synthesis service
  // has no copy of the document — the library is local — so the text goes up
  // with the request, stripped of Markdown symbols so they aren't read aloud.
  // The button stays disabled throughout, since rendering a long document
  // takes a while and a second click would start it all over again.
  async function downloadMp3() {
    // A second click while it is rendering cancels: the fetch aborts, and the
    // route stops synthesizing once nothing is reading its response.
    if (downloading) {
      downloadAbortRef.current?.abort();
      return;
    }
    if (!savedText.trim()) return;

    const controller = new AbortController();
    downloadAbortRef.current = controller;
    setDownloadPercent(0);
    setError(null);
    try {
      const speech = isMarkdown ? stripMarkdown(savedText) : savedText;
      const name = safeFilename(docTitle);
      const blob = await synthesizeTextToMp3(speech, voice, name, {
        signal: controller.signal,
        onProgress: (fraction) => setDownloadPercent(Math.round(fraction * 100)),
      });
      downloadBlob(blob, `${name}.mp3`);
    } catch (err) {
      // Cancelling is something the reader did on purpose, not a failure.
      if (!isAbortError(err)) {
        setError(err instanceof Error ? err.message : "Download failed.");
      }
    } finally {
      downloadAbortRef.current = null;
      setDownloadPercent(null);
    }
  }

  // The other half of the export story: an OCR'd image, a PDF, or an EPUB has
  // already been turned into plain text by the time it reaches the reader, and
  // that text is often the thing worth keeping. Markdown keeps its extension so
  // it opens as Markdown.
  function downloadText() {
    if (!savedText.trim()) return;
    const name = safeFilename(docTitle);
    const type = isMarkdown ? "text/markdown" : "text/plain";
    downloadBlob(
      new Blob([savedText], { type: `${type};charset=utf-8` }),
      `${name}.${isMarkdown ? "md" : "txt"}`
    );
  }

  function startRenaming() {
    if (!canRename) return;
    setTitleDraft(docTitle);
    setEditingTitle(true);
  }

  // Persist the renamed title. An empty draft is treated as a cancel rather
  // than an error — the library has no use for an untitled entry.
  async function saveTitle() {
    if (documentId == null || savingTitle) return;
    const next = titleDraft.trim();
    if (!next || next === docTitle) {
      setEditingTitle(false);
      return;
    }
    setSavingTitle(true);
    setError(null);
    try {
      await updateDocument(documentId, { title: next });
      setDocTitle(next);
      setEditingTitle(false);
      onTitleSave?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename the document.");
    } finally {
      setSavingTitle(false);
    }
  }

  function startEditing() {
    stop();
    setError(null);
    setDraft(savedText);
    setEditing(true);
  }

  // Persist the edited body, then re-segment locally and reset playback: the
  // cached audio and word timings no longer match the new sentences.
  async function saveText() {
    if (documentId == null || saving) return;
    const next = normalizeText(draft);
    if (!next) {
      setError("There is no text to save.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateDocument(documentId, { text: next });
      const segments = isMarkdown ? segmentMarkdown(next) : segmentText(next);
      stop();
      controllerRef.current?.clearCache();
      loadedIndexRef.current = -1;
      wordsRef.current = [];
      setWords([]);
      setActiveWord(-1);
      setParas(segments);
      setSavedText(next);
      setCurrent((i) => Math.min(i, Math.max(segments.flat().length - 1, 0)));
      setEditing(false);
      onTextSave?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  const charsBefore = useMemo(() => {
    const sums = [0];
    for (const sentence of flat) sums.push(sums[sums.length - 1] + sentence.length + 1);
    return sums;
  }, [flat]);
  // How fast this document's language is spoken (English and Chinese differ by
  // roughly 3x per character), sampled from the text rather than assumed.
  // The opening sentences are a large enough sample; joining a whole book
  // just to look at its first few thousand characters is not.
  const rate = useMemo(() => speechRate(flat.slice(0, 40).join(" ")), [flat]);
  const remaining = formatDuration(
    estimateListeningSeconds(charsBefore[flat.length] - charsBefore[current], speed, rate)
  );

  function jumpToChapter(chapter: Chapter) {
    selectSentence(chapterIndex(chapter, charsBefore, flat.length));
    setPanel(null);
  }

  // Markdown body: render each block with its formatting, but keep the same
  // click-to-play and sentence-level highlight. Per-word highlight is skipped
  // because the displayed (formatted) text no longer matches the spoken text.
  function renderMarkdownBody() {
    let i = -1;
    return paras.map((sentences, p) => {
      const lead = classifyBlock(sentences[0]);
      const spans = sentences.map((sentence) => {
        i++;
        const idx = i;
        const marks = marksByIndex.get(idx);
        return (
          <MarkdownSentenceSpan
            key={idx}
            id={idx}
            sentence={sentence}
            isCurrent={idx === current}
            highlighted={!!marks?.highlight}
            bookmarked={!!marks?.bookmark}
            onSelect={selectSentence}
          />
        );
      });

      if (lead.kind === "heading") {
        return createElement(
          `h${Math.min(lead.level, 6)}`,
          {
            key: p,
            className: "font-bold leading-tight",
            style: { fontSize: Math.round(fontSize * HEADING_SCALE[lead.level - 1]) },
          },
          spans
        );
      }
      if (lead.kind === "quote") {
        return (
          <blockquote
            key={p}
            className="border-l-4 border-zinc-300 pl-4 italic text-zinc-600 dark:border-zinc-600 dark:text-zinc-400"
          >
            {spans}
          </blockquote>
        );
      }
      if (lead.kind === "list") {
        return (
          <div key={p} className="flex gap-2 pl-1">
            <span aria-hidden className="select-none text-zinc-400">
              •
            </span>
            <div className="flex-1">{spans}</div>
          </div>
        );
      }
      return <p key={p}>{spans}</p>;
    });
  }

  let index = -1;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-8 sm:px-6">
      <div className="sticky top-0 z-10 -mx-4 border-b border-zinc-200 bg-white/90 px-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-3 py-3">
          <button
            onClick={onClose}
            aria-label="Back"
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="min-w-0 flex-1 basis-full sm:basis-auto">
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                disabled={savingTitle}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void saveTitle();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingTitle(false);
                  }
                }}
                // Clicking away commits, the same as pressing Enter; Escape
                // above closes the field first so it can't also save.
                onBlur={() => void saveTitle()}
                aria-label="Title"
                className={`w-full rounded border border-zinc-300 bg-transparent px-1.5 py-0.5 text-sm font-semibold outline-none focus:border-blue-500 disabled:opacity-60 dark:border-zinc-700 ${FOCUS_RING}`}
              />
            ) : (
              <h1
                onDoubleClick={startRenaming}
                className="truncate text-sm font-semibold"
                title={canRename ? `${docTitle} — double-click to rename` : docTitle}
              >
                {docTitle}
              </h1>
            )}
            <p className="text-[11px] text-zinc-500">
              {current + 1} / {flat.length} · ~{remaining} left
              {queueInfo && (
                <>
                  {" · "}
                  <span className="text-blue-600 dark:text-blue-400">
                    Queue {queueInfo.index + 1}/{queueInfo.total}
                    {queueInfo.loop ? " (looping)" : ""}
                  </span>
                  {onStopQueue && (
                    <button
                      onClick={onStopQueue}
                      className={`ml-1.5 text-zinc-500 underline decoration-dotted hover:text-zinc-700 dark:hover:text-zinc-300 ${FOCUS_RING}`}
                    >
                      Stop queue
                    </button>
                  )}
                </>
              )}
            </p>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
            <select
              value={voice}
              onChange={(e) => changeVoice(e.target.value)}
              className={`max-w-40 rounded-lg border border-zinc-300 bg-transparent px-2 py-1.5 text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900 ${FOCUS_RING}`}
              aria-label="Voice"
            >
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>

            <div
              className="flex items-center rounded-lg border border-zinc-300 dark:border-zinc-700"
              role="group"
              aria-label="Speed"
            >
              <button
                onClick={() => stepSpeed(-SPEED_STEP)}
                disabled={speed <= SPEED_MIN}
                aria-label="Slower"
                className={`rounded-l-lg px-2.5 py-1.5 transition hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-12 text-center text-xs tabular-nums">
                {formatSpeed(speed)}
              </span>
              <button
                onClick={() => stepSpeed(SPEED_STEP)}
                disabled={speed >= SPEED_MAX}
                aria-label="Faster"
                className={`rounded-r-lg px-2.5 py-1.5 transition hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex w-full flex-wrap items-center gap-0.5 sm:w-auto sm:flex-nowrap sm:gap-1">
              <button
                onClick={() => step(-1)}
                disabled={current === 0}
                aria-label="Previous sentence"
                className={`rounded-full px-2.5 py-1.5 transition hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
              >
                <SkipBack className="h-4 w-4" />
              </button>
              <button
                onClick={togglePlay}
                aria-label={playing ? "Pause" : "Play"}
                className={`rounded-full bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-500 ${FOCUS_RING}`}
              >
                {loading ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : playing ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </button>
              <button
                onClick={() => step(1)}
                disabled={current === flat.length - 1}
                aria-label="Next sentence"
                className={`rounded-full px-2.5 py-1.5 transition hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
              >
                <SkipForward className="h-4 w-4" />
              </button>
              <button
                onClick={() => setLoop((on) => !on)}
                aria-label="Loop playback"
                aria-pressed={loop}
                title={loop ? "Looping: repeat this document" : "Loop this document"}
                className={`rounded-full px-2.5 py-1.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${FOCUS_RING} ${loop
                  ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                  : ""
                  }`}
              >
                <Repeat className="h-4 w-4" />
              </button>
              <button
                onClick={() => (findOpen ? closeFind() : openFind())}
                aria-label="Find in document"
                aria-expanded={findOpen}
                title="Find in document  (/)"
                className={`rounded-full px-2.5 py-1.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${FOCUS_RING} ${findOpen ? "bg-zinc-100 dark:bg-zinc-800" : ""
                  }`}
              >
                <Search className="h-4 w-4" />
              </button>
              {chapters.length > 1 && (
                <button
                  onClick={() => setPanel((p) => (p === "chapters" ? null : "chapters"))}
                  aria-label="Chapters"
                  aria-expanded={panel === "chapters"}
                  title="Jump to chapter"
                  className={`rounded-full px-2.5 py-1.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${FOCUS_RING} ${panel === "chapters" ? "bg-zinc-100 dark:bg-zinc-800" : ""
                    }`}
                >
                  <List className="h-4 w-4" />
                </button>
              )}
              {documentId != null && (
                <button
                  onClick={() => setPanel((p) => (p === "bookmarks" ? null : "bookmarks"))}
                  aria-label="Bookmarks and highlights"
                  aria-expanded={panel === "bookmarks"}
                  title="Bookmarks & highlights"
                  className={`relative rounded-full px-2.5 py-1.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${FOCUS_RING} ${panel === "bookmarks" ? "bg-zinc-100 dark:bg-zinc-800" : ""
                    }`}
                >
                  <BookmarkIcon className="h-4 w-4" />
                  {bookmarks.length > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-blue-600 px-0.5 text-[9px] font-semibold leading-none text-white">
                      {bookmarks.length}
                    </span>
                  )}
                </button>
              )}
              <button
                onClick={() => setPanel((p) => (p === "shortcuts" ? null : "shortcuts"))}
                aria-label="Keyboard shortcuts"
                aria-expanded={panel === "shortcuts"}
                title="Keyboard shortcuts  (?)"
                className={`rounded-full px-2.5 py-1.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${FOCUS_RING} ${panel === "shortcuts" ? "bg-zinc-100 dark:bg-zinc-800" : ""
                  }`}
              >
                <Keyboard className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPanel((p) => (p === "settings" ? null : "settings"))}
                aria-label="Reading settings"
                aria-expanded={panel === "settings"}
                className={`rounded-full px-2.5 py-1.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${FOCUS_RING} ${panel === "settings" ? "bg-zinc-100 dark:bg-zinc-800" : ""
                  }`}
              >
                <Type className="h-4 w-4" />
              </button>
              {canEdit && (
                <button
                  onClick={() => (editing ? setEditing(false) : startEditing())}
                  aria-label={editing ? "Cancel editing" : "Edit text"}
                  aria-pressed={editing}
                  title="Edit text"
                  className={`rounded-full px-2.5 py-1.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${FOCUS_RING} ${editing ? "bg-zinc-100 dark:bg-zinc-800" : ""
                    }`}
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
              {savedText.trim() !== "" && (
                <button
                  onClick={downloadText}
                  aria-label={isMarkdown ? "Download Markdown" : "Download text"}
                  title={
                    isMarkdown
                      ? "Download the text as .md"
                      : "Download the extracted text as .txt"
                  }
                  className={`rounded-full px-2.5 py-1.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
                >
                  <FileText className="h-4 w-4" />
                </button>
              )}
              {savedText.trim() !== "" && (
                <button
                  onClick={downloadMp3}
                  aria-label={
                    downloading
                      ? `Rendering MP3, ${downloadPercent}% done. Click to cancel.`
                      : "Download MP3"
                  }
                  aria-busy={downloading}
                  title={
                    downloading
                      ? "Cancel this render"
                      : "Download as MP3 (synthesized on first download)"
                  }
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
                >
                  {downloading ? (
                    <>
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      <span className="text-xs tabular-nums text-zinc-500">
                        {downloadPercent}%
                      </span>
                    </>
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {findOpen && (
          <div className="flex items-center gap-2 border-t border-zinc-200 py-2 dark:border-zinc-800">
            <Search className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
            <input
              ref={findInputRef}
              value={findQuery}
              onChange={(e) => changeQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  goToMatch(e.shiftKey ? -1 : 1);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  closeFind();
                }
              }}
              placeholder="Find in document"
              aria-label="Find in document"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
            />
            <span
              aria-live="polite"
              className="shrink-0 text-xs tabular-nums text-zinc-500"
            >
              {findQuery.trim() === ""
                ? "Enter to jump"
                : matches.length === 0
                  ? "No matches"
                  : `${matchNumber || "–"} / ${matches.length}`}
            </span>
            <button
              onClick={() => goToMatch(-1)}
              disabled={matches.length === 0}
              aria-label="Previous match"
              className={`rounded-full px-2 py-1 transition hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              onClick={() => goToMatch(1)}
              disabled={matches.length === 0}
              aria-label="Next match"
              className={`rounded-full px-2 py-1 transition hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
            >
              <ChevronDown className="h-4 w-4" />
            </button>
            <button
              onClick={closeFind}
              aria-label="Close find"
              className={`rounded-full px-2 py-1 transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {panel === "shortcuts" && (
          <div className="border-t border-zinc-200 py-3 dark:border-zinc-800">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs sm:grid-cols-[auto_1fr_auto_1fr] sm:gap-x-4">
              {SHORTCUTS.map(([keys, action]) => (
                <Fragment key={action}>
                  <dt className="flex items-center gap-1">
                    {keys.map((key) => (
                      <kbd
                        key={key}
                        className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                      >
                        {key}
                      </kbd>
                    ))}
                  </dt>
                  <dd className="text-zinc-500 dark:text-zinc-400">{action}</dd>
                </Fragment>
              ))}
            </dl>
          </div>
        )}

        {panel === "settings" && (
          <div className="flex flex-wrap items-center gap-4 border-t border-zinc-200 py-2.5 text-xs dark:border-zinc-800">
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-500">Text size</span>
              {FONT_SIZES.map((size) => (
                <button
                  key={size}
                  onClick={() => setFontSize(size)}
                  aria-pressed={fontSize === size}
                  className={`rounded-md px-2 py-1 transition ${FOCUS_RING} ${fontSize === size
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                  style={{ fontSize: Math.min(size, 16) }}
                >
                  A
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-500">Spacing</span>
              {LINE_HEIGHTS.map((lh, i) => (
                <button
                  key={lh}
                  onClick={() => setLineHeight(lh)}
                  aria-pressed={lineHeight === lh}
                  className={`rounded-md px-2 py-1 transition ${FOCUS_RING} ${lineHeight === lh
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                >
                  {["Compact", "Normal", "Loose"][i]}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5">
              <span className="text-zinc-500">Sleep timer</span>
              <select
                value={sleepMinutes}
                onChange={(e) => setSleep(Number(e.target.value))}
                className={`rounded-md border border-zinc-300 bg-transparent px-1.5 py-1 outline-none dark:border-zinc-700 dark:bg-zinc-900 ${FOCUS_RING}`}
              >
                {SLEEP_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? "Off" : `${m} min`}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-zinc-400">
              Shortcuts: space play/pause · arrow keys sentence · +/- speed · b bookmark · h highlight
            </span>
          </div>
        )}

        {panel === "chapters" && (
          <div className="max-h-64 overflow-y-auto border-t border-zinc-200 py-2 text-xs dark:border-zinc-800">
            {chapters.map((ch, i) => (
              <button
                key={i}
                onClick={() => jumpToChapter(ch)}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
              >
                <span className="truncate">{ch.title}</span>
                <span className="shrink-0 tabular-nums text-zinc-400">
                  {formatDuration(ch.startSeconds)}
                </span>
              </button>
            ))}
          </div>
        )}

        {panel === "bookmarks" && (
          <div className="max-h-72 overflow-y-auto border-t border-zinc-200 py-2 text-xs dark:border-zinc-800">
            <div className="flex items-center gap-2 px-2 pb-2">
              <button
                onClick={() => toggleMark("bookmark")}
                disabled={bookmarksBusy}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800 ${FOCUS_RING} ${marksByIndex.get(current)?.bookmark
                  ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                  : "border border-zinc-300 dark:border-zinc-700"
                  }`}
              >
                <BookmarkIcon className="h-3.5 w-3.5" />
                {marksByIndex.get(current)?.bookmark ? "Bookmarked" : "Bookmark this"}
              </button>
              <button
                onClick={() => toggleMark("highlight")}
                disabled={bookmarksBusy}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800 ${FOCUS_RING} ${marksByIndex.get(current)?.highlight
                  ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                  : "border border-zinc-300 dark:border-zinc-700"
                  }`}
              >
                <Highlighter className="h-3.5 w-3.5" />
                {marksByIndex.get(current)?.highlight ? "Highlighted" : "Highlight this"}
              </button>
            </div>
            {bookmarks.length === 0 ? (
              <p className="px-2 py-1 text-zinc-500">
                No bookmarks yet — select a sentence and bookmark or highlight it.
              </p>
            ) : (
              bookmarks.map((b) => (
                <BookmarkRow
                  key={b.id}
                  bookmark={b}
                  isCurrent={b.sentence_index === current}
                  onJump={() => {
                    selectSentence(b.sentence_index);
                    setPanel(null);
                  }}
                  onDelete={() => deleteMark(b.id)}
                  onSaveNote={(note) => saveNote(b.id, note)}
                />
              ))
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4">
          <ErrorBanner message={error} />
        </div>
      )}

      {editing ? (
        <div className="mt-6 flex flex-1 flex-col gap-3 pb-32">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            aria-label="Document text"
            className="min-h-[60vh] w-full flex-1 resize-y rounded-xl border border-zinc-300 bg-transparent px-4 py-3 outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
            style={{ fontSize, lineHeight }}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={saveText}
              disabled={saving}
              className={`rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60 ${FOCUS_RING}`}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className={`rounded-lg px-4 py-1.5 text-sm transition hover:bg-zinc-100 disabled:opacity-60 dark:hover:bg-zinc-800 ${FOCUS_RING}`}
            >
              Cancel
            </button>
            <span className="text-xs tabular-nums text-zinc-500">
              {draft.length.toLocaleString()} characters
            </span>
          </div>
        </div>
      ) : (
        <article
          className="mt-6 space-y-5 pb-32"
          style={{ fontSize, lineHeight }}
        >
          {isMarkdown ? renderMarkdownBody() : paras.map((sentences, p) => (
            <p key={p}>
              {sentences.map((sentence) => {
                index++;
                const i = index;
                const isCurrent = i === current;
                const marks = marksByIndex.get(i);
                return (
                  <PlainSentence
                    key={i}
                    id={i}
                    text={sentence}
                    isCurrent={isCurrent}
                    words={isCurrent ? words : EMPTY_WORDS}
                    activeWord={isCurrent ? activeWord : -1}
                    highlighted={!!marks?.highlight}
                    bookmarked={!!marks?.bookmark}
                    onSelect={selectSentence}
                  />
                );
              })}
            </p>
          ))}
        </article>
      )}
    </main>
  );
}
