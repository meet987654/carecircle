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
  const [asked, setAsked] = useState("");
  const [answer, setAnswer] = useState("");
  const [state, setState] = useState<State>("idle");
  const [latency, setLatency] = useState<number | null>(null);
  const [interactionId, setInteractionId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const suggestions = ["What's still pending?", `Has ${recipientName} had the medicines?`, "Who did what today?"];

  async function submit(q: string) {
    const text = q.trim();
    if (!text || state === "streaming") return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setAsked(text);
    setQuestion("");
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
    rec.onresult = (e) => void submit(e.results[0][0].transcript);
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
    <section className="panel" aria-labelledby="ask-title">
      <span className="label">Assistant</span>
      <h2 id="ask-title" className="panel__title display">
        Ask about today
      </h2>
      <p className="panel__sub">Answers come only from today's list, never from guesswork.</p>

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
          placeholder={listening ? "Listening…" : `e.g. Did ${recipientName} take the 8 pm tablet?`}
          aria-label="Your question"
          enterKeyHint="send"
        />
        {SpeechRecognitionImpl && (
          <button
            type="button"
            className={`btn btn--quiet ${listening ? "btn--live" : ""}`}
            onClick={toggleVoice}
            aria-pressed={listening}
          >
            {listening ? "Stop" : "Speak"}
          </button>
        )}
        <button className="btn btn--primary" disabled={state === "streaming" || !question.trim()}>
          Ask
        </button>
      </form>

      {state === "idle" ? (
        <div className="prompts">
          {suggestions.map((s) => (
            <button key={s} type="button" className="prompt" onClick={() => void submit(s)}>
              {s}
            </button>
          ))}
        </div>
      ) : (
        <figure className={`answer answer--${state}`}>
          <blockquote className="answer__q">“{asked}”</blockquote>
          <p className="answer__text" aria-live="polite" aria-busy={state === "streaming"}>
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
      )}
    </section>
  );
}
