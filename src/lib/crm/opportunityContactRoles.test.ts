import { LOCAL_ACTOR } from "./actor";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../db/client";
import { createAccount } from "./accounts";
import { createContact, deleteContact, updateContact } from "./contacts";
import { DomainError } from "./errors";
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
});
