"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/utils/supabase/client";
import {
  DEFAULT_SITE_RADIUS_M,
  MAX_SITE_RADIUS_M,
  MIN_SITE_RADIUS_M,
  isValidLatLng,
  toLatLng,
} from "@/utils/geo";
import { PinIcon } from "./ui/Icons";

const SiteMap = dynamic(() => import("./map/SiteMap"), {
  ssr: false,
  loading: () => <div className="map-box" style={{ height: 300 }} aria-busy="true" />,
});

export type JobSite = {
  id: string;
  org_id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_m: number;
  active: boolean;
};

export const JOB_SITE_FIELDS = "id, org_id, name, address, latitude, longitude, radius_m, active";

type Draft = {
  id: string | null;
  name: string;
  address: string;
  lat: string;
  lng: string;
  radius: string;
  /** "auto" = filled from the pin, so moving the pin may replace it */
  addressSource: "auto" | "manual";
  /** The address was edited after the pin was set */
  pinStale: boolean;
};

function draftOf(s: JobSite | null): Draft {
  return {
    id: s?.id ?? null,
    name: s?.name ?? "",
    address: s?.address ?? "",
    lat: s?.latitude != null ? String(s.latitude) : "",
    lng: s?.longitude != null ? String(s.longitude) : "",
    radius: String(s?.radius_m ?? DEFAULT_SITE_RADIUS_M),
    addressSource: s?.address ? "manual" : "auto",
    pinStale: false,
  };
}

async function lookup(params: Record<string, string>) {
  const res = await fetch(`/api/geocode?${new URLSearchParams(params)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Address lookup failed.");
  return body;
}

export default function JobSites() {
  const supabase = createClient();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [sites, setSites] = useState<JobSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [results, setResults] = useState<{ lat: number; lng: number; label: string }[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  // Bumped when the pin jumps somewhere new (search, typed coordinates) so the map re-centres
  const [fitNonce, setFitNonce] = useState(0);
  // Latest draft for async lookups that finish after more typing
  const latest = useRef<Draft | null>(null);
  useEffect(() => {
    latest.current = draft;
  }, [draft]);

  async function load() {
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("You're not logged in.");
      setLoading(false);
      return;
    }
    const { data: me } = await supabase.from("profiles").select("org_id").eq("id", user.id).single();
    setOrgId((me?.org_id as string | undefined) ?? null);
    const { data, error: loadError } = await supabase.from("job_sites").select(JOB_SITE_FIELDS).order("name");
    if (loadError) setError(loadError.message);
    setSites((data ?? []) as JobSite[]);
    setLoading(false);
  }

  useEffect(() => {
    // Start the load after the effect runs; the loading state already starts true
    void Promise.resolve().then(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startEdit(s: JobSite | null) {
    setDraft(draftOf(s));
    setFormError(null);
    setLookupNote(null);
    setSuggestion(null);
    setResults([]);
  }

  // Pin moved (map click, drag, or coordinates typed): bring the address along
  async function movePin(lat: number, lng: number, fromTyping = false) {
    if (!draft) return;
    setDraft((d) =>
      d ? { ...d, lat: fromTyping ? d.lat : lat.toFixed(6), lng: fromTyping ? d.lng : lng.toFixed(6), pinStale: false } : d
    );
    if (fromTyping) setFitNonce((n) => n + 1);
    setSuggestion(null);
    setLookupNote(null);
    setLookupBusy(true);
    try {
      const body = await lookup({ lat: String(lat), lng: String(lng) });
      const label: string | null = body.label ?? null;
      const now = latest.current;
      if (!label) {
        setLookupNote("No street address found at the pin. Type one in if it has one.");
      } else if (now && (now.addressSource === "auto" || now.address.trim() === "")) {
        // The address came from the pin before (or is empty): keep them in step
        setDraft((d) => (d ? { ...d, address: label, addressSource: "auto" } : d));
      } else if (now && now.address.trim() !== label) {
        // The employer typed their own address: offer, don't overwrite
        setSuggestion(label);
      }
    } catch (e) {
      setLookupNote(e instanceof Error ? e.message : "Address lookup failed.");
    }
    setLookupBusy(false);
  }

  async function findAddress() {
    if (!draft) return;
    const q = draft.address.trim();
    if (q.length < 3) {
      setLookupNote("Type the address first.");
      return;
    }
    setLookupBusy(true);
    setLookupNote(null);
    setResults([]);
    try {
      const body = await lookup({ q });
      const list = (body.results ?? []) as { lat: number; lng: number; label: string }[];
      if (list.length === 0) setLookupNote("Couldn't find that address. Click the map to place the pin instead.");
      else if (list.length === 1) choose(list[0]);
      else setResults(list);
    } catch (e) {
      setLookupNote(e instanceof Error ? e.message : "Address lookup failed.");
    }
    setLookupBusy(false);
  }

  function choose(r: { lat: number; lng: number }) {
    setDraft((d) => (d ? { ...d, lat: r.lat.toFixed(6), lng: r.lng.toFixed(6), pinStale: false } : d));
    setResults([]);
    setSuggestion(null);
    setFitNonce((n) => n + 1);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || !orgId) return;
    setFormError(null);

    const name = draft.name.trim();
    const address = draft.address.trim();
    const radius = Number(draft.radius);
    const hasLat = draft.lat.trim() !== "";
    const hasLng = draft.lng.trim() !== "";
    const lat = Number(draft.lat);
    const lng = Number(draft.lng);

    if (name.length < 1 || name.length > 80) return setFormError("Give the site a name (up to 80 characters).");
    if (address.length > 300) return setFormError("The address is too long (300 characters at most).");
    if (hasLat !== hasLng) return setFormError("Enter both latitude and longitude, or neither.");
    if (hasLat && !isValidLatLng(lat, lng)) {
      return setFormError("Latitude must be between -90 and 90 and longitude between -180 and 180.");
    }
    if (!Number.isInteger(radius) || radius < MIN_SITE_RADIUS_M || radius > MAX_SITE_RADIUS_M) {
      return setFormError(`The allowed distance must be a whole number from ${MIN_SITE_RADIUS_M} to ${MAX_SITE_RADIUS_M} m.`);
    }
    if (draft.pinStale && !window.confirm("You changed the address after placing the pin. Save without moving the pin?")) {
      return;
    }

    const row = {
      org_id: orgId,
      name,
      address: address || null,
      latitude: hasLat ? lat : null,
      longitude: hasLng ? lng : null,
      radius_m: radius,
    };
    setSaving(true);
    const { error: saveError } = draft.id
      ? await supabase.from("job_sites").update(row).eq("id", draft.id)
      : await supabase.from("job_sites").insert({ ...row, active: true });
    if (saveError) setFormError(saveError.message);
    else {
      setDraft(null);
      await load();
    }
    setSaving(false);
  }

  async function setActive(s: JobSite, active: boolean) {
    if (!active && !window.confirm(`Deactivate ${s.name}? Your crew won't be able to pick it when clocking in. Past shifts keep it.`)) {
      return;
    }
    setBusyId(s.id);
    setError(null);
    const { error: saveError } = await supabase.from("job_sites").update({ active }).eq("id", s.id);
    if (saveError) setError(saveError.message);
    else await load();
    setBusyId(null);
  }

  const active = sites.filter((s) => s.active);
  const inactive = sites.filter((s) => !s.active);
  const pin = draft ? toLatLng(draft.lat === "" ? null : draft.lat, draft.lng === "" ? null : draft.lng) : null;
  const radius = draft ? Number(draft.radius) : null;

  const row = (s: JobSite) => (
    <li key={s.id} className="list-row items-start">
      <div className="min-w-0 flex gap-2">
        <span className="mt-0.5 muted">
          <PinIcon />
        </span>
        <div className="min-w-0">
          <div className="font-semibold">{s.name}</div>
          <div className="small muted">{s.address || "No address"}</div>
          <div className="small faint">
            {s.latitude != null && s.longitude != null
              ? `${Number(s.latitude).toFixed(5)}, ${Number(s.longitude).toFixed(5)} · ${s.radius_m} m allowed`
              : "No map pin: distance can't be checked"}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {s.active ? (
          <>
            <button type="button" className="btn btn-text" onClick={() => startEdit(s)}>
              Edit
            </button>
            <button
              type="button"
              className="btn btn-text btn-danger"
              disabled={busyId === s.id}
              onClick={() => setActive(s, false)}
            >
              Deactivate
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-text" disabled={busyId === s.id} onClick={() => setActive(s, true)}>
            Reactivate
          </button>
        )}
      </div>
    </li>
  );

  return (
    <section className="panel" aria-labelledby="sites-h">
      <div className="panel-h">
        <h2 id="sites-h">Sites</h2>
        {!draft ? (
          <button type="button" className="btn" onClick={() => startEdit(null)}>
            Add site
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="msg-error px-4 pb-3" role="alert">
          {error}
        </p>
      ) : null}

      {draft ? (
        <form className="panel-body flex flex-col gap-4" onSubmit={save}>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="flex flex-col gap-4">
              <div className="field">
                <label htmlFor="site-name">Site name</label>
                <input
                  id="site-name"
                  className="input"
                  maxLength={80}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="site-address">Address</label>
                <div className="flex gap-2">
                  <input
                    id="site-address"
                    className="input flex-1"
                    maxLength={300}
                    value={draft.address}
                    onChange={(e) =>
                      setDraft({ ...draft, address: e.target.value, addressSource: "manual", pinStale: !!pin })
                    }
                  />
                  <button type="button" className="btn" onClick={findAddress} disabled={lookupBusy}>
                    Find on map
                  </button>
                </div>
                {draft.pinStale ? (
                  <span className="hint">The address changed. Use &quot;Find on map&quot; to move the pin to it.</span>
                ) : null}
              </div>
              {results.length > 0 ? (
                <div className="note-box flex flex-col gap-1">
                  <span className="text-ink font-semibold">Which one?</span>
                  {results.map((r) => (
                    <button
                      key={`${r.lat},${r.lng}`}
                      type="button"
                      className="text-left underline underline-offset-2"
                      onClick={() => choose(r)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {suggestion ? (
                <div className="note-box flex flex-wrap items-center justify-between gap-2">
                  <span>Address at the pin: {suggestion}</span>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setDraft({ ...draft, address: suggestion, addressSource: "auto", pinStale: false });
                      setSuggestion(null);
                    }}
                  >
                    Use it
                  </button>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-4">
                <div className="field">
                  <label htmlFor="site-lat">Latitude</label>
                  <input
                    id="site-lat"
                    className="input"
                    inputMode="decimal"
                    value={draft.lat}
                    onChange={(e) => setDraft({ ...draft, lat: e.target.value })}
                    onBlur={() => {
                      const p = toLatLng(draft.lat, draft.lng);
                      if (p) void movePin(p.lat, p.lng, true);
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="site-lng">Longitude</label>
                  <input
                    id="site-lng"
                    className="input"
                    inputMode="decimal"
                    value={draft.lng}
                    onChange={(e) => setDraft({ ...draft, lng: e.target.value })}
                    onBlur={() => {
                      const p = toLatLng(draft.lat, draft.lng);
                      if (p) void movePin(p.lat, p.lng, true);
                    }}
                  />
                </div>
              </div>
              <div className="field max-w-xs">
                <label htmlFor="site-radius">Allowed distance from the pin (metres)</label>
                <input
                  id="site-radius"
                  className="input"
                  type="number"
                  inputMode="numeric"
                  min={MIN_SITE_RADIUS_M}
                  max={MAX_SITE_RADIUS_M}
                  step={1}
                  value={draft.radius}
                  onChange={(e) => setDraft({ ...draft, radius: e.target.value })}
                />
                <span className="hint">
                  Clock-ins farther than this are flagged for review. Default {DEFAULT_SITE_RADIUS_M} m; make it
                  bigger for large sites like pipelines or subdivisions.
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <SiteMap
                label="Site pin. Click the map or drag the pin to place it."
                pin={pin}
                pinRadius={Number.isFinite(radius) && radius ? radius : null}
                onPinChange={(p) => void movePin(p.lat, p.lng)}
                fitKey={`${draft.id ?? "new"}:${pin ? "pin" : "none"}:${fitNonce}`}
                height={300}
              />
              <p className="hint">
                Click the map or drag the pin. {lookupBusy ? "Looking up the address…" : null}
                {lookupNote ? <span className="msg-error block">{lookupNote}</span> : null}
              </p>
              <p className="hint">Address search: Nominatim, © OpenStreetMap contributors.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : draft.id ? "Save site" : "Add site"}
            </button>
            <button type="button" className="btn btn-text" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </button>
            {formError ? (
              <p className="msg-error" role="alert">
                {formError}
              </p>
            ) : null}
          </div>
        </form>
      ) : null}

      {loading ? (
        <div className="panel-body flex flex-col gap-3" aria-busy="true">
          <span className="skeleton w-full" />
          <span className="skeleton w-2/3" />
        </div>
      ) : active.length === 0 ? (
        <div className="panel-body">
          <p className="empty">
            No active sites. Until you add one, your crew clocks in without picking a site and distance isn&apos;t
            checked.
          </p>
        </div>
      ) : (
        <ul>{active.map(row)}</ul>
      )}

      {inactive.length > 0 ? (
        <div className="px-4 pb-3">
          <button
            type="button"
            className="btn btn-text -ml-2"
            aria-expanded={showInactive}
            onClick={() => setShowInactive((v) => !v)}
          >
            {showInactive ? "Hide" : "Show"} {inactive.length} inactive
          </button>
          {showInactive ? <ul className="opacity-80 -mx-4">{inactive.map(row)}</ul> : null}
        </div>
      ) : null}
    </section>
  );
}
