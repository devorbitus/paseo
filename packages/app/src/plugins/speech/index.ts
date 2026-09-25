import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import type { SpeechPlaybackState } from "@getpaseo/plugin/client/speech";
import { isNative } from "@/constants/platform";
import { createSpeechEngine } from "./engine";
import { createSpeechPlayback } from "./playback";

/** The app-wide speech playback plugins reach through `@getpaseo/plugin/client/speech`. */
export const speech = createSpeechPlayback(createSpeechEngine());

// Background audio needs extra iOS configuration Paseo doesn't have, so speech stops instead of
// cutting out mid-sentence. Web keeps playing when the tab is hidden.
if (isNative) {
  AppState.addEventListener("change", (status) => {
    if (status === "background") speech.stop();
  });
}

/** Call before the microphone opens so the app never records its own speech. */
export function stopSpeechForCapture(): void {
  speech.stop();
}

export function useSpeechState(): SpeechPlaybackState {
  return useSyncExternalStore(speech.subscribe, speech.getState, speech.getState);
}
