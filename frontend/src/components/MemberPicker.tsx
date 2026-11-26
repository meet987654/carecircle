import { ChevronRight, HeartHandshake } from "lucide-react";
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
      <div className="picker__card">
        <div className="picker__logo" aria-hidden>
          <HeartHandshake size={34} strokeWidth={2} />
        </div>
        <h1>Who's using this phone?</h1>
        <p className="muted">So the family can see who looked after {recipientName}, and when.</p>
        <div className="picker__list">
          {members.map((m) => (
            <button key={m.id} className="member" onClick={() => onPick(m)}>
              <span className="avatar" aria-hidden>{m.name[0]}</span>
              <span>
                {m.name}
                {m.relation && <small>{m.relation}</small>}
              </span>
              <ChevronRight className="member__go" size={22} aria-hidden />
            </button>
          ))}
        </div>
      </div>
      <p className="picker__foot muted">You can switch person any time from the top of the screen.</p>
    </main>
  );
}
