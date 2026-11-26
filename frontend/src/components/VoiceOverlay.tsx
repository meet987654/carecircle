import { useEffect, useRef } from "react";

export type VoiceState = "off" | "starting" | "listening" | "hearing" | "transcribing" | "thinking" | "speaking";

interface Props {
  state: Exclude<VoiceState, "off">;
  level: number; // microphone level 0..1 while listening
  question: string; // what was heard, once transcribed
  answer: string; // streams in while thinking/speaking
  recipientName: string;
  onEnd: () => void;
  onSkip: () => void;
  onDoneTalking: () => void;
}

const STATUS: Record<Props["state"], string> = {
  starting: "Starting…",
  listening: "Listening…",
  hearing: "Listening…",
  transcribing: "One moment…",
  thinking: "Thinking…",
  speaking: "",
};

/**
 * Full-screen, Siri-style voice mode: a frosted overlay, a glow around the screen
 * edge, and an orb that follows the microphone while listening, swirls while
 * thinking and breathes while speaking.
 */
export function VoiceOverlay({ state, level, question, answer, recipientName, onEnd, onSkip, onDoneTalking }: Props) {
  const endRef = useRef<HTMLButtonElement>(null);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const listening = state === "listening" || state === "hearing" || state === "starting";
  const showTurn = !listening && state !== "transcribing" && question;

  // Behave like a modal: lock page scroll, focus the main control, Escape ends.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    endRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onEndRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const mic = listening ? Math.min(1, level * 1.4) : 0;

  return (
    <div
      className={`siri siri--${state}`}
      role="dialog"
      aria-modal="true"
      aria-label="Voice assistant"
      style={{ "--level": mic } as React.CSSProperties}
    >
      <div className="siri__edge" aria-hidden />
      <div className="siri__edge siri__edge--sharp" aria-hidden />

      <div className="siri__body">
        <div className="orb" aria-hidden>
          <span className="orb__glow" />
          <span className="orb__core" />
          <span className="orb__shine" />
        </div>

        <p className="siri__status" role="status" aria-live="polite">
          {STATUS[state]}
        </p>

        {showTurn ? (
          <div className="siri__turn">
            <p className="siri__question">{question}</p>
            <p className="siri__answer" aria-live="polite">
              {answer}
            </p>
          </div>
        ) : (
          <p className="siri__prompt">
            {state === "transcribing" ? "" : `Ask about ${recipientName}'s day: medicines, appointments, who did what.`}
          </p>
        )}
      </div>

      <div className="siri__controls">
        {state === "hearing" && (
          <button type="button" className="glass-btn" onClick={onDoneTalking}>
            Done talking
          </button>
        )}
        {state === "speaking" && (
          <button type="button" className="glass-btn" onClick={onSkip}>
            Skip
          </button>
        )}
        <button ref={endRef} type="button" className="glass-btn glass-btn--end" onClick={onEnd}>
          End
        </button>
      </div>
    </div>
  );
}
