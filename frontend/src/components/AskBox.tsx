import { useEffect, useRef, useState } from "react";
import { api, ask } from "../api";

interface Props {
  memberId: number | null;
  recipientName: string;
}

// Minimal typing for the Web Speech API (not in TS's DOM lib).
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  onerror: () => void;
  start: () => void;
  stop: () => void;
};
const SpeechRecognitionImpl: (new () => SpeechRecognitionLike) | undefined =
  (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

type State = "idle" | "streaming" | "done" | "error";

export function AskBox({ memberId, recipientName }: Props) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [state, setState] = useState<State>("idle");
  const [latency, setLatency] = useState<number | null>(null);
  const [interactionId, setInteractionId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const suggestions = [
    "What's still pending?",
    `Has ${recipientName} had the medicines?`,
    "What happened today?",
  ];

  async function submit(q: string) {
    const text = q.trim();
    if (!text || state === "streaming") return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setQuestion(text);
    setAnswer("");
    setLatency(null);
    setFeedback(null);
    setInteractionId(null);
    setState("streaming");
    try {
      await ask(
        text,
        memberId,
        {
          onMeta: (m) => setInteractionId(m.interaction_id),
          onToken: (t) => setAnswer((a) => a + t),
          onDone: (d) => {
            setLatency(d.latency_ms);
            setState("done");
          },
          onError: (msg) => {
            setAnswer(msg);
            setState("error");
          },
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setAnswer("Couldn't reach the assistant. Check your connection and try again.");
        setState("error");
      }
    }
  }

  function toggleVoice() {
    if (!SpeechRecognitionImpl) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const rec = new SpeechRecognitionImpl();
    rec.lang = "en-IN";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const heard = e.results[0][0].transcript;
      setQuestion(heard);
      void submit(heard);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  async function rate(helpful: boolean) {
    if (interactionId == null) return;
    setFeedback(helpful);
    await api.feedback(interactionId, helpful).catch(() => setFeedback(null));
  }

  return (
    <section className="ask" aria-labelledby="ask-title">
      <h2 id="ask-title" className="section__title">Ask about today</h2>
      <form
        className="ask__form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(question);
        }}
      >
        <input
          className="input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={`e.g. Did ${recipientName} take the 8 pm tablet?`}
          aria-label="Your question"
          enterKeyHint="send"
        />
        {SpeechRecognitionImpl && (
          <button
            type="button"
            className={`btn btn--icon ${listening ? "btn--listening" : ""}`}
            onClick={toggleVoice}
            aria-label={listening ? "Stop listening" : "Ask by voice"}
            aria-pressed={listening}
          >
            🎤
          </button>
        )}
        <button className="btn btn--primary" disabled={state === "streaming" || !question.trim()}>
          Ask
        </button>
      </form>

      {state === "idle" && (
        <div className="chips">
          {suggestions.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => void submit(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {state !== "idle" && (
        <div className={`answer answer--${state}`} aria-live="polite" aria-busy={state === "streaming"}>
          <p>
            {answer}
            {state === "streaming" && <span className="caret" aria-hidden />}
          </p>
          {state === "done" && (
            <div className="answer__foot">
              <span className="muted">From today's list{latency != null && ` · ${(latency / 1000).toFixed(1)} s`}</span>
              <span className="answer__rate">
                {feedback == null ? (
                  <>
                    <button className="btn btn--ghost btn--small" onClick={() => void rate(true)} aria-label="Helpful">👍</button>
                    <button className="btn btn--ghost btn--small" onClick={() => void rate(false)} aria-label="Not helpful">👎</button>
                  </>
                ) : (
                  <span className="muted">Thanks</span>
                )}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
