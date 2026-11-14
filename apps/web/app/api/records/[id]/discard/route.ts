import { discardRecord } from "../../../../../server/records/routes.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return discardRecord(request, id);
}
