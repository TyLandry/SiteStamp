import type { NextRequest } from "next/server";
import { getEmployer } from "@/utils/employerAuth";
import { isValidLatLng } from "@/utils/geo";

// Address ↔ map pin lookups for the job site editor, made from the server so
// the provider's usage policy can be followed in one place:
//  * Nominatim (nominatim.openstreetmap.org) by default: at most 1 request
//    per second for the whole app, an identifying User-Agent, results cached,
//    no autocomplete (lookups only run when the employer asks), attribution
//    shown in the UI. Policy: https://operations.osmfoundation.org/policies/nominatim/
//  * GEOCODER_URL switches to another Nominatim-compatible service (or a
//    self-hosted one) without a code change; GEOCODER_URL=off turns lookups off.
// The 1-per-second limit and cache live in this server process; with several
// instances, use a provider whose limits fit that, or self-host.

const BASE = (process.env.GEOCODER_URL || "https://nominatim.openstreetmap.org").replace(/\/+$/, "");
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const CONTACT = process.env.GEOCODER_CONTACT_EMAIL;
const USER_AGENT = `SiteStamp/0.1 (+${SITE}${CONTACT ? `; ${CONTACT}` : ""})`;

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE = 500;
const cache = new Map<string, { at: number; body: unknown }>();

let chain: Promise<void> = Promise.resolve();
let lastCall = 0;

// Serialize upstream calls at least 1.1 s apart
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const turn = chain.then(async () => {
    const wait = lastCall + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
  });
  chain = turn.catch(() => undefined);
  return turn.then(fn);
}

function remember(key: string, body: unknown) {
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), body });
}

async function upstream(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "User-Agent": USER_AGENT, Referer: SITE, "Accept-Language": "en-CA,en" },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Lookup service answered ${res.status}`);
  return res.json();
}

export async function GET(request: NextRequest) {
  if (!(await getEmployer())) {
    return Response.json({ error: "Not authorized" }, { status: 403 });
  }
  if (BASE === "off") {
    return Response.json({ error: "Address lookup is turned off. Place the pin on the map instead." }, { status: 503 });
  }

  const params = request.nextUrl.searchParams;
  const q = params.get("q")?.trim();
  const lat = params.get("lat");
  const lng = params.get("lng");

  let key: string;
  let path: string;
  if (q != null) {
    if (q.length < 3 || q.length > 200) {
      return Response.json({ error: "Enter an address of 3 to 200 characters." }, { status: 400 });
    }
    key = `q:${q.toLowerCase()}`;
    path = `/search?format=jsonv2&limit=5&countrycodes=ca&q=${encodeURIComponent(q)}`;
  } else {
    const a = Number(lat);
    const b = Number(lng);
    if (lat == null || lng == null || !isValidLatLng(a, b)) {
      return Response.json({ error: "Invalid coordinates." }, { status: 400 });
    }
    // ~1 m precision is plenty for an address and keeps the cache useful
    key = `r:${a.toFixed(5)},${b.toFixed(5)}`;
    path = `/reverse?format=jsonv2&zoom=18&lat=${a.toFixed(6)}&lon=${b.toFixed(6)}`;
  }

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return Response.json(hit.body);

  try {
    const data = await throttled(() => upstream(path));
    let body: unknown;
    if (q != null) {
      const list = Array.isArray(data) ? data : [];
      body = {
        results: list
          .map((r: { lat?: string; lon?: string; display_name?: string }) => ({
            lat: Number(r.lat),
            lng: Number(r.lon),
            label: String(r.display_name ?? ""),
          }))
          .filter((r: { lat: number; lng: number; label: string }) => isValidLatLng(r.lat, r.lng) && r.label),
      };
    } else {
      const label = (data as { display_name?: string } | null)?.display_name;
      body = { label: label ? String(label) : null };
    }
    remember(key, body);
    return Response.json(body);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? `Address lookup failed: ${e.message}` : "Address lookup failed." },
      { status: 502 }
    );
  }
}
