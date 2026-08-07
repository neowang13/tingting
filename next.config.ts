import type { NextConfig } from "next";

const scriptSource =
  process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

function localSupabaseSource() {
  if (process.env.NODE_ENV !== "development" || !process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
    return ["127.0.0.1", "localhost"].includes(url.hostname) ? url.origin : null;
  } catch {
    return null;
  }
}

const localSupabase = localSupabaseSource();
const localSupabaseImagePattern = localSupabase
  ? (() => {
      const url = new URL(localSupabase);
      return {
        protocol: url.protocol.slice(0, -1) as "http" | "https",
        hostname: url.hostname,
        port: url.port,
        pathname: "/storage/v1/object/public/**"
      };
    })()
  : null;
const imageSources = [
  "'self'",
  "data:",
  "blob:",
  "https://*.supabase.co",
  "https://images.unsplash.com",
  localSupabase
].filter(Boolean).join(" ");
const connectSources = ["'self'", "https://*.supabase.co", localSupabase].filter(Boolean).join(" ");

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["read-excel-file", "unzipper"],
  images: {
    dangerouslyAllowLocalIP: Boolean(localSupabase),
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
      { protocol: "https", hostname: "images.unsplash.com" },
      ...(localSupabaseImagePattern ? [localSupabaseImagePattern] : [])
    ]
  },
  poweredByHeader: false,
  async redirects() {
    return [
      {
        source: "/services/renovation",
        destination: "/services/trade-services",
        permanent: true
      },
      {
        source: "/services/handyman-service",
        destination: "/services/property-care",
        permanent: true
      },
      {
        source: "/services/property-maintenance",
        destination: "/services/property-care",
        permanent: true
      }
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "frame-ancestors 'none'",
              "form-action 'self'",
              "object-src 'none'",
              `img-src ${imageSources}`,
              "style-src 'self' 'unsafe-inline'",
              scriptSource,
              `connect-src ${connectSources}`
            ].join("; ")
          }
        ]
      }
    ];
  }
};

export default nextConfig;
