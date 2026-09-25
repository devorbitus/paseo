import * as Speech from "expo-speech";
import type { SpeechVoice } from "@getpaseo/plugin/client/speech";
import type { SpeechEngine } from "./engine-types";

export function createSpeechEngine(): SpeechEngine {
  return {
    async getVoices(): Promise<SpeechVoice[]> {
      const voices = await Speech.getAvailableVoicesAsync();
      return voices.map((voice) => ({
        id: voice.identifier,
        name: voice.name,
        language: voice.language,
      }));
    },
    speak(text, { voice, rate, onDone, onError }) {
      Speech.speak(text, {
        voice: voice ?? undefined,
        rate,
        // Voice mode configures the app's audio session for recording. A separate,
        // system-managed session keeps Read aloud independent of it and handles ducking.
        useApplicationAudioSession: false,
        onDone,
        onError,
      });
    },
    stop() {
      void Speech.stop();
    },
  };
}
