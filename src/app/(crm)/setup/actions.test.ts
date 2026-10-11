import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

vi.mock("@/lib/crm/currentUser", () => ({
  requireActor: vi.fn(),
}));

vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>(
    "@/lib/db/client",
  );
  return { ...actual, getDb: vi.fn() };
});

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/crm/currentUser";
import { LOCAL_ACTOR } from "@/lib/crm/actor";
import { listAssignmentRules } from "@/lib/crm/assignmentRules";
import { listAutomationRules } from "@/lib/crm/automationRules";
import { LOCAL_ORG_ID, LOCAL_USER_ID, RILEY_USER_ID } from "@/lib/crm/constants";
import { listCustomFields } from "@/lib/crm/customFields";
import { listDuplicateRules } from "@/lib/crm/duplicateRules";
import { getUser } from "@/lib/crm/users";
import { listValidationRules } from "@/lib/crm/validationRules";
import { getDb, openMemoryDb } from "@/lib/db/client";
import { createAssignmentRuleAction } from "./assignment/actions";
import { createAutomationRuleAction } from "./automation/actions";
import { createDuplicateRuleAction } from "./duplicates/actions";
import { createCustomFieldAction } from "./fields/actions";
import { createValidationRuleAction } from "./rules/actions";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("setup server actions", () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
  });

  it("returns FORBIDDEN for a non-admin create in each family and writes nothing", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const user = getUser(db, RILEY_USER_ID);
    if (!user) throw new Error("Riley was not seeded");
    vi.mocked(requireActor).mockResolvedValue({
      userId: RILEY_USER_ID,
      orgId: LOCAL_ORG_ID,
      user,
    });

    const field = await createCustomFieldAction(
      null,
      form({
        objectType: "account",
        apiName: "Hijack__c",
        label: "Hijack",
        type: "text",
      }),
    );
    const validation = await createValidationRuleAction(
      null,
      form({
        name: "Hijack validation",
        objectType: "account",
        errorMessage: "no",
        c0field: "name",
        c0operator: "is_blank",
      }),
    );
    const assignment = await createAssignmentRuleAction(
      null,
      form({
        name: "Hijack assignment",
        assignToId: RILEY_USER_ID,
        sortOrder: "1",
        c0field: "source",
        c0operator: "equals",
        c0value: "Web",
      }),
    );
    const automation = await createAutomationRuleAction(
      null,
      form({
        name: "Hijack automation",
        objectType: "lead",
        runOn: "create",
        field: "rating",
        value: "Hot",
        c0field: "source",
        c0operator: "equals",
        c0value: "Web",
      }),
    );
    const duplicate = await createDuplicateRuleAction(
      null,
      form({
        name: "Hijack duplicate",
        objectType: "account",
        matchField: "name",
        errorMessage: "no",
      }),
    );

    for (const result of [field, validation, assignment, automation, duplicate]) {
      expect(result?.code).toBe("FORBIDDEN");
    }
    expect(listCustomFields(db, LOCAL_ACTOR).some((row) => row.apiName === "Hijack__c")).toBe(
      false,
    );
    expect(listValidationRules(db, LOCAL_ACTOR).some((row) => row.name === "Hijack validation")).toBe(
      false,
    );
    expect(
      listAssignmentRules(db, LOCAL_ACTOR).some((row) => row.name === "Hijack assignment"),
    ).toBe(false);
    expect(
      listAutomationRules(db, LOCAL_ACTOR).some((row) => row.name === "Hijack automation"),
    ).toBe(false);
    expect(listDuplicateRules(db, LOCAL_ACTOR).some((row) => row.name === "Hijack duplicate")).toBe(
      false,
    );
    expect(redirect).not.toHaveBeenCalled();
  });

  it("lets the organization admin create a duplicate rule", async () => {
    const db = openMemoryDb().db;
    vi.mocked(getDb).mockReturnValue(db);
    const user = getUser(db, LOCAL_USER_ID);
    if (!user) throw new Error("operator was not seeded");
    vi.mocked(requireActor).mockResolvedValue({
      userId: LOCAL_USER_ID,
      orgId: LOCAL_ORG_ID,
      user,
    });

    await expect(
      createDuplicateRuleAction(
        null,
        form({
          name: "Operator duplicate",
          objectType: "account",
          matchField: "name",
          errorMessage: "Taken.",
        }),
      ),
    ).rejects.toThrow("REDIRECT");

    expect(
      listDuplicateRules(db, LOCAL_ACTOR).some((row) => row.name === "Operator duplicate"),
    ).toBe(true);
    expect(redirect).toHaveBeenCalled();
  });
});
