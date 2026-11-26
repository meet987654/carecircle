/**
 * Voice agent, browser side. A cascaded, turn-by-turn pipeline:
 *
 *   listen (mic + silence detection) -> transcribe (server Whisper, or the browser's
 *   own recognizer) -> ask (the normal streaming assistant) -> speak (sentence by
 *   sentence as the answer streams in) -> listen again for a follow-up.
 *
 * Half-duplex on purpose: we never listen while speaking, so the answer coming out of
 * the phone's speaker can't be heard as a new question. No WebRTC, no telephony.
 */
import { api } from "./api";

export interface VoiceConfig {
  stt: "server" | "browser";
  tts: "server" | "browser";
}

// ---------------------------------------------------------------- capabilities

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  onerror: () => void;
  start: () => void;
  abort: () => void;
};
const SpeechRecognitionImpl: (new () => SpeechRecognitionLike) | undefined =
  (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

export const canRecord = !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
export const canRecognizeInBrowser = !!SpeechRecognitionImpl;
export const voiceSupported = canRecord || canRecognizeInBrowser;

const abortError = () => new DOMException("Aborted", "AbortError");

// ---------------------------------------------------------------- listening

const SILENCE_MS = 1200; // this long quiet after speech = end of the question
const NO_SPEECH_MS = 8000; // nobody said anything: stop listening
const MAX_MS = 30_000;

function pickMimeType(): string {
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

interface RecordOptions {
  signal: AbortSignal; // cancel everything
  finishNow?: AbortSignal; // "Done talking" tapped: stop and keep what was said
  onLevel?: (level: number) => void; // 0..1, for the meter
  onSpeech?: () => void; // first moment we hear speech
}

/**
 * Record one spoken question. Ends by itself after a pause, using a tiny energy-based
 * voice activity detector (RMS against a noise floor measured in the first 300 ms).
 * Resolves with the audio, or null if nobody spoke.
 */
export async function recordUtterance({ signal, finishNow, onLevel, onSpeech }: RecordOptions): Promise<Blob | null> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  if (signal.aborted) {
    stream.getTracks().forEach((t) => t.stop());
    throw abortError();
  }
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start(250);

  return new Promise<Blob | null>((resolve, reject) => {
    const started = performance.now();
    let last = started;
    let floor = 0.005;
    let speechMs = 0;
    let lastVoice = 0;
    let heard = false;
    let settled = false;

    const cleanup = () => {
      window.clearInterval(timer);
      signal.removeEventListener("abort", onAbort);
      finishNow?.removeEventListener("abort", onFinishNow);
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      onLevel?.(0);
    };
    const finish = (keep: boolean) => {
      if (settled) return;
      settled = true;
      recorder.onstop = () => {
        cleanup();
        resolve(keep && chunks.length ? new Blob(chunks, { type: recorder.mimeType || mimeType }) : null);
      };
      recorder.stop();
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
      cleanup();
      reject(abortError());
    };
    const onFinishNow = () => finish(heard);
    signal.addEventListener("abort", onAbort);
    finishNow?.addEventListener("abort", onFinishNow);

    const timer = window.setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += v * v;
      const rms = Math.sqrt(sum / samples.length);
      onLevel?.(Math.min(1, rms * 10));

      if (now - started < 300) {
        floor = Math.min(0.04, Math.max(floor, rms)); // room noise
        return;
      }
      if (rms > Math.max(0.015, floor * 2.5)) {
        speechMs += dt;
        lastVoice = now;
        if (!heard && speechMs > 200) {
          heard = true;
          onSpeech?.();
        }
      }
      if (heard && now - lastVoice > SILENCE_MS) finish(true);
      else if (!heard && now - started > NO_SPEECH_MS) finish(false);
      else if (now - started > MAX_MS) finish(heard);
    }, 50);
  });
}

/** Fallback when the server has no speech-to-text: the browser's own recognizer. */
export function recognizeInBrowser(signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!SpeechRecognitionImpl) return resolve("");
    const rec = new SpeechRecognitionImpl();
    rec.lang = "en-IN";
    rec.interimResults = false;
    let text = "";
    rec.onresult = (e) => (text = e.results[0][0].transcript);
    rec.onend = () => resolve(text);
    rec.onerror = () => resolve(text);
    signal.addEventListener("abort", () => {
      rec.abort();
      reject(abortError());
    });
    rec.start();
  });
}

// Whisper sometimes "hears" these in background noise. Treat them as silence.
const PHANTOM = new Set(["", "you", "thank you", "thanks", "thank you for watching", "bye", "okay"]);
export const isPhantom = (text: string) => PHANTOM.has(text.toLowerCase().replace(/[^a-z ]/g, "").trim());

// ---------------------------------------------------------------- speaking

let chosenVoice: SpeechSynthesisVoice | null | undefined;
function browserVoice(): SpeechSynthesisVoice | null {
  if (chosenVoice !== undefined) return chosenVoice;
  const english = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
  if (!english.length) return null; // voices load async; try again next sentence
  const natural = english.filter((v) => /natural|neural|premium|enhanced/i.test(v.name));
  chosenVoice =
    natural.find((v) => v.lang === "en-IN") ??
    natural[0] ??
    english.find((v) => v.lang === "en-IN") ??
    english.find((v) => v.default) ??
    english[0];
  return chosenVoice;
}
if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => (chosenVoice = undefined);

function speakInBrowser(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    const voice = browserVoice();
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? "en-IN";
    // Some browsers occasionally never fire "end"; don't let that stall the conversation.
    const guard = window.setTimeout(resolve, 1500 + text.length * 90);
    u.onend = u.onerror = () => {
      window.clearTimeout(guard);
      resolve();
    };
    speechSynthesis.speak(u);
  });
}

function playAudio(blob: Blob, onAudio: (a: HTMLAudioElement | null) => void): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    onAudio(audio);
    const done = () => {
      URL.revokeObjectURL(url);
      onAudio(null);
      resolve();
    };
    audio.onended = audio.onerror = audio.onpause = done;
    audio.play().catch(done);
  });
}

const ABBREVIATIONS = /\b(?:Dr|Mr|Mrs|Ms|St|No|vs)\.$/;

/**
 * Speaks an answer while it is still streaming: text is cut into sentences and each
 * one is spoken as soon as it's complete, so the first words play well before the
 * full answer has arrived. With a server voice, each sentence's audio is fetched the
 * moment the sentence is complete, so it's usually ready before the previous one ends.
 */
export class Speaker {
  private buffer = "";
  private queue: Promise<void> = Promise.resolve();
  private stopped = false;
  private audio: HTMLAudioElement | null = null;

  constructor(
    private mode: VoiceConfig["tts"],
    private onStart?: () => void,
  ) {}

  push(text: string) {
    this.buffer += text;
    const sentence = /[.!?](?=\s)/g;
    let cut = 0;
    let m: RegExpExecArray | null;
    while ((m = sentence.exec(this.buffer))) {
      const candidate = this.buffer.slice(cut, m.index + 1);
      if (ABBREVIATIONS.test(candidate)) continue; // "Dr. Mehta" is one sentence
      this.say(candidate.trim());
      cut = m.index + 1;
    }
    this.buffer = this.buffer.slice(cut);
  }

  /** Speak whatever is left; resolves when everything has been spoken (or stopped). */
  finish(): Promise<void> {
    if (this.buffer.trim()) this.say(this.buffer.trim());
    this.buffer = "";
    return this.queue;
  }

  stop() {
    this.stopped = true;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    this.audio?.pause();
  }

  private say(sentence: string) {
    if (!sentence || this.stopped) return;
    const clip = this.mode === "server" ? api.speak(sentence).catch(() => null) : null;
    this.queue = this.queue.then(async () => {
      if (this.stopped) return;
      const blob = clip ? await clip : null;
      if (this.stopped) return;
      this.onStart?.();
      if (blob) await playAudio(blob, (a) => (this.audio = a));
      else await speakInBrowser(sentence); // browser voice, or the server voice failed
    });
  }
}
