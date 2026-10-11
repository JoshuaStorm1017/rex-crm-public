import { LOCAL_ACTOR, actorFor } from "./actor";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { createAccount } from "./accounts";
import { RILEY_USER_ID } from "./constants";
import { createContact, deleteContact, updateContact } from "./contacts";
import { DomainError } from "./errors";
import { setOrgWideDefault } from "./sharing";
import {
  createOpportunity,
  deleteOpportunity,
  getOpportunity,
} from "./opportunities";
import {
  createOpportunityContactRole,
  deleteOpportunityContactRole,
  getOpportunityContactRole,
  listOpportunityContactRoles,
  listOpportunityContactRolesForContact,
  updateOpportunityContactRole,
} from "./opportunityContactRoles";

const riley = actorFor(RILEY_USER_ID);

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
      "FORBIDDEN",
    );
    expectCode(() => deleteOpportunityContactRole(db, riley, role.id), "FORBIDDEN");
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
});
