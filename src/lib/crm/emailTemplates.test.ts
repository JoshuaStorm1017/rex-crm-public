import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { EmailPreview } from "../../components/EmailPreview";
import { openMemoryDb, type Db } from "../db/client";
import { eq } from "drizzle-orm";
import { emailTemplates, organizations, users } from "../db/schema";
import { createAccount } from "./accounts";
import { LOCAL_ACTOR, actorFor } from "./actor";
import { LOCAL_ORG_ID, RILEY_USER_ID } from "./constants";
import { createContact } from "./contacts";
import {
  createEmailTemplate,
  getEmailTemplate,
  listEmailTemplates,
  renderTemplate,
  updateEmailTemplate,
} from "./emailTemplates";
import { addMember, createOrganization } from "./orgs";
import { createProfile, setFieldPermission, setObjectPermission } from "./profiles";
import { createUser } from "./users";

const WELCOME = {
  name: "Welcome",
  subject: "Hello {{Contact.FirstName}}",
  body: "Dear {{Contact.FirstName}} {{Contact.LastName}} of {{Account.Name}},\nEmail: {{Contact.Email}}",
};

function snapshot(db: Db): string {
  return JSON.stringify(db.select().from(emailTemplates).all());
}

function setup() {
  const db = openMemoryDb().db;
  const account = createAccount(db, LOCAL_ACTOR, { name: "Vandelay Industries" });
  const contact = createContact(db, LOCAL_ACTOR, {
    accountId: account.id,
    firstName: "Art",
    lastName: "Vandelay",
    email: "art@example.com",
  });
  const template = createEmailTemplate(db, LOCAL_ACTOR, WELCOME);
  return { db, account, contact, template };
}

function otherOrg(db: Db) {
  const owner = createUser(db, {
    name: "Owen Other",
    email: "owen.other@example.org",
    username: "owenother",
    password: "long-enough",
  });
  const org = createOrganization(db, "Other Org", owner.id);
  return actorFor(owner.id, org.id);
}

function expectRefused(db: Db, fn: () => unknown, code: string) {
  const before = snapshot(db);
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect((caught as { code?: string })?.code).toBe(code);
  const message = (caught as Error).message;
  expect(message).not.toMatch(/00X|003|001|00D|usr_/);
  expect(snapshot(db)).toBe(before);
}

describe("email templates", () => {
  it("renders readable contact and account fields as plain text", () => {
    const { db, contact, template } = setup();
    expect(renderTemplate(db, LOCAL_ACTOR, template.id, contact.id)).toEqual({
      subject: "Hello Art",
      body: "Dear Art Vandelay of Vandelay Industries,\nEmail: art@example.com",
    });
    expect(listEmailTemplates(db, LOCAL_ACTOR).map((row) => row.name)).toEqual(["Welcome"]);
  });

  it("lets an admin edit, and validates the edit", () => {
    const { db, template } = setup();
    const updated = updateEmailTemplate(db, LOCAL_ACTOR, template.id, {
      ...WELCOME,
      subject: "Hi {{Contact.Name}}",
    });
    expect(updated.subject).toBe("Hi {{Contact.Name}}");
    expectRefused(
      db,
      () => updateEmailTemplate(db, LOCAL_ACTOR, template.id, { ...WELCOME, body: "{{Contact.Ssn}}" }),
      "INVALID_FIELD",
    );
  });

  it("renders a field hidden by field-level security as empty", () => {
    const { db, contact, template } = setup();
    const reader = createUser(db, {
      name: "Fls Reader",
      email: "fls.reader@example.com",
      username: "flsreader",
      password: "long-enough",
    });
    const profileId = createProfile(db, LOCAL_ACTOR, "No Email");
    const full = { canCreate: true, canRead: true, canUpdate: true, canDelete: true };
    setObjectPermission(db, LOCAL_ACTOR, profileId, "contact", full);
    setObjectPermission(db, LOCAL_ACTOR, profileId, "account", full);
    setFieldPermission(db, LOCAL_ACTOR, profileId, "contact", "email", {
      canRead: false,
      canEdit: false,
    });
    setFieldPermission(db, LOCAL_ACTOR, profileId, "account", "name", {
      canRead: false,
      canEdit: false,
    });
    addMember(db, LOCAL_ORG_ID, reader.id, "member", profileId);
    const rendered = renderTemplate(db, actorFor(reader.id), template.id, contact.id);
    expect(rendered.body).toBe("Dear Art Vandelay of ,\nEmail: ");
    expect(JSON.stringify(rendered)).not.toContain("art@example.com");
    expect(JSON.stringify(rendered)).not.toContain("Vandelay Industries");
  });

  it("refuses unknown fields and template-injection attempts on save", () => {
    const { db } = setup();
    for (const body of ["{{Contact.Ssn}}", "{{Contact.constructor}}"]) {
      expectRefused(db, () => createEmailTemplate(db, LOCAL_ACTOR, { ...WELCOME, body }), "INVALID_FIELD");
    }
    for (const body of [
      "{{constructor.constructor('return process')()}}",
      "{{ Contact.FirstName }}",
      "{{Contact.__proto__}}",
      "{{{{Contact.FirstName}}}}",
      "${process.env.REX_GITHUB_TOKEN}",
      "<%= secret %>",
    ]) {
      expectRefused(db, () => createEmailTemplate(db, LOCAL_ACTOR, { ...WELCOME, body }), "INVALID_VALUE");
    }
    expectRefused(db, () => createEmailTemplate(db, LOCAL_ACTOR, { ...WELCOME, name: " " }), "INVALID_NAME");
    expectRefused(
      db,
      () => createEmailTemplate(db, LOCAL_ACTOR, { ...WELCOME, body: "x".repeat(10_001) }),
      "INVALID_VALUE",
    );
  });

  it("does not expand merge syntax stored inside a record value", () => {
    const { db, account, template } = setup();
    const sneaky = createContact(db, LOCAL_ACTOR, {
      accountId: account.id,
      firstName: "{{Contact.Email}}",
      lastName: "Sneak",
      email: "sneak@example.com",
    });
    const rendered = renderTemplate(db, LOCAL_ACTOR, template.id, sneaky.id);
    expect(rendered.subject).toBe("Hello {{Contact.Email}}");
  });

  it("refuses create and edit for a non-admin member", () => {
    const { db, template } = setup();
    const riley = actorFor(RILEY_USER_ID);
    expectRefused(db, () => createEmailTemplate(db, riley, WELCOME), "FORBIDDEN");
    expectRefused(db, () => updateEmailTemplate(db, riley, template.id, WELCOME), "FORBIDDEN");
  });

  it("isolates templates and contacts by org, including a planted row", () => {
    const { db, contact, template } = setup();
    const other = otherOrg(db);
    expect(listEmailTemplates(db, other)).toEqual([]);
    expectRefused(db, () => getEmailTemplate(db, other, template.id), "NOT_FOUND");
    expectRefused(db, () => updateEmailTemplate(db, other, template.id, WELCOME), "NOT_FOUND");
    expectRefused(db, () => renderTemplate(db, other, template.id, contact.id), "NOT_FOUND");

    const planted = createEmailTemplate(db, other, { ...WELCOME, name: "Planted" });
    const otherAccount = createAccount(db, other, { name: "Other Account" });
    const otherContact = createContact(db, other, {
      accountId: otherAccount.id,
      firstName: "Olga",
      lastName: "Other",
      email: "olga@example.org",
    });
    expect(listEmailTemplates(db, LOCAL_ACTOR).map((row) => row.name)).toEqual(["Welcome"]);
    expectRefused(db, () => getEmailTemplate(db, LOCAL_ACTOR, planted.id), "NOT_FOUND");
    expectRefused(db, () => updateEmailTemplate(db, LOCAL_ACTOR, planted.id, WELCOME), "NOT_FOUND");
    expectRefused(db, () => renderTemplate(db, LOCAL_ACTOR, template.id, otherContact.id), "NOT_FOUND");
    expectRefused(db, () => renderTemplate(db, LOCAL_ACTOR, planted.id, contact.id), "NOT_FOUND");
    expect(getEmailTemplate(db, other, planted.id).name).toBe("Planted");
  });

  it("escapes HTML in the preview", () => {
    const html = renderToStaticMarkup(
      createElement(EmailPreview, {
        email: { subject: "<b>Hi</b>", body: "<script>alert(1)</script> & \"x\"" },
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>Hi</b>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;");
  });

  describe("refuses inactive or outside actors with FORBIDDEN and no row changes", () => {
    function adminInLocalOrg(db: Db, username: string) {
      const user = createUser(db, {
        name: `Test ${username}`,
        email: `${username}@example.org`,
        username,
        password: "long-enough",
      });
      addMember(db, LOCAL_ORG_ID, user.id, "admin");
      return actorFor(user.id);
    }

    const cases: Array<[string, (db: Db) => { actor: ReturnType<typeof actorFor>; templateId?: string; contactId?: string }]> = [
      [
        "a non-member of the org",
        (db) => {
          const outsider = createUser(db, {
            name: "Nora Outsider",
            email: "nora.outsider@example.org",
            username: "noraoutsider",
            password: "long-enough",
          });
          return { actor: actorFor(outsider.id) };
        },
      ],
      [
        "a deleted user",
        (db) => {
          const actor = adminInLocalOrg(db, "deliadeleted");
          db.update(users).set({ deletedAt: Date.now() }).where(eq(users.id, actor.userId)).run();
          return { actor };
        },
      ],
      [
        "a disabled user (no login)",
        (db) => {
          const actor = adminInLocalOrg(db, "dariusdisabled");
          db.update(users)
            .set({ username: null, passwordHash: null })
            .where(eq(users.id, actor.userId))
            .run();
          return { actor };
        },
      ],
      [
        "a user in a suspended org",
        (db) => {
          const actor = otherOrg(db);
          const own = createEmailTemplate(db, actor, { ...WELCOME, name: "Suspended" });
          const ownAccount = createAccount(db, actor, { name: "Spindle Supply" });
          const ownContact = createContact(db, actor, {
            accountId: ownAccount.id,
            firstName: "Sue",
            lastName: "Spended",
          });
          db.update(organizations)
            .set({ status: "suspended" })
            .where(eq(organizations.id, actor.orgId))
            .run();
          return { actor, templateId: own.id, contactId: ownContact.id };
        },
      ],
    ];

    for (const [label, makeActor] of cases) {
      it(`refuses create, edit and render for ${label}`, () => {
        const { db, contact, template } = setup();
        const made = makeActor(db);
        const templateId = made.templateId ?? template.id;
        const contactId = made.contactId ?? contact.id;
        const count = () => db.select().from(emailTemplates).all().length;
        const countBefore = count();
        expectRefused(db, () => createEmailTemplate(db, made.actor, { ...WELCOME, name: "Nope" }), "FORBIDDEN");
        expectRefused(
          db,
          () => updateEmailTemplate(db, made.actor, templateId, { ...WELCOME, name: "Changed" }),
          "FORBIDDEN",
        );
        expectRefused(db, () => renderTemplate(db, made.actor, templateId, contactId), "FORBIDDEN");
        expect(count()).toBe(countBefore);
        expect(db.select().from(emailTemplates).all().some((row) => row.name === "Changed" || row.name === "Nope")).toBe(false);
      });
    }
  });
});
