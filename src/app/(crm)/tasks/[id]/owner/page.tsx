import { ChangeOwnerScreen } from "@/components/ChangeOwnerScreen";

export default async function TaskOwnerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { id } = await params;
  const { notice } = await searchParams;
  return ChangeOwnerScreen({ objectType: "task", recordId: id, notice });
}
