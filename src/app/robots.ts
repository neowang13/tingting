import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return {
    rules: [
      { userAgent: "*", allow: ["/", "/rentals"], disallow: ["/admin", "/api/admin", "/api/internal"] }
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl
  };
}
