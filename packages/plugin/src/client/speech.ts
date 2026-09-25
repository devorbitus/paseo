/** A voice the device's speech engine offers. IDs are only meaningful on the device that listed them. */
export interface SpeechVoice {
  id: string;
  name: string;
  /** BCP 47 tag, such as `en-US`. */
  language: string;
}

export interface SpeechOptions {
  /** A `SpeechVoice.id` from this device. Unknown or omitted IDs use the system default voice. */
  voice?: string | null;
  /** 1 is the engine's normal speed. Clamped to 0.5–2. */
  rate?: number;
}

export type SpeechPlaybackState =
  | { status: "idle" }
  | { status: "playing" | "paused"; playbackId: string; rate: number };

/**
 * Speech playback owned by the Paseo app. One playback runs at a time across the app and every
 * plugin: starting one stops the last. Paseo also stops playback when voice mode or dictation
 * starts and when the mobile app moves to the background.
 */
export interface SpeechApi {
  getVoices(): Promise<SpeechVoice[]>;
  /** Starts reading `text` and returns an ID for this playback. */
  speak(text: string, options?: SpeechOptions): string;
  /** Works on every platform: Paseo stops the current sentence and restarts it on resume. */
  pause(): void;
  resume(): void;
  stop(): void;
  /** While playing, restarts the current sentence at the new rate. While paused, applies on resume. */
  setRate(rate: number): void;
  getState(): SpeechPlaybackState;
  subscribe(listener: () => void): () => void;
}

export declare const speech: SpeechApi;

/** The current playback, re-rendering when it changes. */
export declare function useSpeechState(): SpeechPlaybackState;
