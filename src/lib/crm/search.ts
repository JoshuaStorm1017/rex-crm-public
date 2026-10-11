import { and, eq, isNull, like, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, contacts, leads, opportunities, tasks } from "../db/schema";
import type { Actor } from "./actor";
import { assertActor } from "./actor";
import type { RecordObjectType } from "./constants";
import { canPerform, fieldAccess } from "./permissions";
import { readRestrictionSql } from "./sharing";
import { recordHref, recordLabel } from "./objects";

export type SearchHit = {
  objectType: RecordObjectType;
  id: string;
  name: string;
  subtitle: string;
  href: string;
};

const PER_OBJECT = 20;

function likeTerm(raw: string): string | undefined {
  const term = raw.replace(/[%_]/g, " ").replace(/\s+/g, " ").trim();
  if (term.length < 1) return undefined;
  return `%${term}%`;
}

export function searchRecords(
  db: Db,
  actor: Actor,
  rawQuery: string,
): SearchHit[] {
  assertActor(db, actor);
  const pattern = likeTerm(rawQuery);
  if (!pattern) return [];

  const hits: SearchHit[] = [];

  if (canPerform(db, actor, "account", "read")) {
    const accountFields = fieldAccess(db, actor, "account");
    const accountRows = accountFields.canRead("name")
      ? db
          .select()
          .from(accounts)
          .where(
            and(
              eq(accounts.orgId, actor.orgId),
              isNull(accounts.deletedAt),
              readRestrictionSql(db, actor, "account", accounts.ownerId),
              like(accounts.name, pattern),
            ),
          )
          .orderBy(accounts.name)
          .limit(PER_OBJECT)
          .all()
      : [];
    for (const row of accountRows) {
      hits.push({
        objectType: "account",
        id: row.id,
        name: row.name,
        subtitle: accountFields.canRead("type")
          ? (row.type ?? recordLabel("account"))
          : recordLabel("account"),
        href: recordHref("account", row.id),
      });
    }
  }

  if (canPerform(db, actor, "contact", "read")) {
    const contactFields = fieldAccess(db, actor, "contact");
    const contactRows = contactFields.canRead("name")
      ? db
          .select()
          .from(contacts)
          .where(
            and(
              eq(contacts.orgId, actor.orgId),
              isNull(contacts.deletedAt),
              readRestrictionSql(db, actor, "contact", contacts.ownerId),
              contactFields.canRead("email")
                ? or(like(contacts.name, pattern), like(contacts.email, pattern))
                : like(contacts.name, pattern),
            ),
          )
          .orderBy(contacts.lastName, contacts.firstName)
          .limit(PER_OBJECT)
          .all()
      : [];
    for (const row of contactRows) {
      hits.push({
        objectType: "contact",
        id: row.id,
        name: row.name,
        subtitle: contactFields.canRead("email")
          ? (row.email ?? recordLabel("contact"))
          : recordLabel("contact"),
        href: recordHref("contact", row.id),
      });
    }
  }

  if (canPerform(db, actor, "lead", "read")) {
    const leadFields = fieldAccess(db, actor, "lead");
    const leadRows = leadFields.canRead("name")
      ? db
          .select()
          .from(leads)
          .where(
            and(
              eq(leads.orgId, actor.orgId),
              isNull(leads.deletedAt),
              readRestrictionSql(db, actor, "lead", leads.ownerId),
              or(
                like(leads.name, pattern),
                ...(leadFields.canRead("email")
                  ? [like(leads.email, pattern)]
                  : []),
                ...(leadFields.canRead("company")
                  ? [like(leads.company, pattern)]
                  : []),
              ),
            ),
          )
          .orderBy(leads.name)
          .limit(PER_OBJECT)
          .all()
      : [];
    for (const row of leadRows) {
      hits.push({
        objectType: "lead",
        id: row.id,
        name: row.name,
        subtitle: leadFields.canRead("company")
          ? row.company
          : recordLabel("lead"),
        href: recordHref("lead", row.id),
      });
    }
  }

  if (canPerform(db, actor, "opportunity", "read")) {
    const opportunityFields = fieldAccess(db, actor, "opportunity");
    const opportunityRows = opportunityFields.canRead("name")
      ? db
          .select()
          .from(opportunities)
          .where(
            and(
              eq(opportunities.orgId, actor.orgId),
              isNull(opportunities.deletedAt),
              readRestrictionSql(db, actor, "opportunity", opportunities.ownerId),
              like(opportunities.name, pattern),
            ),
          )
          .orderBy(opportunities.name)
          .limit(PER_OBJECT)
          .all()
      : [];
    for (const row of opportunityRows) {
      hits.push({
        objectType: "opportunity",
        id: row.id,
        name: row.name,
        subtitle: opportunityFields.canRead("stage")
          ? row.stage
          : recordLabel("opportunity"),
        href: recordHref("opportunity", row.id),
      });
    }
  }

  if (canPerform(db, actor, "task", "read")) {
    const taskFields = fieldAccess(db, actor, "task");
    const taskRows = taskFields.canRead("name")
      ? db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.orgId, actor.orgId),
              isNull(tasks.deletedAt),
              readRestrictionSql(db, actor, "task", tasks.ownerId),
              like(tasks.name, pattern),
            ),
          )
          .orderBy(tasks.name)
          .limit(PER_OBJECT)
          .all()
      : [];
    for (const row of taskRows) {
      hits.push({
        objectType: "task",
        id: row.id,
        name: row.name,
        subtitle: taskFields.canRead("status")
          ? row.status
          : recordLabel("task"),
        href: recordHref("task", row.id),
      });
    }
  }

  return hits;
}
