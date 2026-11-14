import { deleteSessionSummary } from "../../../../../server/summary/routes.ts";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return deleteSessionSummary(request, sessionId);
}
