// Distance between a clock event and its job site, and how sure we can be
// that it was outside the site's allowed radius.

export const DEFAULT_SITE_RADIUS_M = 200;
export const MIN_SITE_RADIUS_M = 25;
export const MAX_SITE_RADIUS_M = 5000;

export type LatLng = { lat: number; lng: number };

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** A stored pair, or null if either half is missing or out of range. */
export function toLatLng(lat: number | string | null | undefined, lng: number | string | null | undefined): LatLng | null {
  if (lat == null || lng == null) return null;
  const a = Number(lat);
  const b = Number(lng);
  return isValidLatLng(a, b) ? { lat: a, lng: b } : null;
}

/** Great-circle distance in metres (haversine, mean Earth radius). */
export function distanceMeters(a: LatLng, b: LatLng) {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type SiteCheck =
  | { status: "no_location" }
  | { status: "no_site" }
  | { status: "no_pin" }
  | { status: "inside" | "uncertain" | "outside"; distance: number; accuracy: number | null; radius: number };

/**
 * inside:    within the radius
 * uncertain: past the radius, but the reported GPS accuracy could put it inside
 * outside:   past the radius even allowing for the reported accuracy (or the
 *            device reported no accuracy)
 * Phone GPS is self-reported and can be wrong or spoofed; this is a prompt to
 * review, not proof.
 */
export function checkAgainstSite(
  point: LatLng | null,
  accuracy: number | null,
  site: { latitude: number | null; longitude: number | null; radius_m: number } | null
): SiteCheck {
  if (!point) return { status: "no_location" };
  if (!site) return { status: "no_site" };
  const pin = toLatLng(site.latitude, site.longitude);
  if (!pin) return { status: "no_pin" };
  const distance = distanceMeters(point, pin);
  const radius = Number(site.radius_m);
  const acc = accuracy != null && Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null;
  if (distance <= radius) return { status: "inside", distance, accuracy: acc, radius };
  if (acc != null && distance - acc <= radius) return { status: "uncertain", distance, accuracy: acc, radius };
  return { status: "outside", distance, accuracy: acc, radius };
}

/** "85 m" / "1.4 km" */
export function formatDistance(m: number) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

/** Google Maps link for a coordinate pair. */
export function mapLinkFor(p: LatLng) {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}
