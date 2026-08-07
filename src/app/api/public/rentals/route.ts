import { ok } from "@/lib/api";
import { getRepository } from "@/data/repository";
import { sanitizePublicRentalImages } from "@/lib/public-image-url";

export const dynamic = "force-dynamic";

export async function GET() {
  return ok((await getRepository().listRentals(false)).map(sanitizePublicRentalImages));
}
