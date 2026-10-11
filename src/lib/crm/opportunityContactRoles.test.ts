import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { accounts, users } from "../db/schema";
import { LOCAL_ACTOR, actorFor } from "./actor";
import { createAccount } from "./accounts";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { createContact, deleteContact, getContact, updateContact } from "./contacts";
import { DomainError } from "./errors";
import { convertLead, createLead, getLead } from "./leads";
import { addMember } from "./orgs";
import {
  createOpportunity,
  deleteOpportunity,
  getOpportunity,
} from "./opportunities";
import { createProfile, setObjectPermission } from "./profiles";
import { createUser } from "./users";

function expectCode(run: () => unknown, code: string) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

const riley = actorFor(RILEY_USER_ID);

const FULL = {
  canCreate: true,
  canRead: true,
  canUpdate: true,
  canDelete: true,
} as const;
import {
  createOpportunityContactRole,
  deleteOpportunityContactRole,
  getOpportunityContactRole,
  listOpportunityContactRoles,
  listOpportunityContactRolesForContact,
  updateOpportunityContactRole,
} from "./opportunityContactRoles";

function setup() {
  const db = openMemoryDb().db;
  const acme = createAccount(db, LOCAL_ACTOR, { name: "Acme Corporation" });
  const globex = createAccount(db, LOCAL_ACTOR, { name: "Globex Corporation" });
  const wile = createContact(db, LOCAL_ACTOR, {
    accountId: acme.id,
    firstName: "Wile E.",
    lastName: "Coyote",
    email: "wile@acme.test",
    title: "Product Tester",
  });
  const runner = createContact(db, LOCAL_ACTOR, {
    accountId: acme.id,
    firstName: "Road",
    lastName: "Runner",
    email: "meep@acme.test",
  });
  const hank = createContact(db, LOCAL_ACTOR, {
    accountId: globex.id,
    firstName: "Hank",
    lastName: "Scorpio",
  });
  const opp = createOpportunity(db, LOCAL_ACTOR, {
    accountId: acme.id,
    name: "Anvil Restock",
    stage: "Prospecting",
    closeDate: "2026-10-31",
  });
  return { db, acme, globex, wile, runner, hank, opp };
}

describe("opportunity contact roles", () => {
  it("adds a contact from the opportunity's account", () => {
    const { db, wile, opp } = setup();
    const role = createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opp.id,
      contactId: wile.id,
      role: "Decision Maker",
      isPrimary: true,
    });
    expect(role.id.startsWith("00K")).toBe(true);
    expect(role.isPrimary).toBe(true);
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, role.id)?.contactId).toBe(wile.id);
    const listed = listOpportunityContactRoles(db, LOCAL_ACTOR, opp.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.contactName).toBe("Wile E. Coyote");
    expect(listed[0]?.contactEmail).toBe("wile@acme.test");
    expect(
      listOpportunityContactRolesForContact(db, LOCAL_ACTOR, wile.id).map((row) => row.opportunityName),
    ).toEqual(["Anvil Restock"]);
  });

  it("rejects a contact from a different account", () => {
    const { db, hank, opp } = setup();
    expect(() =>
      createOpportunityContactRole(db, LOCAL_ACTOR, {
        opportunityId: opp.id,
        contactId: hank.id,
        role: "Influencer",
      }),
    ).toThrow(/opportunity's account/i);
    expect(listOpportunityContactRoles(db, LOCAL_ACTOR, opp.id)).toEqual([]);
  });

  it("rejects a missing contact, missing opportunity, and a duplicate pair", () => {
    const { db, wile, opp } = setup();
    expect(() =>
      createOpportunityContactRole(db, LOCAL_ACTOR, {
        opportunityId: opp.id,
        contactId: "003MISSING",
        role: "Other",
      }),
    ).toThrow(DomainError);
    expect(() =>
      createOpportunityContactRole(db, LOCAL_ACTOR, {
        opportunityId: "006MISSING",
        contactId: wile.id,
        role: "Other",
      }),
    ).toThrow(DomainError);
    createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opp.id,
      contactId: wile.id,
      role: "Decision Maker",
    });
    expect(() =>
      createOpportunityContactRole(db, LOCAL_ACTOR, {
        opportunityId: opp.id,
        contactId: wile.id,
        role: "Influencer",
      }),
    ).toThrow(/already on this opportunity/i);
  });

  it("keeps a single primary: setting a new primary unsets the old one", () => {
    const { db, wile, runner, opp } = setup();
    const first = createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opp.id,
      contactId: wile.id,
      role: "Decision Maker",
      isPrimary: true,
    });
    const second = createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opp.id,
      contactId: runner.id,
      role: "Influencer",
      isPrimary: true,
    });
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, first.id)?.isPrimary).toBe(false);
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, second.id)?.isPrimary).toBe(true);
    updateOpportunityContactRole(db, LOCAL_ACTOR, first.id, { isPrimary: true });
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, first.id)?.isPrimary).toBe(true);
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, second.id)?.isPrimary).toBe(false);
    const listed = listOpportunityContactRoles(db, LOCAL_ACTOR, opp.id);
    expect(listed[0]?.contactName).toBe("Wile E. Coyote");
    expect(listed[0]?.isPrimary).toBe(true);
  });

  it("hard-deletes a role and leaves the opportunity", () => {
    const { db, wile, opp } = setup();
    const role = createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opp.id,
      contactId: wile.id,
      role: "Other",
    });
    deleteOpportunityContactRole(db, LOCAL_ACTOR, role.id);
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, role.id)).toBeUndefined();
    expect(listOpportunityContactRoles(db, LOCAL_ACTOR, opp.id)).toEqual([]);
    expect(getOpportunity(db, LOCAL_ACTOR, opp.id)?.name).toBe("Anvil Restock");
  });

  it("clears roles when the opportunity or contact is deleted", () => {
    const { db, wile, runner, acme, opp } = setup();
    const otherOpp = createOpportunity(db, LOCAL_ACTOR, {
      accountId: acme.id,
      name: "Giant Rubber Band",
      stage: "Proposal",
      closeDate: "2026-12-01",
    });
    const onAnvil = createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opp.id,
      contactId: wile.id,
      role: "Decision Maker",
      isPrimary: true,
    });
    const onBand = createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: otherOpp.id,
      contactId: wile.id,
      role: "Influencer",
    });
    createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opp.id,
      contactId: runner.id,
      role: "Other",
    });
    deleteOpportunity(db, LOCAL_ACTOR, opp.id);
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, onAnvil.id)).toBeUndefined();
    expect(listOpportunityContactRoles(db, LOCAL_ACTOR, opp.id)).toEqual([]);
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, onBand.id)?.contactId).toBe(wile.id);

    deleteContact(db, LOCAL_ACTOR, wile.id);
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, onBand.id)).toBeUndefined();
    expect(listOpportunityContactRolesForContact(db, LOCAL_ACTOR, wile.id)).toEqual([]);
  });

  it("refuses to move a contact that is on an opportunity", () => {
    const { db, wile, globex, opp } = setup();
    createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opp.id,
      contactId: wile.id,
      role: "Decision Maker",
    });
    expect(() =>
      updateContact(db, LOCAL_ACTOR, wile.id, { accountId: globex.id }),
    ).toThrow(/opportunity/i);
  });

  it("refuses create, update, and delete when the actor cannot edit the opportunity", () => {
    const { db, acme, wile, runner, opp } = setup();
    const spare = createContact(db, LOCAL_ACTOR, {
      accountId: acme.id,
      lastName: "Fudd",
    });
    const first = createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opp.id,
      contactId: wile.id,
      role: "Other",
    });
    const second = createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opp.id,
      contactId: runner.id,
      role: "Decision Maker",
      isPrimary: true,
    });

    expectCode(
      () =>
        createOpportunityContactRole(db, riley, {
          opportunityId: opp.id,
          contactId: spare.id,
          role: "Influencer",
        }),
      "FORBIDDEN",
    );
    expectCode(
      () => updateOpportunityContactRole(db, riley, first.id, { isPrimary: true }),
      "FORBIDDEN",
    );
    expectCode(() => deleteOpportunityContactRole(db, riley, first.id), "FORBIDDEN");

    expect(getOpportunityContactRole(db, LOCAL_ACTOR, first.id)?.isPrimary).toBe(false);
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, second.id)?.isPrimary).toBe(true);
    expect(listOpportunityContactRoles(db, LOCAL_ACTOR, opp.id)).toHaveLength(2);
  });

  it("lets the owner and modify-all edit roles, and refuses both admin lookalikes", () => {
    const { db, acme, wile } = setup();
    const own = createOpportunity(db, riley, {
      accountId: acme.id,
      name: "Riley Anvil",
      stage: "Prospecting",
      closeDate: "2026-11-30",
    });
    const ownedRole = createOpportunityContactRole(db, riley, {
      opportunityId: own.id,
      contactId: wile.id,
      role: "Influencer",
    });
    expect(getOpportunityContactRole(db, riley, ownedRole.id)?.role).toBe("Influencer");
    deleteOpportunityContactRole(db, riley, ownedRole.id);
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, ownedRole.id)).toBeUndefined();

    const granted = createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: own.id,
      contactId: wile.id,
      role: "Decision Maker",
      isPrimary: true,
    });
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, granted.id)?.isPrimary).toBe(true);

    const operatorOpp = createOpportunity(db, LOCAL_ACTOR, {
      accountId: acme.id,
      name: "Operator Anvil",
      stage: "Prospecting",
      closeDate: "2026-12-15",
    });
    const globalAdmin = createUser(db, {
      name: "Global Admin",
      email: "global.admin@example.com",
      username: "globaladmin",
      password: "long-enough",
    });
    db.update(users).set({ role: "admin" }).where(eq(users.id, globalAdmin.id)).run();
    addMember(db, LOCAL_ORG_ID, globalAdmin.id, "member");
    expectCode(
      () =>
        createOpportunityContactRole(db, actorFor(globalAdmin.id), {
          opportunityId: operatorOpp.id,
          contactId: wile.id,
          role: "Other",
        }),
      "FORBIDDEN",
    );

    const orgAdmin = createUser(db, {
      name: "Org Admin",
      email: "org.admin@example.com",
      username: "orgadmin",
      password: "long-enough",
    });
    addMember(db, LOCAL_ORG_ID, orgAdmin.id, "admin");
    expect(orgAdmin.role).toBe("user");
    expectCode(
      () =>
        createOpportunityContactRole(db, actorFor(orgAdmin.id), {
          opportunityId: operatorOpp.id,
          contactId: wile.id,
          role: "Other",
        }),
      "FORBIDDEN",
    );
    const orgOwn = createOpportunity(db, actorFor(orgAdmin.id), {
      accountId: acme.id,
      name: "Org Admin Deal",
      stage: "Prospecting",
      closeDate: "2026-12-20",
    });
    const orgRole = createOpportunityContactRole(db, actorFor(orgAdmin.id), {
      opportunityId: orgOwn.id,
      contactId: wile.id,
      role: "Other",
    });
    expect(orgRole.opportunityId).toBe(orgOwn.id);
    expect(listOpportunityContactRoles(db, LOCAL_ACTOR, operatorOpp.id)).toEqual([]);
  });

  it("uses opportunity edit, not delete, and still cascades on opportunity or contact delete", () => {
    const db = openMemoryDb().db;
    const deleter = createUser(db, {
      name: "Deleter",
      email: "deleter@example.com",
      username: "deleter",
      password: "long-enough",
    });
    const deleteProfile = createProfile(db, LOCAL_ACTOR, "Delete Not Edit");
    for (const objectType of ["account", "contact"] as const) {
      setObjectPermission(db, LOCAL_ACTOR, deleteProfile, objectType, FULL);
    }
    setObjectPermission(db, LOCAL_ACTOR, deleteProfile, "opportunity", {
      ...FULL,
      canUpdate: false,
    });
    addMember(db, LOCAL_ORG_ID, deleter.id, "member", deleteProfile);
    const deleteActor = actorFor(deleter.id);
    const account = createAccount(db, deleteActor, { name: "Delete Co" });
    const contact = createContact(db, deleteActor, {
      accountId: account.id,
      lastName: "Scorpio",
    });
    const opportunity = createOpportunity(db, deleteActor, {
      accountId: account.id,
      name: "Delete Deal",
      stage: "Prospecting",
      closeDate: "2026-11-02",
    });
    expectCode(
      () =>
        createOpportunityContactRole(db, deleteActor, {
          opportunityId: opportunity.id,
          contactId: contact.id,
          role: "Other",
        }),
      "FORBIDDEN",
    );
    const cascaded = createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opportunity.id,
      contactId: contact.id,
      role: "Decision Maker",
      isPrimary: true,
    });
    expectCode(
      () =>
        updateOpportunityContactRole(db, deleteActor, cascaded.id, {
          role: "Influencer",
          isPrimary: false,
        }),
      "FORBIDDEN",
    );
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, cascaded.id)?.role).toBe(
      "Decision Maker",
    );
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, cascaded.id)?.isPrimary).toBe(true);
    deleteOpportunity(db, deleteActor, opportunity.id);
    expect(getOpportunity(db, LOCAL_ACTOR, opportunity.id)).toBeUndefined();
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, cascaded.id)).toBeUndefined();

    const cascadeContact = createContact(db, deleteActor, {
      accountId: account.id,
      lastName: "Cascade",
    });
    const cascadeDeal = createOpportunity(db, deleteActor, {
      accountId: account.id,
      name: "Cascade Deal",
      stage: "Prospecting",
      closeDate: "2026-11-05",
    });
    const cascadeRole = createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: cascadeDeal.id,
      contactId: cascadeContact.id,
      role: "Other",
    });
    deleteContact(db, deleteActor, cascadeContact.id);
    expect(getContact(db, LOCAL_ACTOR, cascadeContact.id)).toBeUndefined();
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, cascadeRole.id)).toBeUndefined();
    expect(getOpportunity(db, deleteActor, cascadeDeal.id)?.name).toBe("Cascade Deal");

    const editor = createUser(db, {
      name: "Role Editor",
      email: "role.editor@example.com",
      username: "roleeditor",
      password: "long-enough",
    });
    const editProfile = createProfile(db, LOCAL_ACTOR, "Edit Not Delete");
    for (const objectType of ["account", "contact"] as const) {
      setObjectPermission(db, LOCAL_ACTOR, editProfile, objectType, FULL);
    }
    setObjectPermission(db, LOCAL_ACTOR, editProfile, "opportunity", {
      ...FULL,
      canDelete: false,
    });
    addMember(db, LOCAL_ORG_ID, editor.id, "member", editProfile);
    const editActor = actorFor(editor.id);
    const editable = createAccount(db, editActor, { name: "Edit Co" });
    const person = createContact(db, editActor, {
      accountId: editable.id,
      lastName: "Editor",
    });
    const deal = createOpportunity(db, editActor, {
      accountId: editable.id,
      name: "Edit Deal",
      stage: "Prospecting",
      closeDate: "2026-11-03",
    });
    const role = createOpportunityContactRole(db, editActor, {
      opportunityId: deal.id,
      contactId: person.id,
      role: "Influencer",
    });
    const updated = updateOpportunityContactRole(db, editActor, role.id, {
      role: "Decision Maker",
      isPrimary: true,
    });
    expect(updated.role).toBe("Decision Maker");
    expect(updated.isPrimary).toBe(true);
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, role.id)?.role).toBe("Decision Maker");
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, role.id)?.isPrimary).toBe(true);
    deleteOpportunityContactRole(db, editActor, role.id);
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, role.id)).toBeUndefined();
    expectCode(() => deleteOpportunity(db, editActor, deal.id), "FORBIDDEN");
    expect(getOpportunity(db, editActor, deal.id)?.name).toBe("Edit Deal");
  });

  it("rolls back lead convert when the actor cannot edit the new opportunity", () => {
    const db = openMemoryDb().db;
    const user = createUser(db, {
      name: "Converter",
      email: "converter@example.com",
      username: "converter",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "Create Not Edit");
    for (const objectType of ["account", "contact", "lead"] as const) {
      setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, FULL);
    }
    setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
      ...FULL,
      canUpdate: false,
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const actor = actorFor(user.id);
    const lead = createLead(db, actor, {
      lastName: "Jetson",
      company: "Spacely Sprockets",
    });

    expectCode(
      () =>
        convertLead(db, actor, lead.id, {
          createOpportunity: true,
          closeDate: "2026-12-01",
          opportunityName: "Sprocket Line",
        }),
      "FORBIDDEN",
    );
    expect(getLead(db, actor, lead.id)?.status).toBe("New");
    expect(getLead(db, actor, lead.id)?.convertedAccountId).toBeNull();
    const names = db
      .select({ name: accounts.name })
      .from(accounts)
      .all()
      .map((row) => row.name);
    expect(names).not.toContain("Spacely Sprockets");
  });
});
