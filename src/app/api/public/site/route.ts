import { ok } from "@/lib/api";
import { getRepository } from "@/data/repository";
import { sanitizePublicRentalImages } from "@/lib/public-image-url";

export const dynamic = "force-dynamic";

export async function GET() {
  const repository = getRepository();
  const sections = Object.fromEntries(
    (await repository.listPublicSections()).map((section) => [section.key, section.publishedContent])
  );
  return ok({
    sections,
    rentals: (await repository.listRentals(false)).map(sanitizePublicRentalImages)
  });
}
