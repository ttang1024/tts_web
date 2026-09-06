import { useEffect, useRef, useState } from "react";
import {
  segmentText,
  segmentMarkdown,
  stripMarkdown,
  PlaybackController,
  VOICES,
  type PlaybackAdapter,
} from "@/lib/shared";
import { fetchDocument, patchDocument, type DocumentSummary } from "@/lib/documents";
import { loadVoicePref } from "@/lib/voicePref";
import { synthesizeSentence, type SentenceAudio } from "@/lib/tts";

// Drives queue playback (Play all / Play selected) inline on the library
// list instead of opening the full Reader — same sentence-by-sentence
// engine Reader.tsx uses (shared/playback.ts), but with no sentence view,
// editing, bookmarks, etc.: just a title, position, and transport controls
// for MiniPlayerBar. Re-fetches and restarts from scratch whenever the
// queue advances to a new document (mirrors Reader's `key={reading.id}`
// full-remount-per-document behavior).
export function useMiniPlayer(queue: DocumentSummary[] | null, queueIndex: number, onEnded: () => void) {
  const doc = queue?.[queueIndex] ?? null;
  const docId = doc?.id ?? null;

  const [title, setTitle] = useState("");
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const controllerRef = useRef<PlaybackController<SentenceAudio> | null>(null);
  const flatRef = useRef<string[]>([]);
  const isMarkdownRef = useRef(false);
  const voiceRef = useRef(VOICES[0].id);
  const currentRef = useRef(0);
  currentRef.current = current;
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  useEffect(() => {
    if (docId == null) return;
    let cancelled = false;
    setTitle(doc?.title ?? "");
    setCurrent(0);
    setTotal(0);
    setPlaying(false);
    setLoading(true);
    setError(null);

    const audio = new Audio();
    const adapter: PlaybackAdapter<SentenceAudio> = {
      fetchSource(index, voiceId) {
        const text = isMarkdownRef.current
          ? stripMarkdown(flatRef.current[index])
          : flatRef.current[index];
        return synthesizeSentence(text, voiceId);
      },
      async loadAndPlay(_index, source, rate) {
        audio.src = source.url;
        audio.playbackRate = rate;
        await audio.play();
      },
      async resume(rate) {
        audio.playbackRate = rate;
        await audio.play();
      },
      canResume() {
        return !!audio.src && audio.currentTime > 0 && !audio.ended;
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
      { setCurrent, setPlaying, setLoading, setError },
      { voice: VOICES[0].id, speed: 1, current: 0, playing: false, loading: false, flatLength: 0 }
    );
    controllerRef.current = controller;

    audio.onended = () => {
      const i = currentRef.current;
      if (i + 1 < flatRef.current.length) void controller.playFrom(i + 1);
      else {
        setPlaying(false);
        onEndedRef.current();
      }
    };

    (async () => {
      try {
        const full = await fetchDocument(docId);
        if (cancelled) return;
        const markdown = full.source_type === "file" && /\.(md|markdown)$/i.test(full.source ?? "");
        const flat = (markdown ? segmentMarkdown(full.text) : segmentText(full.text)).flat();
        if (flat.length === 0) throw new Error("No readable text found.");
        flatRef.current = flat;
        isMarkdownRef.current = markdown;
        const voice = full.voice ?? loadVoicePref();
        voiceRef.current = voice;
        setTitle(full.title);
        setTotal(flat.length);
        const startIndex = Math.min(Math.max(full.progress_index, 0), flat.length - 1);
        controller.sync({ voice, speed: 1, current: startIndex, playing: false, loading: false }, flat.length);
        if (cancelled) return;
        void controller.playFrom(startIndex, voice);
      } catch (err) {
        if (!cancelled) {
          setLoading(false);
          setError(err instanceof Error ? err.message : "Failed to load document.");
        }
      }
    })();

    return () => {
      cancelled = true;
      audio.onended = null;
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // Persist reading position as the queue advances through sentences.
  useEffect(() => {
    if (docId == null) return;
    const timer = setTimeout(() => patchDocument(docId, { progressIndex: current }), 1000);
    return () => clearTimeout(timer);
  }, [docId, current]);

  controllerRef.current?.sync(
    { voice: voiceRef.current, speed: 1, current, playing, loading },
    flatRef.current.length
  );

  return {
    title,
    current,
    total,
    playing,
    loading,
    error,
    togglePlay: () => controllerRef.current?.togglePlay(),
  };
}
