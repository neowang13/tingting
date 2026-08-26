import { cache } from "react";
import { demoSections } from "@/data/demo";
import { getRepository } from "@/data/repository";
import { sectionSchemas } from "@/features/content/schemas";
import type {
  PublicSiteSection,
  RentalListing
} from "@/lib/contracts";
import { sanitizePublicRentalImages } from "@/lib/public-image-url";

type Header = ReturnType<(typeof sectionSchemas)["header"]["parse"]>;
type Contact = ReturnType<(typeof sectionSchemas)["contact"]["parse"]>;
type Footer = ReturnType<(typeof sectionSchemas)["footer"]["parse"]>;
type ChromeSections = {
  header: Header;
  contact: Contact;
  footer: Footer;
};

export interface PublicRentalDetailData {
  rental: RentalListing;
  similarRentals: RentalListing[];
  sections: {
    header: Header;
    contact: Contact;
    footer: Footer;
  };
}

function parseSection<Key extends "header" | "contact" | "footer">(
  key: Key,
  sections: PublicSiteSection[]
): ChromeSections[Key] {
  const published = sections.find((section) => section.key === key)?.publishedContent;
  const parsed = sectionSchemas[key].safeParse(published);
  if (parsed.success) return parsed.data as ChromeSections[Key];
  const fallback = demoSections.find((section) => section.key === key)?.publishedContent;
  return sectionSchemas[key].parse(fallback) as ChromeSections[Key];
}

export const loadPublicRentalDetailData = cache(
  async (slug: string): Promise<PublicRentalDetailData | null> => {
    const repository = getRepository();
    const [rental, publishedSections, rentals] = await Promise.all([
      repository.getPublicRentalBySlug(slug),
      repository.listPublicSections(),
      repository.listRentals(false)
    ]);
    if (!rental || rental.status !== "published" || !rental.publishedAt) return null;

    const publicRental = sanitizePublicRentalImages(rental);
    return {
      rental: {
        ...publicRental,
        images: [...publicRental.images]
          .filter((image) => Boolean(image.url))
          .sort((a, b) => a.sortOrder - b.sortOrder)
      },
      similarRentals: rentals
        .filter((candidate) =>
          candidate.id !== rental.id &&
          candidate.status === "published" &&
          candidate.publishedAt
        )
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .slice(0, 4)
        .map(sanitizePublicRentalImages),
      sections: {
        header: parseSection("header", publishedSections),
        contact: parseSection("contact", publishedSections),
        footer: parseSection("footer", publishedSections)
      }
    };
  }
);

export async function loadAdminRentalPreviewData(id: string): Promise<PublicRentalDetailData> {
  const repository = getRepository();
  const [rental, publishedSections] = await Promise.all([
    repository.getRental(id),
    repository.listPublicSections()
  ]);
  return {
    rental: {
      ...rental,
      images: [...rental.images].sort((a, b) => a.sortOrder - b.sortOrder)
    },
    similarRentals: [],
    sections: {
      header: parseSection("header", publishedSections),
      contact: parseSection("contact", publishedSections),
      footer: parseSection("footer", publishedSections)
    }
  };
}

export function formatRentalPrice(monthlyRentCents: number) {
  return `$${(monthlyRentCents / 100).toLocaleString("en-CA")}`;
}

export function formatRentalCount(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatRentalArea(value: number) {
  return `${value.toLocaleString("en-CA")} sq. ft.`;
}

export function formatRentalLocation(
  neighbourhood: string | null,
  city: string
) {
  return [neighbourhood, city].filter(Boolean).join(", ");
}

export function formatRentalAvailability(value: string, now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "America/Vancouver"
  });
  const today = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Vancouver"
  }).format(now);
  if (value <= today) return "Available now";
  return formatter.format(new Date(`${value}T12:00:00-07:00`));
}
