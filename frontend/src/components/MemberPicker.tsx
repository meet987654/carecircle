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
      <span className="wordmark">
        Care<b>Circle</b>
      </span>
      <span className="label">Welcome</span>
      <h1 className="display">Who's using this phone?</h1>
      <p>So the family can see who looked after {recipientName}, and when.</p>
      <div className="picker__list">
        {members.map((m) => (
          <button key={m.id} className="member" onClick={() => onPick(m)}>
            <span className="initial" aria-hidden>{m.name[0]}</span>
            <span>
              <span className="member__name">{m.name}</span>
              {m.relation && <span className="member__rel">{m.relation}</span>}
            </span>
          </button>
        ))}
      </div>
      <p className="picker__foot">You can switch person any time from the top of the screen.</p>
    </main>
  );
}
