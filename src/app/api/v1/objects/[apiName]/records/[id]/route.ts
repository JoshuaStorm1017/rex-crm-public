import { deleteRecord, patchRecord, readRecords } from "../handler";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ apiName: string; id: string }> },
) {
  const { apiName, id } = await params;
  return readRecords(request, apiName, id);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ apiName: string; id: string }> },
) {
  const { apiName, id } = await params;
  return patchRecord(request, apiName, id);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ apiName: string; id: string }> },
) {
  const { apiName, id } = await params;
  return deleteRecord(request, apiName, id);
}
