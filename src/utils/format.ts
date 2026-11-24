// Display helpers shared by the Redline screens.

/** "4 h 38 m" from a duration in milliseconds (rounded down to the minute). */
export function formatDuration(ms: number) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h} h ${String(m).padStart(2, "0")} m`;
}

/** "6:58 am" in the viewer's local time. */
export function formatTime(value: string | Date) {
  return new Date(value)
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .replace("AM", "am")
    .replace("PM", "pm");
}

/** "Wed Oct 21" */
export function formatDay(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** "MB" from "Marco Bellini"; "?" when there is no name. */
export function initials(name: string | null | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

// Pale identity tints, at least 60° apart in hue. Identity only, never data.
const TINTS = [
  { bg: "#e3eefb", fg: "#1d4f8a" },
  { bg: "#e3f4e8", fg: "#24603a" },
  { bg: "#f6efdc", fg: "#6d5212" },
  { bg: "#f3e6f6", fg: "#6b2f7a" },
  { bg: "#e0f3f2", fg: "#1d5f5b" },
  { bg: "#eceae4", fg: "#4c4a43" },
  { bg: "#fbe8de", fg: "#7a3a17" },
  { bg: "#e8ecf7", fg: "#33437a" },
];

/** A stable tint per person, derived from their id. */
export function personTint(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return TINTS[hash % TINTS.length];
}

/** Start of the viewer's local day. */
export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
