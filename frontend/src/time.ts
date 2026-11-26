// All times are shown in the care recipient's timezone, whatever the phone's own timezone is.

export function fmtTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone, hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date(iso))
    .replace(/\s?([ap])\.?m\.?/i, (_, p: string) => ` ${p.toLowerCase()}m`);
}

/** "8:00 pm" -> { clock: "8:00", period: "pm" } so the two can be set in different type. */
export function timeParts(iso: string, timeZone: string): { clock: string; period: string } {
  const [clock, period = ""] = fmtTime(iso, timeZone).split(" ");
  return { clock, period };
}

export function fmtDay(isoDate: string, short = false): string {
  // isoDate is a plain calendar date ("2026-11-26"); format it without timezone shifts.
  const [y, m, d] = isoDate.split("-").map(Number);
  const style = short ? "short" : "long";
  return new Intl.DateTimeFormat("en-IN", { weekday: style, day: "numeric", month: style, timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

export function localDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(iso)); // YYYY-MM-DD
}

function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "2 h 10 min late", "in 25 min", "due now". */
export function relative(iso: string, now: number): string {
  const minutes = Math.round((new Date(iso).getTime() - now) / 60000);
  if (Math.abs(minutes) < 2) return "due now";
  return minutes < 0 ? `${duration(-minutes)} late` : `in ${duration(minutes)}`;
}

/** Current wall-clock "HH:MM" in a timezone, rounded up to the next quarter hour. */
export function nextQuarterHour(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date())
    .split(":")
    .map(Number);
  let total = parts[0] * 60 + parts[1];
  total = Math.min(Math.ceil((total + 1) / 15) * 15, 23 * 60 + 45);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
