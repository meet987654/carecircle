import { useEffect, useRef, useState } from "react";
import { api, ask, type Turn } from "../api";
import {
  Speaker,
  canRecord,
  canRecognizeInBrowser,
  isPhantom,
  recognizeInBrowser,
  recordUtterance,
  voiceSupported,
  type VoiceConfig,
} from "../voice";

interface Props {
  recipientName: string;
}

type State = "idle" | "streaming" | "done" | "error";
type VoiceState = "off" | "starting" | "listening" | "hearing" | "transcribing" | "thinking" | "speaking";

// How many earlier turns to send. Enough for follow-ups, small enough to keep prompts short.
const MAX_HISTORY = 6;

const VOICE_STATUS: Record<Exclude<VoiceState, "off">, string> = {
  starting: "Getting the microphone…",
  listening: "Listening…",
  hearing: "Go on, I'm listening…",
  transcribing: "Got it…",
  thinking: "Checking today's list…",
  speaking: "Speaking…",
};

interface SubmitOptions {
  channel?: "text" | "voice";
  sttMs?: number;
  onToken?: (text: string) => void;
}

/** "Ask about today": one conversation you can type or talk to. */
export function AskBox({ recipientName }: Props) {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [answer, setAnswer] = useState("");
  const [state, setState] = useState<State>("idle");
  const [latency, setLatency] = useState<number | null>(null);
  const [interactionId, setInteractionId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<boolean | null>(null);
  // Finished turns of this conversation, oldest first (the one on screen is not in here yet).
  const [turns, setTurns] = useState<Turn[]>([]);

  const [voice, setVoice] = useState<VoiceState>("off");
  const [level, setLevel] = useState(0);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);

  // The voice loop runs across many renders, so it reads the conversation from refs.
  const convo = useRef({ turns: [] as Turn[], asked: "", answer: "", state: "idle" as State });
  const abortRef = useRef<AbortController | null>(null);
  const voiceRef = useRef<AbortController | null>(null);
  const finishTalkingRef = useRef<AbortController | null>(null);
  const speakerRef = useRef<Speaker | null>(null);
  const configRef = useRef<VoiceConfig | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      voiceRef.current?.abort();
      speakerRef.current?.stop();
    },
    [],
  );

  const suggestions = ["What's still pending?", `Has ${recipientName} had the medicines?`, "Who did what today?"];

  /** Ask one question (typed or spoken). Resolves with the answer, or null if it failed. */
  async function submit(q: string, opts: SubmitOptions = {}): Promise<string | null> {
    const text = q.trim();
    const c = convo.current;
    if (!text || c.state === "streaming") return null;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // The answer on screen becomes part of the history this question is asked with.
    const history =
      c.state === "done" && c.asked ? [...c.turns, { question: c.asked, answer: c.answer }].slice(-MAX_HISTORY) : c.turns;
    convo.current = { turns: history, asked: text, answer: "", state: "streaming" };
    setTurns(history);
    setAsked(text);
    setQuestion("");
    setAnswer("");
    setLatency(null);
    setFeedback(null);
    setInteractionId(null);
    setState("streaming");

    const end = (s: State) => {
      convo.current.state = s;
      setState(s);
    };
    try {
      await ask(
        text,
        history,
        {
          onMeta: (m) => setInteractionId(m.interaction_id),
          onToken: (t) => {
            convo.current.answer += t;
            setAnswer(convo.current.answer);
            opts.onToken?.(t);
          },
          onDone: (d) => {
            setLatency(d.latency_ms);
            end("done");
          },
          onError: (msg) => {
            convo.current.answer = msg;
            setAnswer(msg);
            end("error");
          },
        },
        controller.signal,
        { channel: opts.channel, sttMs: opts.sttMs },
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") return null;
      const msg = "Couldn't reach the assistant. Check your connection and try again.";
      convo.current.answer = msg;
      setAnswer(msg);
      end("error");
    }
    return convo.current.state === "done" ? convo.current.answer : null;
  }

  // ------------------------------------------------------------ voice agent

  /** Hear one question: server Whisper if available, else the browser's recognizer. */
  async function listen(signal: AbortSignal, config: VoiceConfig): Promise<{ text: string; sttMs?: number }> {
    if (config.stt === "server" && canRecord) {
      finishTalkingRef.current = new AbortController();
      const audio = await recordUtterance({
        signal,
        finishNow: finishTalkingRef.current.signal,
        onLevel: setLevel,
        onSpeech: () => setVoice("hearing"),
      });
      if (!audio) return { text: "" };
      setVoice("transcribing");
      const { text, ms } = await api.transcribe(audio);
      return { text: isPhantom(text) ? "" : text, sttMs: ms };
    }
    return { text: await recognizeInBrowser(signal) };
  }

  async function startVoice() {
    if (voiceRef.current) return;
    const controller = new AbortController();
    voiceRef.current = controller;
    setVoiceNote(null);
    setVoice("starting");
    try {
      // Asked every time voice mode starts: it also warms up the server's voice connection.
      const config = await api
        .voiceConfig()
        .catch((): VoiceConfig => configRef.current ?? { stt: "browser", tts: "browser" });
      configRef.current = config;
      if (config.stt === "browser" && !canRecognizeInBrowser) config.stt = "server";

      let quiet = 0;
      while (!controller.signal.aborted) {
        setVoice("listening");
        const { text, sttMs } = await listen(controller.signal, config);
        if (!text.trim()) {
          // Nothing heard twice in a row: the conversation is over.
          if (++quiet >= 2) break;
          continue;
        }
        quiet = 0;
        setVoice("thinking");
        const speaker = new Speaker(config.tts, () => setVoice("speaking"));
        speakerRef.current = speaker;
        const reply = await submit(text, { channel: "voice", sttMs, onToken: (t) => speaker.push(t) });
        if (reply === null) speaker.push("Sorry, I couldn't answer that. ");
        await speaker.finish();
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        const denied = (err as Error).name === "NotAllowedError";
        setVoiceNote(
          denied ? "Microphone access was blocked. Allow it in the browser to talk." : "Voice stopped. Tap Talk to try again.",
        );
      }
    } finally {
      voiceRef.current = null;
      speakerRef.current = null;
      setVoice("off");
      setLevel(0);
    }
  }

  function endVoice() {
    voiceRef.current?.abort();
    speakerRef.current?.stop();
  }

  /** While it's speaking: stop talking and listen for the next question. */
  function interrupt() {
    speakerRef.current?.stop();
  }

  // ------------------------------------------------------------

  function startOver() {
    abortRef.current?.abort();
    endVoice();
    convo.current = { turns: [], asked: "", answer: "", state: "idle" };
    setTurns([]);
    setAsked("");
    setAnswer("");
    setState("idle");
  }

  async function rate(helpful: boolean) {
    if (interactionId == null) return;
    setFeedback(helpful);
    await api.feedback(interactionId, helpful).catch(() => setFeedback(null));
  }

  const voiceOn = voice !== "off";

  return (
    <section className="panel" aria-labelledby="ask-title">
      <span className="label">Assistant</span>
      <h2 id="ask-title" className="panel__title display">
        Ask about today
      </h2>
      <p className="panel__sub">Type or talk. Answers come only from today's list, never from guesswork.</p>

      {voiceOn ? (
        <div className={`voice voice--${voice}`} role="status" aria-live="polite">
          <span className="label">Voice · {recipientName}'s day</span>
          <p className="voice__status">{VOICE_STATUS[voice]}</p>
          <div className="voice__meter" aria-hidden>
            <span
              style={{ transform: `scaleX(${voice === "listening" || voice === "hearing" ? Math.max(0.02, level) : 0})` }}
            />
          </div>
          <div className="voice__actions">
            {voice === "hearing" && (
              <button type="button" className="btn btn--primary" onClick={() => finishTalkingRef.current?.abort()}>
                Done talking
              </button>
            )}
            {voice === "speaking" && (
              <button type="button" className="btn btn--primary" onClick={interrupt}>
                Skip
              </button>
            )}
            <button type="button" className="btn btn--quiet" onClick={endVoice}>
              End
            </button>
          </div>
          <p className="voice__hint">
            {voice === "speaking"
              ? "After the answer, ask a follow-up. Just keep talking."
              : "Ask anything about today. I'll stop listening when you pause."}
          </p>
        </div>
      ) : (
        <form
          className="ask__bar"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(question);
          }}
        >
          <input
            className="input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={state === "idle" ? `e.g. Did ${recipientName} take the 8 pm tablet?` : "Ask a follow-up…"}
            aria-label="Your question"
            enterKeyHint="send"
          />
          {voiceSupported && (
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => void startVoice()}
              disabled={state === "streaming"}
            >
              Talk
            </button>
          )}
          <button className="btn btn--primary" disabled={state === "streaming" || !question.trim()}>
            Ask
          </button>
        </form>
      )}
      {voiceNote && <p className="error voice__note">{voiceNote}</p>}

      {state === "idle" ? (
        <div className="prompts">
          {suggestions.map((s) => (
            <button key={s} type="button" className="prompt" onClick={() => void submit(s)}>
              {s}
            </button>
          ))}
        </div>
      ) : (
        <>
          {turns.length > 0 && (
            <ol className="thread" aria-label="Earlier in this conversation">
              {turns.map((t, i) => (
                <li key={i} className="thread__turn">
                  <p className="answer__q">“{t.question}”</p>
                  <p className="thread__a">{t.answer}</p>
                </li>
              ))}
            </ol>
          )}
          <figure className={`answer answer--${state}`}>
            <blockquote className="answer__q">“{asked}”</blockquote>
            <p className="answer__text" aria-live={voiceOn ? "off" : "polite"} aria-busy={state === "streaming"}>
              {answer ? (
                <>
                  {answer}
                  {state === "streaming" && <span className="caret" aria-hidden />}
                </>
              ) : (
                <span className="thinking">Reading today's list</span>
              )}
            </p>
            {state === "done" && (
              <figcaption className="answer__foot">
                <span className="label num">{latency != null && `Answered in ${(latency / 1000).toFixed(1)} s`}</span>
                <span className="rate">
                  {feedback == null ? (
                    <>
                      Helpful?
                      <button className="btn btn--text" onClick={() => void rate(true)}>
                        Yes
                      </button>
                      <button className="btn btn--text" onClick={() => void rate(false)}>
                        No
                      </button>
                    </>
                  ) : (
                    "Thanks for the feedback"
                  )}
                </span>
              </figcaption>
            )}
          </figure>
          {state !== "streaming" && !voiceOn && (
            <button type="button" className="btn btn--text start-over" onClick={startOver}>
              Start over
            </button>
          )}
        </>
      )}
    </section>
  );
}
