import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { emailTemplates } from "../db/schema";
import { getAccount } from "./accounts";
import { assertActor, assertCurrentOrgAdmin, type Actor } from "./actor";
import { getContact } from "./contacts";
import { DomainError } from "./errors";
import { ID_PREFIX, newId } from "./ids";

export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type EmailTemplateInput = { name: string; subject: string; body: string };
export type RenderedEmail = { subject: string; body: string };

/** Merge field → [object, domain field]. Nothing outside this list renders. */
export const MERGE_FIELDS = {
  "Contact.FirstName": ["contact", "firstName"],
  "Contact.LastName": ["contact", "lastName"],
  "Contact.Name": ["contact", "name"],
  "Contact.Title": ["contact", "title"],
  "Contact.Email": ["contact", "email"],
  "Contact.Phone": ["contact", "phone"],
  "Account.Name": ["account", "name"],
  "Account.Industry": ["account", "industry"],
  "Account.Website": ["account", "website"],
} as const satisfies Record<string, readonly ["contact" | "account", string]>;

type MergeField = keyof typeof MERGE_FIELDS;

const LIMITS = { name: 80, subject: 200, body: 10_000 } as const;
const TOKEN = /\{\{([A-Za-z]+\.[A-Za-z]+)\}\}/g;

function isMergeField(key: string): key is MergeField {
  return Object.prototype.hasOwnProperty.call(MERGE_FIELDS, key);
}

/** Every `{{`/`}}` must belong to a known `{{Object.Field}}` token. */
function assertMergeText(label: string, text: string): void {
  for (const match of text.matchAll(TOKEN)) {
    if (!isMergeField(match[1]!)) {
      throw new DomainError("INVALID_FIELD", `Unknown merge field in ${label}`);
    }
  }
  const rest = text.replace(TOKEN, "");
  if (/\{\{|\}\}|\$\{|<%/.test(rest)) {
    throw new DomainError("INVALID_VALUE", `Malformed merge field in ${label}`);
  }
}

function cleanInput(input: EmailTemplateInput): EmailTemplateInput {
  const name = String(input.name ?? "").trim();
  const subject = String(input.subject ?? "").trim();
  const body = String(input.body ?? "");
  if (!name || name.length > LIMITS.name) {
    throw new DomainError("INVALID_NAME", `Name is required (max ${LIMITS.name})`);
  }
  if (!subject || subject.length > LIMITS.subject) {
    throw new DomainError("INVALID_VALUE", `Subject is required (max ${LIMITS.subject})`);
  }
  if (body.length > LIMITS.body) {
    throw new DomainError("INVALID_VALUE", `Body is too long (max ${LIMITS.body})`);
  }
  assertMergeText("subject", subject);
  assertMergeText("body", body);
  return { name, subject, body };
}

function loadTemplate(db: Db, actor: Actor, id: string): EmailTemplate {
  const row = db
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.id, id), eq(emailTemplates.orgId, actor.orgId)))
    .get();
  if (!row) throw new DomainError("NOT_FOUND", "Email template not found");
  return row;
}

export function listEmailTemplates(db: Db, actor: Actor): EmailTemplate[] {
  assertActor(db, actor);
  return db
    .select()
    .from(emailTemplates)
    .where(eq(emailTemplates.orgId, actor.orgId))
    .orderBy(asc(emailTemplates.name))
    .all();
}

export function getEmailTemplate(db: Db, actor: Actor, id: string): EmailTemplate {
  assertActor(db, actor);
  return loadTemplate(db, actor, id);
}

export function createEmailTemplate(
  db: Db,
  actor: Actor,
  input: EmailTemplateInput,
): EmailTemplate {
  assertCurrentOrgAdmin(db, actor);
  const clean = cleanInput(input);
  const ts = Date.now();
  const row = {
    id: newId(ID_PREFIX.emailTemplate),
    orgId: actor.orgId,
    ...clean,
    createdAt: ts,
    updatedAt: ts,
    createdBy: actor.userId,
    updatedBy: actor.userId,
  };
  db.insert(emailTemplates).values(row).run();
  return loadTemplate(db, actor, row.id);
}

export function updateEmailTemplate(
  db: Db,
  actor: Actor,
  id: string,
  input: EmailTemplateInput,
): EmailTemplate {
  assertCurrentOrgAdmin(db, actor);
  loadTemplate(db, actor, id);
  const clean = cleanInput(input);
  db.update(emailTemplates)
    .set({ ...clean, updatedAt: Date.now(), updatedBy: actor.userId })
    .where(and(eq(emailTemplates.id, id), eq(emailTemplates.orgId, actor.orgId)))
    .run();
  return loadTemplate(db, actor, id);
}

/**
 * Fill merge fields for one contact. Values come only from the redacted
 * records the actor can read, so a field hidden by field-level security,
 * or an account the actor cannot see, renders as empty. One pass only:
 * a value that looks like `{{...}}` is not expanded again. Nothing is sent.
 */
export function renderTemplate(
  db: Db,
  actor: Actor,
  templateId: string,
  contactId: string,
): RenderedEmail {
  assertActor(db, actor);
  const template = loadTemplate(db, actor, templateId);
  const contact = getContact(db, actor, contactId);
  if (!contact) throw new DomainError("NOT_FOUND", "Contact not found");
  const account = contact.accountId
    ? getAccount(db, actor, contact.accountId)
    : undefined;
  const records = { contact, account } as Record<string, unknown>;
  const fill = (text: string) =>
    text.replace(TOKEN, (_, key: string) => {
      if (!isMergeField(key)) return "";
      const [object, field] = MERGE_FIELDS[key];
      const record = records[object] as Record<string, unknown> | undefined;
      const value = record?.[field];
      return typeof value === "string" ? value : "";
    });
  return { subject: fill(template.subject), body: fill(template.body) };
}
