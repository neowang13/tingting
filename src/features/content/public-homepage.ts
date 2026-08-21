import { demoSections } from "@/data/demo";
import { getRepository } from "@/data/repository";
import { sectionSchemas, validateSection } from "@/features/content/schemas";
import { collectMediaAssetIds } from "@/features/content/media-service";
import {
  homepageSectionKeys,
  type HomepageSectionKey,
  type PublicSiteSection,
  type RentalListing
} from "@/lib/contracts";
import { sanitizePublicRentalImages } from "@/lib/public-image-url";

type ParsedSections = {
  [Key in HomepageSectionKey]: ReturnType<(typeof sectionSchemas)[Key]["parse"]>;
};

export interface PublicHomepageData {
  sections: ParsedSections;
  rentals: RentalListing[];
  mediaUrls: Record<string, string | null>;
}

function parsePublishedSection<Key extends HomepageSectionKey>(
  key: Key,
  sections: PublicSiteSection[]
): ParsedSections[Key] {
  const published = sections.find((section) => section.key === key)?.publishedContent;
  const parsed = sectionSchemas[key].safeParse(published);

  if (parsed.success) {
    return parsed.data as ParsedSections[Key];
  }

  const fallback = demoSections.find((section) => section.key === key)?.publishedContent;
  return sectionSchemas[key].parse(fallback) as ParsedSections[Key];
}

/**
 * Public-only homepage boundary. The memory adapter mirrors the future
 * public_site_sections/public_rental_listings projections and deliberately
 * exposes neither drafts nor tenant/admin state.
 */
export async function loadPublicHomepageData(): Promise<PublicHomepageData> {
  const repository = getRepository();
  const publishedSections = await repository.listPublicSections();
  const sections = Object.fromEntries(
    homepageSectionKeys.map((key) => [key, parsePublishedSection(key, publishedSections)])
  ) as ParsedSections;

  const rentals = (await repository
    .listRentals(false))
    .filter((rental) => rental.status === "published" && rental.publishedAt)
    .slice(0, 10)
    .map(sanitizePublicRentalImages);
  const mediaIds = collectMediaAssetIds(sections);
  return {
    sections,
    rentals,
    mediaUrls: await repository.resolvePublicMedia(mediaIds)
  };
}

export async function loadAdminPreviewData(key: HomepageSectionKey): Promise<PublicHomepageData> {
  const repository = getRepository();
  const data = await loadPublicHomepageData();
  const section = await repository.getSection(key);
  const sections = {
    ...data.sections,
    [key]: validateSection(key, section.draftContent)
  } as ParsedSections;
  return {
    ...data,
    sections,
    mediaUrls: await repository.resolvePublicMedia(collectMediaAssetIds(sections))
  };
}
