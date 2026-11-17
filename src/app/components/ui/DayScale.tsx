import { DeltaFlag } from "./Marks";

export type Span = {
  start: Date;
  /** null = still on the clock; drawn up to `now`. */
  end: Date | null;
  flagged?: boolean;
};

export type DayWindow = { startHour: number; endHour: number };

const DEFAULT_WINDOW: DayWindow = { startHour: 6, endHour: 18 };

function hourOfDay(d: Date, dayStart: Date) {
  return (d.getTime() - dayStart.getTime()) / 3600000;
}

/**
 * One fixed window for every row on a screen: 6 am–6 pm, widened to whole
 * hours only when a shift starts earlier or ends later, so nothing is cut off.
 * Each span is measured from the start of its own day.
 */
export function dayWindow(rows: { dayStart: Date; spans: Span[] }[], now: Date): DayWindow {
  let startHour = DEFAULT_WINDOW.startHour;
  let endHour = DEFAULT_WINDOW.endHour;
  for (const row of rows) {
    for (const span of row.spans) {
      const s = hourOfDay(span.start, row.dayStart);
      const e = hourOfDay(span.end ?? now, row.dayStart);
      startHour = Math.min(startHour, Math.max(0, Math.floor(s)));
      endHour = Math.max(endHour, Math.min(24, Math.ceil(e)));
    }
  }
  return { startHour, endHour };
}

function hourLabel(h: number) {
  const hour = h % 24;
  if (hour === 0) return "12 am";
  if (hour === 12) return "12 pm";
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
}

/**
 * Hour ticks on one even step. The step is chosen to land on the window's end;
 * when none does, the end is left unlabelled rather than crowding the last tick.
 */
function axisTicks(window: DayWindow) {
  const span = window.endHour - window.startHour;
  const step = [3, 4, 2, 6].find((s) => span % s === 0 && span / s >= 2 && span / s <= 6);
  if (step) {
    const ticks: number[] = [];
    for (let h = window.startHour; h <= window.endHour; h += step) ticks.push(h);
    return ticks;
  }
  const fallback = span > 18 ? 6 : 3;
  const ticks: number[] = [];
  for (let h = window.startHour; h < window.endHour; h += fallback) ticks.push(h);
  return ticks;
}

export function Axis({ window }: { window: DayWindow }) {
  const total = window.endHour - window.startHour;
  return (
    <div className="axis" aria-hidden="true">
      <span />
      <div className="ticks">
        {axisTicks(window).map((h, i, all) => {
          const left = ((h - window.startHour) / total) * 100;
          const shift = left === 0 ? "0" : left === 100 ? "-100%" : "-50%";
          // With many ticks, every other one hides on a phone so labels never collide
          const minor = all.length > 4 && i % 2 === 1 && i !== all.length - 1;
          return (
            <span
              key={h}
              className={minor ? "tick-minor" : undefined}
              style={{ left: `${left}%`, transform: `translateX(${shift})` }}
            >
              {hourLabel(h)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** A row's spans on the shared window, with the now-line when `now` falls in this day. */
export function Track({
  spans,
  dayStart,
  window,
  now,
  label,
}: {
  spans: Span[];
  dayStart: Date;
  window: DayWindow;
  now: Date;
  label: string;
}) {
  const total = window.endHour - window.startHour;
  const pct = (d: Date) =>
    Math.min(100, Math.max(0, ((hourOfDay(d, dayStart) - window.startHour) / total) * 100));
  const dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);
  const showNow = now >= dayStart && now < dayEnd;

  return (
    <div className="track" role="img" aria-label={label}>
      {spans.map((span, i) => {
        const left = pct(span.start);
        const right = 100 - pct(span.end ?? now);
        return (
          <span key={i}>
            {span.flagged ? (
              <DeltaFlag className="flag" style={{ left: `calc(${left}% - 17px)` }} />
            ) : null}
            <span className="bar" style={{ left: `${left}%`, right: `${right}%` }} />
          </span>
        );
      })}
      {showNow ? <span className="now" style={{ left: `${pct(now)}%` }} /> : null}
    </div>
  );
}
