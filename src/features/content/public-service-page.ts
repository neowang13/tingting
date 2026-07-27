import { getRepository } from "@/data/repository";
import { collectMediaAssetIds } from "@/features/content/media-service";
import { sectionSchemas } from "@/features/content/schemas";
import {
  getSeededServicePageContent,
  getServicePageDefinitionByKey,
  getServicePageDefinitionBySlug,
  type ServicePageContent
} from "@/features/content/service-pages";
import type { ServicePageSectionKey } from "@/lib/contracts";

export interface PublicServicePageData {
  sectionKey: ServicePageSectionKey;
  slug: string;
  page: ServicePageContent;
  mediaUrls: Record<string, string | null>;
}

function parseServicePage(key: ServicePageSectionKey, value: unknown): ServicePageContent {
  const parsed = sectionSchemas[key].safeParse(value);
  if (parsed.success) return parsed.data as ServicePageContent;
  return sectionSchemas[key].parse(getSeededServicePageContent(key)) as ServicePageContent;
}

async function withMedia(
  sectionKey: ServicePageSectionKey,
  slug: string,
  page: ServicePageContent
): Promise<PublicServicePageData> {
  const repository = getRepository();
  return {
    sectionKey,
    slug,
    page,
    mediaUrls: await repository.resolvePublicMedia(collectMediaAssetIds(page))
  };
}

export async function loadPublicServicePageData(slug: string): Promise<PublicServicePageData | null> {
  const definition = getServicePageDefinitionBySlug(slug);
  if (!definition) return null;

  const published = await getRepository().getPublicSection(definition.sectionKey);
  const page = parseServicePage(
    definition.sectionKey,
    published?.publishedAt ? published.publishedContent : definition.content
  );
  return withMedia(definition.sectionKey, definition.slug, page);
}

export async function loadAdminServicePagePreviewData(
  key: ServicePageSectionKey
): Promise<PublicServicePageData> {
  const definition = getServicePageDefinitionByKey(key);
  if (!definition) throw new Error(`Unknown service page section: ${key}`);
  const section = await getRepository().getSection(key);
  return withMedia(key, definition.slug, parseServicePage(key, section.draftContent));
}
