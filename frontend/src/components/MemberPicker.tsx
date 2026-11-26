import type { Member } from "../types";

interface Props {
  members: Member[];
  recipientName: string;
  onPick: (member: Member) => void;
}

/** Lightweight identity: who is holding this phone. Remembered on the device. */
export function MemberPicker({ members, recipientName, onPick }: Props) {
  return (
    <main className="picker">
      <h1>Who's using this phone?</h1>
      <p className="muted">So everyone can see who looked after {recipientName}, and when.</p>
      <div className="picker__list">
        {members.map((m) => (
          <button key={m.id} className="btn btn--member" onClick={() => onPick(m)}>
            <span className="avatar" aria-hidden>{m.name[0]}</span>
            <span>
              {m.name}
              {m.relation && <span className="muted"> · {m.relation}</span>}
            </span>
          </button>
        ))}
      </div>
    </main>
  );
}
