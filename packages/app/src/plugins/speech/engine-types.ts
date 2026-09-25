import type { SpeechVoice } from "@getpaseo/plugin/client/speech";

export interface SpeechEngineUtterance {
  voice: string | null;
  rate: number;
  onDone(): void;
  onError(error: unknown): void;
}

/**
 * One platform speech engine. The playback controller only ever has one utterance in flight and
 * calls `stop` before starting the next, so engines don't queue. Callbacks for a stopped
 * utterance may still fire; the controller ignores them.
 */
export interface SpeechEngine {
  getVoices(): Promise<SpeechVoice[]>;
  speak(text: string, utterance: SpeechEngineUtterance): void;
  stop(): void;
}
