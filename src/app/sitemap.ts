import type { MetadataRoute } from "next";
import { getRepository } from "@/data/repository";
import { getAllServicePages } from "@/features/content/service-pages";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const rentals = await getRepository().listRentals(false);
  return [
    { url: baseUrl, changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/about`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/rentals`, changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    ...getAllServicePages().map((page) => ({
      url: `${baseUrl}/services/${page.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.8
    })),
    ...rentals.map((rental) => ({
      url: `${baseUrl}/rentals/${rental.slug}`,
      lastModified: rental.updatedAt,
      changeFrequency: "daily" as const,
      priority: 0.8
    }))
  ];
}
