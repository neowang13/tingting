import { ok } from "@/lib/api";
import { getRepository } from "@/data/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  return ok(await getRepository().listRentals(false));
}
