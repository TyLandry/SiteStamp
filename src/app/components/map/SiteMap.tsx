"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";

// Leaflet touches `window`, so it's loaded in the browser only (inside an
// effect); the server renders the empty container.
// Tiles default to OpenStreetMap's standard tile server, which asks for visible
// attribution, no prefetching or offline use, and a switchable URL:
// https://operations.osmfoundation.org/policies/tiles/
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

export type MapSite = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius: number;
  active: boolean;
};

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  tone: "ok" | "warn" | "bad" | "neutral";
  label: string;
};

const TONES: Record<MapPoint["tone"], string> = {
  ok: "#247b50",
  warn: "#b45309",
  bad: "#d23a2a",
  neutral: "#55616a",
};

type Props = {
  /** What the map shows, for screen readers. */
  label: string;
  sites?: MapSite[];
  points?: MapPoint[];
  /** An editable pin: click the map or drag the pin to move it. */
  pin?: { lat: number; lng: number } | null;
  pinRadius?: number | null;
  onPinChange?: (p: { lat: number; lng: number }) => void;
  /** Re-fit the view to the content whenever this changes. */
  fitKey?: string;
  height?: number;
};

// Text-only tooltip content (names come from users; never set as HTML)
function textNode(text: string) {
  const el = document.createElement("span");
  el.textContent = text;
  return el;
}

export default function SiteMap({ label, sites = [], points = [], pin = null, pinRadius = null, onPinChange, fitKey, height = 320 }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const lib = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const onPin = useRef(onPinChange);
  const fitted = useRef<string | undefined>(undefined);
  const ready = useRef<(() => void) | null>(null);

  useEffect(() => {
    onPin.current = onPinChange;
  }, [onPinChange]);

  // Create the map once
  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !box.current) return;
      lib.current = L;
      const m = L.map(box.current, { scrollWheelZoom: false, worldCopyJump: true }).setView([56.13, -106.35], 3);
      L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(m);
      layer.current = L.layerGroup().addTo(m);
      m.on("click", (e: Leaflet.LeafletMouseEvent) => onPin.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
      map.current = m;
      observer = new ResizeObserver(() => m.invalidateSize());
      observer.observe(box.current);
      ready.current?.();
    })();
    return () => {
      cancelled = true;
      observer?.disconnect();
      map.current?.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  // Redraw overlays whenever the data changes
  useEffect(() => {
    function draw() {
      const L = lib.current;
      const m = map.current;
      const g = layer.current;
      if (!L || !m || !g) return;
      g.clearLayers();
      const bounds: Leaflet.LatLngExpression[] = [];

      for (const s of sites) {
        L.circle([s.lat, s.lng], {
          radius: s.radius,
          color: "#33434e",
          weight: 1.5,
          dashArray: "4 4",
          fillOpacity: s.active ? 0.06 : 0.02,
          opacity: s.active ? 0.9 : 0.4,
          interactive: false,
        }).addTo(g);
        L.marker([s.lat, s.lng], {
          icon: L.divIcon({ className: "map-site", html: "<span></span>", iconSize: [14, 14], iconAnchor: [7, 7] }),
          keyboard: false,
          opacity: s.active ? 1 : 0.5,
        })
          .bindTooltip(textNode(`${s.name}${s.active ? "" : " (inactive)"} · ${s.radius} m radius`))
          .addTo(g);
        bounds.push([s.lat, s.lng]);
      }

      for (const p of points) {
        if (p.accuracy != null && p.accuracy > 0) {
          L.circle([p.lat, p.lng], {
            radius: p.accuracy,
            color: TONES[p.tone],
            weight: 0,
            fillOpacity: 0.08,
            interactive: false,
          }).addTo(g);
        }
        L.circleMarker([p.lat, p.lng], {
          radius: 6,
          color: "#fff",
          weight: 2,
          fillColor: TONES[p.tone],
          fillOpacity: 1,
        })
          .bindTooltip(textNode(p.label))
          .addTo(g);
        bounds.push([p.lat, p.lng]);
      }

      if (pin) {
        if (pinRadius) {
          L.circle([pin.lat, pin.lng], {
            radius: pinRadius,
            color: "#d23a2a",
            weight: 1.5,
            dashArray: "4 4",
            fillOpacity: 0.06,
            interactive: false,
          }).addTo(g);
        }
        const marker = L.marker([pin.lat, pin.lng], {
          draggable: !!onPin.current,
          icon: L.divIcon({ className: "map-pin", html: "<span></span>", iconSize: [22, 22], iconAnchor: [11, 22] }),
          title: "Site pin. Drag to move.",
        }).addTo(g);
        marker.on("dragend", () => {
          const ll = marker.getLatLng();
          onPin.current?.({ lat: ll.lat, lng: ll.lng });
        });
        bounds.push([pin.lat, pin.lng]);
      }

      if (fitted.current !== fitKey) {
        fitted.current = fitKey;
        if (bounds.length === 1) m.setView(bounds[0], 16);
        else if (bounds.length > 1) m.fitBounds(L.latLngBounds(bounds), { padding: [32, 32], maxZoom: 17 });
      }
    }
    if (map.current) draw();
    else ready.current = draw;
  }, [sites, points, pin, pinRadius, fitKey]);

  return (
    <div
      ref={box}
      role="region"
      aria-label={label}
      className="map-box"
      style={{ height }}
    />
  );
}
