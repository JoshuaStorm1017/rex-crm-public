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
import { createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import { setOrgWideDefault } from "./sharing";
import { createUser } from "./users";
import {
  createOpportunityContactRole,
  deleteOpportunityContactRole,
  getOpportunityContactRole,
  listOpportunityContactRoles,
  listOpportunityContactRolesForContact,
  updateOpportunityContactRole,
} from "./opportunityContactRoles";

const riley = actorFor(RILEY_USER_ID);

const FULL = {
  canCreate: true,
  canRead: true,
  canUpdate: true,
  canDelete: true,
} as const;


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

  it("drops a contact the member cannot read, and edit requires the opportunity", () => {
    const { db, wile, opp } = setup();
    const role = createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opp.id,
      contactId: wile.id,
      role: "Decision Maker",
      isPrimary: true,
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);
    const listed = listOpportunityContactRoles(db, riley, opp.id);
    expect(listed).toEqual([]);
    expect(JSON.stringify(listed)).not.toContain("wile@acme.test");
    expect(JSON.stringify(listed)).not.toContain("Wile E. Coyote");
    expectCode(
      () => updateOpportunityContactRole(db, riley, role.id, { role: "Other" }),
      "NOT_FOUND",
    );
    // The contact is unreadable, so the role is not found before the
    // opportunity edit check runs.
    expectCode(() => deleteOpportunityContactRole(db, riley, role.id), "NOT_FOUND");
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, role.id)?.role).toBe("Decision Maker");

    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", true);
    expect(listOpportunityContactRoles(db, riley, opp.id)).toEqual([]);
    expectCode(() => deleteOpportunityContactRole(db, riley, role.id), "NOT_FOUND");
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, role.id)?.contactId).toBe(wile.id);
  });

  it("drops an opportunity the member cannot read from the contact", () => {
    const { db, wile, opp } = setup();
    createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opp.id,
      contactId: wile.id,
      role: "Decision Maker",
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", true);
    const listed = listOpportunityContactRolesForContact(db, riley, wile.id);
    expect(listed).toEqual([]);
    expect(JSON.stringify(listed)).not.toContain("Anvil Restock");
    expect(JSON.stringify(listed)).not.toContain("Prospecting");
    expect(JSON.stringify(listed)).not.toContain("2026-10-31");
  });

  it("does not attach a contact the member cannot read", () => {
    const { db, acme, wile } = setup();
    setOrgWideDefault(db, LOCAL_ACTOR, "contact", "private", true);
    const opp = createOpportunity(db, riley, {
      accountId: acme.id,
      name: "Riley Deal",
      stage: "Prospecting",
      closeDate: "2026-11-30",
    });
    expectCode(
      () =>
        createOpportunityContactRole(db, riley, {
          opportunityId: opp.id,
          contactId: wile.id,
          role: "Other",
        }),
      "INVALID_CONTACT",
    );
    expect(listOpportunityContactRoles(db, LOCAL_ACTOR, opp.id)).toEqual([]);
  });

  it("lets the owner add, update, and delete a role on their own opportunity", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, riley, { name: "Riley Co" });
    const contact = createContact(db, riley, {
      accountId: account.id,
      lastName: "Lane",
      email: "lane@example.com",
    });
    const opp = createOpportunity(db, riley, {
      accountId: account.id,
      name: "Lane Deal",
      stage: "Prospecting",
      closeDate: "2026-11-01",
    });
    const role = createOpportunityContactRole(db, riley, {
      opportunityId: opp.id,
      contactId: contact.id,
      role: "Decision Maker",
    });
    expect(listOpportunityContactRoles(db, riley, opp.id)[0]?.contactEmail).toBe(
      "lane@example.com",
    );
    expect(
      listOpportunityContactRolesForContact(db, riley, contact.id)[0]?.opportunityName,
    ).toBe("Lane Deal");
    updateOpportunityContactRole(db, riley, role.id, { isPrimary: true });
    expect(getOpportunityContactRole(db, riley, role.id)?.isPrimary).toBe(true);
    deleteOpportunityContactRole(db, riley, role.id);
    expect(listOpportunityContactRoles(db, riley, opp.id)).toEqual([]);
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

  it("uses opportunity edit, not delete, cascades on opportunity delete, and refuses contact delete", () => {
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
    expectCode(() => deleteContact(db, deleteActor, cascadeContact.id), "HAS_CHILDREN");
    expect(getContact(db, LOCAL_ACTOR, cascadeContact.id)?.lastName).toBe("Cascade");
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, cascadeRole.id)?.role).toBe("Other");
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

  it("redacts contact title and email the actor cannot read", () => {
    const db = openMemoryDb().db;
    const user = createUser(db, {
      name: "Field Reader",
      email: "field.reader@example.com",
      username: "fieldreader",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "Hide Contact Fields");
    for (const objectType of ["account", "contact", "opportunity"] as const) {
      setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, FULL);
    }
    setFieldPermission(db, LOCAL_ACTOR, profileId, "contact", "email", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "contact", "title", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const actor = actorFor(user.id);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Field Co" });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Private",
      email: "private@example.com",
      title: "Secret Title",
    });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Field Deal",
      stage: "Prospecting",
      closeDate: "2026-12-01",
    });
    createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opportunity.id,
      contactId: contact.id,
      role: "Decision Maker",
    });
    const listed = listOpportunityContactRoles(db, actor, opportunity.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.contactName).toBe("Private");
    expect(listed[0]?.contactEmail).toBeNull();
    expect(listed[0]?.contactTitle).toBeNull();
    expect(JSON.stringify(listed)).not.toContain("private@example.com");
    expect(JSON.stringify(listed)).not.toContain("Secret Title");

    setFieldPermission(db, LOCAL_ACTOR, profileId, "contact", "name", {
      canRead: false,
      canEdit: false,
    });
    const hiddenName = listOpportunityContactRoles(db, actor, opportunity.id);
    expect(hiddenName[0]?.contactName).toBe("—");
    expect(JSON.stringify(hiddenName)).not.toContain("Private");
    expect(JSON.stringify(hiddenName)).not.toContain("private@example.com");
  });

  it("redacts opportunity name, stage, and close date the actor cannot read", () => {
    const db = openMemoryDb().db;
    const user = createUser(db, {
      name: "Deal Reader",
      email: "deal.reader@example.com",
      username: "dealreader",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "Hide Opportunity Fields");
    for (const objectType of ["account", "contact", "opportunity"] as const) {
      setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, FULL);
    }
    setFieldPermission(db, LOCAL_ACTOR, profileId, "opportunity", "stage", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "opportunity", "closeDate", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const actor = actorFor(user.id);
    const account = createAccount(db, LOCAL_ACTOR, { name: "Field Co" });
    const contact = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      lastName: "Public",
    });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Field Deal",
      stage: "Prospecting",
      closeDate: "2026-12-19",
    });
    createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opportunity.id,
      contactId: contact.id,
      role: "Decision Maker",
    });
    const listed = listOpportunityContactRolesForContact(db, actor, contact.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.opportunityName).toBe("Field Deal");
    expect(listed[0]?.opportunityStage).toBe("—");
    expect(listed[0]?.opportunityCloseDate).toBe("—");
    const payload = JSON.stringify(listed);
    expect(payload).not.toContain("Prospecting");
    expect(payload).not.toContain("2026-12-19");

    setFieldPermission(db, LOCAL_ACTOR, profileId, "opportunity", "name", {
      canRead: false,
      canEdit: false,
    });
    const hiddenName = listOpportunityContactRolesForContact(db, actor, contact.id);
    expect(hiddenName[0]?.opportunityName).toBe("—");
    expect(hiddenName[0]?.opportunityStage).toBe("—");
    expect(hiddenName[0]?.opportunityCloseDate).toBe("—");
    expect(JSON.stringify(hiddenName)).not.toContain("Field Deal");
    expect(JSON.stringify(hiddenName)).not.toContain("Prospecting");
    expect(JSON.stringify(hiddenName)).not.toContain("2026-12-19");
  });

  it("refuses to move a contact that is on an opportunity the actor cannot read", () => {
    const db = openMemoryDb().db;
    const home = createAccount(db, riley, { name: "Home Co" });
    const away = createAccount(db, riley, { name: "Away Co" });
    const contact = createContact(db, riley, {
      accountId: home.id,
      lastName: "Mover",
    });
    const opportunity = createOpportunity(db, LOCAL_ACTOR, {
      accountId: home.id,
      name: "Hidden Restock",
      stage: "Prospecting",
      closeDate: "2026-12-15",
    });
    const role = createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: opportunity.id,
      contactId: contact.id,
      role: "Other",
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", true);
    expect(listOpportunityContactRolesForContact(db, riley, contact.id)).toEqual([]);
    try {
      updateContact(db, riley, contact.id, { accountId: away.id });
      throw new Error("expected refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("HAS_CHILDREN");
      expect((error as DomainError).message).toBe(
        "Cannot move a contact that is on an opportunity",
      );
      expect((error as DomainError).message).not.toContain("Hidden Restock");
    }
    expect(getContact(db, riley, contact.id)?.accountId).toBe(home.id);
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, role.id)?.opportunityId).toBe(
      opportunity.id,
    );

    const user = createUser(db, {
      name: "No Deals",
      email: "no.deals@example.com",
      username: "nodeals",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Opportunity Read");
    for (const objectType of ["account", "contact"] as const) {
      setObjectPermission(db, LOCAL_ACTOR, profileId, objectType, FULL);
    }
    setObjectPermission(db, LOCAL_ACTOR, profileId, "opportunity", {
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
    });
    addMember(db, LOCAL_ORG_ID, user.id, "member", profileId);
    const actor = actorFor(user.id);
    const actorHome = createAccount(db, actor, { name: "Actor Home" });
    const actorAway = createAccount(db, actor, { name: "Actor Away" });
    const actorContact = createContact(db, actor, {
      accountId: actorHome.id,
      lastName: "Blind",
    });
    const visible = createOpportunity(db, LOCAL_ACTOR, {
      accountId: actorHome.id,
      name: "Visible Restock",
      stage: "Qualification",
      closeDate: "2026-12-16",
    });
    createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: visible.id,
      contactId: actorContact.id,
      role: "Other",
    });
    expect(listOpportunityContactRolesForContact(db, actor, actorContact.id)).toEqual([]);
    try {
      updateContact(db, actor, actorContact.id, { accountId: actorAway.id });
      throw new Error("expected refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).message).toBe(
        "Cannot move a contact that is on an opportunity",
      );
      expect((error as DomainError).message).not.toContain("Visible Restock");
    }
    expect(getContact(db, actor, actorContact.id)?.accountId).toBe(actorHome.id);
  });

  it("does not block contact delete on an opportunity the actor cannot read, and keeps that role", () => {
    const db = openMemoryDb().db;
    const account = createAccount(db, riley, { name: "Riley Co" });
    const contact = createContact(db, riley, {
      accountId: account.id,
      lastName: "Lane",
    });
    const hiddenOpp = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Hidden Deal",
      stage: "Prospecting",
      closeDate: "2026-12-01",
    });
    const hiddenRole = createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: hiddenOpp.id,
      contactId: contact.id,
      role: "Other",
    });
    const ownOpp = createOpportunity(db, riley, {
      accountId: account.id,
      name: "Own Deal",
      stage: "Prospecting",
      closeDate: "2026-12-02",
    });
    const ownRole = createOpportunityContactRole(db, riley, {
      opportunityId: ownOpp.id,
      contactId: contact.id,
      role: "Decision Maker",
    });
    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "private", true);
    deleteContact(db, riley, contact.id);
    expect(getContact(db, riley, contact.id)).toBeUndefined();
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, hiddenRole.id)?.role).toBe("Other");
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, ownRole.id)).toBeUndefined();
    expect(getOpportunity(db, LOCAL_ACTOR, hiddenOpp.id)?.name).toBe("Hidden Deal");

    setOrgWideDefault(db, LOCAL_ACTOR, "opportunity", "public_read", true);
    const contact2 = createContact(db, riley, {
      accountId: account.id,
      lastName: "Kent",
    });
    const seenOpp = createOpportunity(db, LOCAL_ACTOR, {
      accountId: account.id,
      name: "Shared Deal",
      stage: "Prospecting",
      closeDate: "2026-12-03",
    });
    const seenRole = createOpportunityContactRole(db, LOCAL_ACTOR, {
      opportunityId: seenOpp.id,
      contactId: contact2.id,
      role: "Influencer",
    });
    expect(
      listOpportunityContactRolesForContact(db, riley, contact2.id)[0]?.opportunityName,
    ).toBe("Shared Deal");
    try {
      deleteContact(db, riley, contact2.id);
      throw new Error("expected refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("HAS_CHILDREN");
      expect((error as DomainError).message).toMatch(/other records still depend/i);
      expect((error as DomainError).message).not.toMatch(/Shared Deal/);
    }
    expect(getContact(db, riley, contact2.id)?.lastName).toBe("Kent");
    expect(getOpportunityContactRole(db, LOCAL_ACTOR, seenRole.id)?.role).toBe("Influencer");
  });
});
