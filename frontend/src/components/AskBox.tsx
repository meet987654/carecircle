import { useEffect, useRef, useState } from "react";
import { api, ask, type Turn } from "../api";

interface Props {
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

// How many earlier turns to send. Enough for follow-ups, small enough to keep prompts short.
const MAX_HISTORY = 6;

export function AskBox({ recipientName }: Props) {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [answer, setAnswer] = useState("");
  const [state, setState] = useState<State>("idle");
  const [latency, setLatency] = useState<number | null>(null);
  const [interactionId, setInteractionId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  // Finished turns of this conversation, oldest first (the current one is not in here yet).
  const [turns, setTurns] = useState<Turn[]>([]);
  const answerRef = useRef("");
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
    // The answer on screen becomes part of the history this question is asked with.
    const history =
      state === "done" && asked ? [...turns, { question: asked, answer: answerRef.current }].slice(-MAX_HISTORY) : turns;
    setTurns(history);
    answerRef.current = "";
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
        history,
        {
          onMeta: (m) => setInteractionId(m.interaction_id),
          onToken: (t) => {
            answerRef.current += t;
            setAnswer(answerRef.current);
          },
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

  function startOver() {
    abortRef.current?.abort();
    setTurns([]);
    setAsked("");
    setAnswer("");
    answerRef.current = "";
    setState("idle");
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
          placeholder={
            listening
              ? "Listening…"
              : state === "idle"
                ? `e.g. Did ${recipientName} take the 8 pm tablet?`
                : "Ask a follow-up…"
          }
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
          {state !== "streaming" && (
            <button type="button" className="btn btn--text start-over" onClick={startOver}>
              Start over
            </button>
          )}
        </>
      )}
    </section>
  );
}
