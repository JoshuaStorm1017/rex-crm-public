import { readRecords } from "../handler";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ apiName: string; id: string }> },
) {
  const { apiName, id } = await params;
  return readRecords(request, apiName, id);
}
