import { describe, expect, test } from "vitest";
import type { SpeechEngine, SpeechEngineUtterance } from "./engine-types";
import { clampSpeechRate, createSpeechPlayback, splitSpeechSegments } from "./playback";

interface Spoken extends SpeechEngineUtterance {
  text: string;
}

function createFakeEngine() {
  const spoken: Spoken[] = [];
  let stops = 0;
  const engine: SpeechEngine = {
    async getVoices() {
      return [{ id: "samantha", name: "Samantha", language: "en-US" }];
    },
    speak(text, utterance) {
      spoken.push({ text, ...utterance });
    },
    stop() {
      stops += 1;
    },
  };
  return {
    engine,
    spoken,
    stops: () => stops,
    last: () => spoken[spoken.length - 1],
    texts: () => spoken.map((item) => item.text),
  };
}

describe("splitSpeechSegments", () => {
  test("splits sentences and lines and drops blanks", () => {
    expect(splitSpeechSegments("One. Two? Three!\n\nFour")).toEqual([
      "One.",
      "Two?",
      "Three!",
      "Four",
    ]);
  });

  test("breaks an overlong sentence on word boundaries", () => {
    const sentence = Array.from({ length: 80 }, (_, index) => `word${index}`).join(" ");
    const segments = splitSpeechSegments(sentence);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.every((segment) => segment.length <= 220)).toBe(true);
    expect(segments.join(" ")).toBe(sentence);
  });
});

describe("clampSpeechRate", () => {
  test("keeps rates between 0.5 and 2 and defaults to 1", () => {
    expect(clampSpeechRate(undefined)).toBe(1);
    expect(clampSpeechRate(Number.NaN)).toBe(1);
    expect(clampSpeechRate(0.1)).toBe(0.5);
    expect(clampSpeechRate(3)).toBe(2);
    expect(clampSpeechRate(1.25)).toBe(1.25);
  });
});

describe("createSpeechPlayback", () => {
  test("speaks each sentence in order and returns to idle", () => {
    const fake = createFakeEngine();
    const speech = createSpeechPlayback(fake.engine);
    const id = speech.speak("First. Second.", { voice: "samantha", rate: 1.5 });

    expect(speech.getState()).toEqual({ status: "playing", playbackId: id, rate: 1.5 });
    expect(fake.last()).toMatchObject({ text: "First.", voice: "samantha", rate: 1.5 });
    fake.last().onDone();
    expect(fake.last().text).toBe("Second.");
    fake.last().onDone();
    expect(speech.getState()).toEqual({ status: "idle" });
  });

  test("a new playback replaces the current one", () => {
    const fake = createFakeEngine();
    const speech = createSpeechPlayback(fake.engine);
    speech.speak("From A. More A.");
    const staleDone = fake.last().onDone;
    const second = speech.speak("From B.");

    expect(fake.stops()).toBe(1);
    expect(speech.getState()).toMatchObject({ status: "playing", playbackId: second });
    staleDone();
    expect(fake.texts()).toEqual(["From A.", "From B."]);
  });

  test("pause stops the sentence and resume restarts it", () => {
    const fake = createFakeEngine();
    const speech = createSpeechPlayback(fake.engine);
    const id = speech.speak("First. Second.");
    fake.last().onDone();
    const interrupted = fake.last();

    speech.pause();
    expect(speech.getState()).toEqual({ status: "paused", playbackId: id, rate: 1 });
    interrupted.onDone();
    expect(fake.texts()).toEqual(["First.", "Second."]);

    speech.resume();
    expect(speech.getState()).toMatchObject({ status: "playing" });
    expect(fake.texts()).toEqual(["First.", "Second.", "Second."]);
  });

  test("a rate change restarts the sentence while playing and waits while paused", () => {
    const fake = createFakeEngine();
    const speech = createSpeechPlayback(fake.engine);
    speech.speak("Only sentence.");

    speech.setRate(2);
    expect(fake.last()).toMatchObject({ text: "Only sentence.", rate: 2 });
    expect(fake.spoken).toHaveLength(2);

    speech.pause();
    speech.setRate(0.75);
    expect(fake.spoken).toHaveLength(2);
    expect(speech.getState()).toMatchObject({ status: "paused", rate: 0.75 });
    speech.resume();
    expect(fake.last()).toMatchObject({ text: "Only sentence.", rate: 0.75 });
  });

  test("stop and engine errors end the playback", () => {
    const fake = createFakeEngine();
    const speech = createSpeechPlayback(fake.engine);
    speech.speak("One. Two.");
    speech.stop();
    expect(speech.getState()).toEqual({ status: "idle" });

    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
      speech.speak("Three. Four.");
      fake.last().onError(new Error("engine failed"));
    } finally {
      console.warn = originalWarn;
    }
    expect(speech.getState()).toEqual({ status: "idle" });
  });

  test("text with nothing to say never reaches the engine", () => {
    const fake = createFakeEngine();
    const speech = createSpeechPlayback(fake.engine);
    speech.speak("   \n  ");
    expect(fake.spoken).toHaveLength(0);
    expect(speech.getState()).toEqual({ status: "idle" });
  });

  test("notifies subscribers on every state change", () => {
    const fake = createFakeEngine();
    const speech = createSpeechPlayback(fake.engine);
    const states: string[] = [];
    const unsubscribe = speech.subscribe(() => states.push(speech.getState().status));
    speech.speak("One.");
    speech.pause();
    speech.resume();
    fake.last().onDone();
    unsubscribe();
    speech.speak("Two.");
    expect(states).toEqual(["playing", "paused", "playing", "idle"]);
  });
});
