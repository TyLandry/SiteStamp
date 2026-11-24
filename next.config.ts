import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

// Sent with every response. The content security policy only covers what
// doesn't depend on scripts (framing, <base>, form targets, plugins); a
// script policy needs per-request nonces and is a separate change.
const securityHeaders = [
  // No other site may put these pages in a frame (clickjacking)
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Keeps the origin on cross-site requests, which the map tile server asks for
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Location only for this site (clock in/out); nothing else
  {
    key: "Permissions-Policy",
    value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=(), browsing-topics=()",
  },
  // HTTPS only, once deployed (browsers ignore it on plain-http localhost)
  ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Dev only: lets a phone or another computer on the LAN load the dev server
  // (including hot reload) at these addresses. localhost is always allowed.
  // Your Mac's address changes between networks; add the new one when it does.
  allowedDevOrigins: ["192.168.1.71", "172.21.20.222"],
};

export default nextConfig;
