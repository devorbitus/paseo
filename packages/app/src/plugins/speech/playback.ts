import type { SpeechApi, SpeechOptions, SpeechPlaybackState } from "@getpaseo/plugin/client/speech";
import type { SpeechEngine } from "./engine-types";

const MIN_RATE = 0.5;
const MAX_RATE = 2;
// Short utterances keep pause, resume, and rate changes responsive, and stay under Chromium's
// habit of dropping long utterances partway through.
const MAX_SEGMENT_CHARS = 220;
const IDLE: SpeechPlaybackState = { status: "idle" };

export function clampSpeechRate(rate: number | undefined): number {
  if (rate === undefined || !Number.isFinite(rate)) return 1;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
}

function splitLongSegment(segment: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (const word of segment.split(/\s+/)) {
    if (!word) continue;
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > MAX_SEGMENT_CHARS && current) {
      parts.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** Splits text into sentence-sized utterances. */
export function splitSpeechSegments(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
    .flatMap((sentence) =>
      sentence.length > MAX_SEGMENT_CHARS ? splitLongSegment(sentence) : [sentence],
    );
}

interface ActivePlayback {
  id: string;
  segments: string[];
  index: number;
  voice: string | null;
  rate: number;
  paused: boolean;
}

/**
 * The single app-wide playback. Pause stops the engine and remembers the segment, and resume
 * speaks that segment again, so pausing works the same on engines that cannot pause.
 */
export function createSpeechPlayback(engine: SpeechEngine): SpeechApi {
  const listeners = new Set<() => void>();
  let state: SpeechPlaybackState = IDLE;
  let active: ActivePlayback | null = null;
  let generation = 0;
  let nextId = 1;

  function publish() {
    state = active
      ? { status: active.paused ? "paused" : "playing", playbackId: active.id, rate: active.rate }
      : IDLE;
    for (const listener of listeners) listener();
  }

  function finish() {
    active = null;
    publish();
  }

  function speakCurrent() {
    const playback = active;
    if (!playback) return;
    const token = ++generation;
    const isCurrent = () => token === generation && active === playback;
    engine.speak(playback.segments[playback.index], {
      voice: playback.voice,
      rate: playback.rate,
      onDone() {
        if (!isCurrent()) return;
        playback.index += 1;
        if (playback.index >= playback.segments.length) finish();
        else speakCurrent();
      },
      onError(error) {
        if (!isCurrent()) return;
        console.warn("[Speech] Playback failed", error);
        finish();
      },
    });
  }

  function interrupt() {
    generation += 1;
    engine.stop();
  }

  return {
    getVoices: () => engine.getVoices(),
    speak(text: string, options: SpeechOptions = {}) {
      const id = `speech-${nextId++}`;
      if (active) interrupt();
      const segments = splitSpeechSegments(text);
      if (segments.length === 0) {
        finish();
        return id;
      }
      active = {
        id,
        segments,
        index: 0,
        voice: options.voice ?? null,
        rate: clampSpeechRate(options.rate),
        paused: false,
      };
      publish();
      speakCurrent();
      return id;
    },
    pause() {
      if (!active || active.paused) return;
      interrupt();
      active.paused = true;
      publish();
    },
    resume() {
      if (!active || !active.paused) return;
      active.paused = false;
      publish();
      speakCurrent();
    },
    stop() {
      if (!active) return;
      interrupt();
      finish();
    },
    setRate(rate: number) {
      if (!active) return;
      const next = clampSpeechRate(rate);
      if (next === active.rate) return;
      active.rate = next;
      if (active.paused) {
        publish();
        return;
      }
      interrupt();
      publish();
      speakCurrent();
    },
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
