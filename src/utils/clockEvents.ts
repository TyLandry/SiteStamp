// Clock-in / clock-out locations checked against the chosen job site.

import { type SiteCheck, checkAgainstSite, formatDistance, toLatLng } from "@/utils/geo";

export type ClockEntry = {
  id: string;
  profile_id: string;
  clock_in: string;
  clock_out: string | null;
  job_site_id: string | null;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  clock_in_accuracy_m: number | null;
  clock_out_lat: number | null;
  clock_out_lng: number | null;
  clock_out_accuracy_m: number | null;
};

export const CLOCK_ENTRY_FIELDS =
  "id, profile_id, clock_in, clock_out, job_site_id, clock_in_lat, clock_in_lng, clock_in_accuracy_m, clock_out_lat, clock_out_lng, clock_out_accuracy_m";

export type SiteRef = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  radius_m: number;
};

export type Tone = "ok" | "warn" | "bad" | "neutral";

export function clockPoint(e: ClockEntry, which: "in" | "out") {
  return which === "in"
    ? { point: toLatLng(e.clock_in_lat, e.clock_in_lng), accuracy: e.clock_in_accuracy_m != null ? Number(e.clock_in_accuracy_m) : null }
    : { point: toLatLng(e.clock_out_lat, e.clock_out_lng), accuracy: e.clock_out_accuracy_m != null ? Number(e.clock_out_accuracy_m) : null };
}

export function checkEvent(e: ClockEntry, which: "in" | "out", sites: Map<string, SiteRef>): SiteCheck {
  const { point, accuracy } = clockPoint(e, which);
  const site = e.job_site_id ? sites.get(e.job_site_id) ?? null : null;
  return checkAgainstSite(point, accuracy, site);
}

/** Short wording and colour for a check, for lists and map tooltips. */
export function describeCheck(c: SiteCheck): { text: string; tone: Tone } {
  switch (c.status) {
    case "no_location":
      return { text: "Location unavailable", tone: "neutral" };
    case "no_site":
      return { text: "No site chosen", tone: "neutral" };
    case "no_pin":
      return { text: "Site has no map pin", tone: "neutral" };
    case "inside":
      return { text: `${formatDistance(c.distance)} from site · within ${c.radius} m`, tone: "ok" };
    case "uncertain":
      return {
        text: `${formatDistance(c.distance)} from site (GPS ±${formatDistance(c.accuracy ?? 0)}) · may be outside ${c.radius} m`,
        tone: "warn",
      };
    case "outside":
      return {
        text: `${formatDistance(c.distance)} from site${c.accuracy != null ? ` (GPS ±${formatDistance(c.accuracy)})` : " (GPS accuracy unknown)"} · outside ${c.radius} m`,
        tone: "bad",
      };
  }
}
