import { readRecords } from "./handler";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ apiName: string }> },
) {
  const { apiName } = await params;
  return readRecords(request, apiName);
}
