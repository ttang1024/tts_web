import { adjustSpeed } from "./speed";

// ---------------------------------------------------------------------------
// Sentence-by-sentence playback engine shared by the web reader (HTMLAudio-
// Element) and the native reader (expo-audio). Both platforms drove an
// almost identical hand-written copy of this state machine — fetch-with-
// cache, a "generation" counter so a stale async fetch/load can't clobber a
// newer jump, prefetching ahead, and resume-vs-reload logic — which meant a
// fix to one (see the play()-rejection handling in togglePlay) had to be
// remembered and re-applied to the other. This file is plain TypeScript with
// no DOM/RN/React dependency: each platform supplies a small `PlaybackAdapter`
// that does the actual loading/playing, and drives `sync()` once per render
// the same way the two readers already tracked live state in refs.
// ---------------------------------------------------------------------------

export const PREFETCH_AHEAD = 2;

export type PlaybackAdapter<Source> = {
  // Fetches (uncached — caching is handled by the controller) the audio for
  // one sentence.
  fetchSource(index: number, voiceId: string): Promise<Source>;
  // Loads `source` (for sentence `index`) and starts playback at `rate`.
  // Resolves once playback has actually started; rejects if it couldn't.
  // `isCurrent()` reports whether this call is still the most recent one: an
  // adapter whose loading takes real time (e.g. native's expo-audio, which
  // polls until the player reports ready) should check it before calling
  // play(), so a jump that supersedes this one before it finishes loading
  // doesn't still audibly start playback. A synchronous-enough adapter (the
  // web reader just swaps <audio>.src and awaits play()) can ignore it.
  loadAndPlay(index: number, source: Source, rate: number, isCurrent: () => boolean): Promise<void>;
  // Resumes the currently loaded source at `rate`. Only called when
  // canResume(index) was true for the same index.
  resume(rate: number): Promise<void>;
  // Whether the adapter currently has `index` loaded at a position it can
  // resume from (vs. needing a fresh loadAndPlay).
  canResume(index: number): boolean;
  pause(): void;
  setPlaybackRate(rate: number): void;
  // Releases a cached-but-now-evicted source (e.g. revoking a blob URL).
  // Optional: platforms with nothing to release (native's cache holds plain
  // file URIs cleaned up wholesale) can omit it.
  release?(source: Source): void;
};

export type PlaybackCallbacks<Source> = {
  setCurrent(index: number): void;
  setPlaying(playing: boolean): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  // Called after a fresh (non-resume) load succeeds, with the source that was
  // loaded — e.g. so the web reader can pull word timings off it.
  onLoaded?(index: number, source: Source): void;
};

export type PlaybackState = {
  voice: string;
  speed: number;
  current: number;
  playing: boolean;
  loading: boolean;
};

export class PlaybackController<Source> {
  private cache = new Map<string, Promise<Source>>();
  private generation = 0;
  private state: PlaybackState;
  private flatLength: number;

  constructor(
    private adapter: PlaybackAdapter<Source>,
    private callbacks: PlaybackCallbacks<Source>,
    initial: PlaybackState & { flatLength: number }
  ) {
    this.state = initial;
    this.flatLength = initial.flatLength;
  }

  // Call once per render with the latest values, mirroring the stateRef /
  // flatLenRef pattern both readers already used: async callbacks (onended,
  // fetch resolutions) need to read live state without resubscribing effects.
  sync(state: PlaybackState, flatLength: number): void {
    this.state = state;
    this.flatLength = flatLength;
  }

  private fetchSentence(index: number, voiceId: string): Promise<Source> {
    const key = `${voiceId}|${index}`;
    let promise = this.cache.get(key);
    if (!promise) {
      promise = this.adapter.fetchSource(index, voiceId);
      promise.catch(() => this.cache.delete(key));
      this.cache.set(key, promise);
    }
    return promise;
  }

  // Drops every cached entry, releasing each one if the adapter cares to.
  // Used on unmount and after an in-place edit invalidates prior audio.
  clearCache(): void {
    if (this.adapter.release) {
      for (const entry of this.cache.values()) entry.then((s) => this.adapter.release!(s), () => {});
    }
    this.cache.clear();
  }

  async playFrom(index: number, voiceId: string = this.state.voice): Promise<void> {
    const generation = ++this.generation;
    this.callbacks.setCurrent(index);
    this.callbacks.setPlaying(true);
    this.callbacks.setError(null);
    this.callbacks.setLoading(true);

    for (let i = index + 1; i <= Math.min(index + PREFETCH_AHEAD, this.flatLength - 1); i++) {
      this.fetchSentence(i, voiceId).catch(() => {});
    }

    try {
      const source = await this.fetchSentence(index, voiceId);
      if (generation !== this.generation) return;
      await this.adapter.loadAndPlay(index, source, this.state.speed, () => generation === this.generation);
      if (generation !== this.generation) return;
      this.callbacks.onLoaded?.(index, source);
    } catch (err) {
      if (generation !== this.generation) return;
      this.callbacks.setPlaying(false);
      this.callbacks.setError(err instanceof Error ? err.message : "Playback failed.");
    } finally {
      if (generation === this.generation) this.callbacks.setLoading(false);
    }
  }

  stop(): void {
    this.generation++;
    this.adapter.pause();
    this.callbacks.setPlaying(false);
    this.callbacks.setLoading(false);
  }

  togglePlay(): void {
    if (this.state.playing) {
      this.stop();
      return;
    }
    if (this.adapter.canResume(this.state.current)) {
      const generation = this.generation;
      this.adapter.setPlaybackRate(this.state.speed);
      this.callbacks.setError(null);
      this.callbacks.setPlaying(true);
      this.adapter.resume(this.state.speed).catch((err) => {
        if (generation !== this.generation) return;
        this.callbacks.setPlaying(false);
        this.callbacks.setError(err instanceof Error ? err.message : "Playback failed.");
      });
    } else {
      void this.playFrom(this.state.current);
    }
  }

  step(delta: number): void {
    const next = Math.min(Math.max(this.state.current + delta, 0), this.flatLength - 1);
    if (this.state.playing || this.state.loading) void this.playFrom(next);
    else this.callbacks.setCurrent(next);
  }

  // Returns the new speed; the caller still owns the `speed` state itself.
  stepSpeed(delta: number): number {
    const value = adjustSpeed(this.state.speed, delta);
    this.adapter.setPlaybackRate(value);
    return value;
  }

  changeVoice(id: string): void {
    if (this.state.playing || this.state.loading) void this.playFrom(this.state.current, id);
  }

  // Bumps the generation (invalidating in-flight work) and pauses, without
  // touching React state — for unmount, where setState would warn.
  dispose(): void {
    this.generation++;
    this.adapter.pause();
    this.clearCache();
  }
}
