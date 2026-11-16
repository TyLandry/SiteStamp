export type PayFrequency = "weekly" | "biweekly" | "semi_monthly" | "monthly";
export type PaySettings = { pay_frequency: PayFrequency; period_anchor_date: string };

export const DEFAULT_PAY_SETTINGS: PaySettings = {
  pay_frequency: "biweekly",
  period_anchor_date: "2026-01-05",
};

export const PAY_FREQUENCY_LABELS: Record<PayFrequency, string> = {
  weekly: "Weekly",
  biweekly: "Every two weeks",
  semi_monthly: "Twice a month (1st–15th, 16th–end)",
  monthly: "Monthly",
};

// All local dates — avoids the off-by-one-day UTC shift
export function parseLocalDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toDateInput(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function addDays(date: Date, n: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

export function daysBetween(a: Date, b: Date) {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / 86400000);
}

export function getPeriod(settings: PaySettings, ref: Date) {
  const day = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const y = day.getFullYear();
  const m = day.getMonth();

  switch (settings.pay_frequency) {
    case "weekly":
    case "biweekly": {
      const length = settings.pay_frequency === "weekly" ? 7 : 14;
      const anchor = parseLocalDate(settings.period_anchor_date);
      const index = Math.floor(daysBetween(anchor, day) / length);
      const start = addDays(anchor, index * length);
      return { start, end: addDays(start, length - 1) };
    }
    case "semi_monthly":
      return day.getDate() <= 15
        ? { start: new Date(y, m, 1), end: new Date(y, m, 15) }
        : { start: new Date(y, m, 16), end: new Date(y, m + 1, 0) };
    case "monthly":
    default:
      return { start: new Date(y, m, 1), end: new Date(y, m + 1, 0) };
  }
}

export function fmtDate(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}