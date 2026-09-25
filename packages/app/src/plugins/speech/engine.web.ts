import type { SpeechVoice } from "@getpaseo/plugin/client/speech";
import type { SpeechEngine } from "./engine-types";

const VOICES_TIMEOUT_MS = 1000;

function synthesis(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : null;
}

// Chromium fills the voice list asynchronously; the first call often returns nothing.
async function loadVoices(engine: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  const voices = engine.getVoices();
  if (voices.length > 0) return voices;
  const changed = new Promise<void>((resolve) => {
    engine.addEventListener("voiceschanged", () => resolve(), { once: true });
  });
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, VOICES_TIMEOUT_MS));
  await Promise.race([changed, timeout]);
  return engine.getVoices();
}

export function createSpeechEngine(): SpeechEngine {
  return {
    async getVoices(): Promise<SpeechVoice[]> {
      const engine = synthesis();
      if (!engine) return [];
      const voices = await loadVoices(engine);
      return voices.map((voice) => ({
        id: voice.voiceURI,
        name: voice.name,
        language: voice.lang,
      }));
    },
    speak(text, { voice, rate, onDone, onError }) {
      const engine = synthesis();
      if (!engine) {
        onError(new Error("Speech synthesis is not available in this browser"));
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = rate;
      const match = voice ? engine.getVoices().find((item) => item.voiceURI === voice) : null;
      if (match) {
        utterance.voice = match;
        utterance.lang = match.lang;
      }
      utterance.addEventListener("end", () => onDone());
      utterance.addEventListener("error", (event) => {
        // cancel() reports the stopped utterance as interrupted or canceled.
        if (event.error === "interrupted" || event.error === "canceled") return;
        onError(new Error(`Speech synthesis failed: ${event.error}`));
      });
      engine.speak(utterance);
    },
    stop() {
      synthesis()?.cancel();
    },
  };
}
