import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { LOCAL_ORG_ID } from "../crm/constants";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    username: text("username"),
    passwordHash: text("password_hash"),
    role: text("role").notNull().default("user"),
    deletedAt: integer("deleted_at"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: integer("locked_until"),
  },
  (table) => [
    uniqueIndex("users_username_uidx").on(table.username),
    uniqueIndex("users_email_uidx").on(table.email),
  ],
);

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const orgMemberships = sqliteTable(
  "org_memberships",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    profileId: text("profile_id"),
    roleId: text("role_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("org_memberships_org_user_uidx").on(table.orgId, table.userId),
    index("org_memberships_user_idx").on(table.userId),
    index("org_memberships_profile_idx").on(table.profileId),
    index("org_memberships_role_idx").on(table.roleId),
  ],
);

export const profiles = sqliteTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("profiles_org_name_uidx").on(table.orgId, table.name),
    index("profiles_org_idx").on(table.orgId),
  ],
);

export const profileObjectPermissions = sqliteTable(
  "profile_object_permissions",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id),
    objectType: text("object_type").notNull(),
    canCreate: integer("can_create", { mode: "boolean" }).notNull(),
    canRead: integer("can_read", { mode: "boolean" }).notNull(),
    canUpdate: integer("can_update", { mode: "boolean" }).notNull(),
    canDelete: integer("can_delete", { mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("profile_object_permissions_uidx").on(table.profileId, table.objectType),
  ],
);

export const profileFieldPermissions = sqliteTable(
  "profile_field_permissions",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id),
    objectType: text("object_type").notNull(),
    fieldName: text("field_name").notNull(),
    canRead: integer("can_read", { mode: "boolean" }).notNull(),
    canEdit: integer("can_edit", { mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("profile_field_permissions_uidx").on(
      table.profileId,
      table.objectType,
      table.fieldName,
    ),
  ],
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  activeOrgId: text("active_org_id").references(() => organizations.id),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const accounts = sqliteTable(
  "accounts",
  {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .default(LOCAL_ORG_ID),
  name: text("name").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  parentAccountId: text("parent_account_id").references(
    (): AnySQLiteColumn => accounts.id,
  ),
  type: text("type"),
  industry: text("industry"),
  website: text("website"),
  phone: text("phone"),
  annualRevenueCents: integer("annual_revenue_cents"),
  numberOfEmployees: integer("number_of_employees"),
  billingStreet: text("billing_street"),
  billingCity: text("billing_city"),
  billingState: text("billing_state"),
  billingPostalCode: text("billing_postal_code"),
  billingCountry: text("billing_country"),
  shippingStreet: text("shipping_street"),
  shippingCity: text("shipping_city"),
  shippingState: text("shipping_state"),
  shippingPostalCode: text("shipping_postal_code"),
  shippingCountry: text("shipping_country"),
  description: text("description"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  deletedAt: integer("deleted_at"),
  },
  (table) => [index("accounts_org_idx").on(table.orgId)],
);

export const contacts = sqliteTable(
  "contacts",
  {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .default(LOCAL_ORG_ID),
  name: text("name").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id),
  reportsToId: text("reports_to_id").references(
    (): AnySQLiteColumn => contacts.id,
  ),
  firstName: text("first_name"),
  lastName: text("last_name").notNull(),
  title: text("title"),
  email: text("email"),
  phone: text("phone"),
  mailingStreet: text("mailing_street"),
  mailingCity: text("mailing_city"),
  mailingState: text("mailing_state"),
  mailingPostalCode: text("mailing_postal_code"),
  mailingCountry: text("mailing_country"),
  description: text("description"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  deletedAt: integer("deleted_at"),
  },
  (table) => [index("contacts_org_idx").on(table.orgId)],
);

export const opportunities = sqliteTable(
  "opportunities",
  {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .default(LOCAL_ORG_ID),
  name: text("name").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id),
  amountCents: integer("amount_cents"),
  stage: text("stage").notNull(),
  probability: integer("probability").notNull(),
  closeDate: text("close_date").notNull(),
  type: text("type"),
  description: text("description"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  deletedAt: integer("deleted_at"),
  },
  (table) => [index("opportunities_org_idx").on(table.orgId)],
);

export const leads = sqliteTable(
  "leads",
  {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .default(LOCAL_ORG_ID),
  name: text("name").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  firstName: text("first_name"),
  lastName: text("last_name").notNull(),
  company: text("company").notNull(),
  email: text("email"),
  phone: text("phone"),
  title: text("title"),
  status: text("status").notNull(),
  source: text("source"),
  rating: text("rating"),
  street: text("street"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  country: text("country"),
  convertedAt: integer("converted_at"),
  convertedAccountId: text("converted_account_id").references(
    () => accounts.id,
  ),
  convertedContactId: text("converted_contact_id").references(
    () => contacts.id,
  ),
  convertedOpportunityId: text("converted_opportunity_id").references(
    () => opportunities.id,
  ),
  description: text("description"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  deletedAt: integer("deleted_at"),
  },
  (table) => [index("leads_org_idx").on(table.orgId)],
);

export const opportunityContactRoles = sqliteTable(
  "opportunity_contact_roles",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .default(LOCAL_ORG_ID),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => opportunities.id),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id),
    role: text("role"),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("opportunity_contact_roles_org_idx").on(table.orgId)],
);

export const tasks = sqliteTable(
  "tasks",
  {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .default(LOCAL_ORG_ID),
  name: text("name").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  status: text("status").notNull(),
  priority: text("priority").notNull(),
  dueDate: text("due_date"),
  relatedObjectType: text("related_object_type").notNull(),
  relatedRecordId: text("related_record_id").notNull(),
  description: text("description"),
  completedAt: integer("completed_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  deletedAt: integer("deleted_at"),
  },
  (table) => [index("tasks_org_idx").on(table.orgId)],
);

export const recentlyViewed = sqliteTable(
  "recently_viewed",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orgId: text("org_id")
      .notNull()
      .default(LOCAL_ORG_ID),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    recordId: text("record_id").notNull(),
    objectType: text("object_type").notNull(),
    viewedAt: integer("viewed_at").notNull(),
  },
  (table) => [index("recently_viewed_org_user_idx").on(table.orgId, table.userId)],
);

export const listViews = sqliteTable(
  "list_views",
  {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .default(LOCAL_ORG_ID),
  name: text("name").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  objectType: text("object_type").notNull(),
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
  columns: text("columns").notNull(),
  filters: text("filters").notNull(),
  sortField: text("sort_field").notNull(),
  sortDirection: text("sort_direction").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  deletedAt: integer("deleted_at"),
  },
  (table) => [index("list_views_org_idx").on(table.orgId)],
);

export const validationRules = sqliteTable(
  "validation_rules",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().default(LOCAL_ORG_ID),
    name: text("name").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    objectType: text("object_type").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    errorMessage: text("error_message").notNull(),
    errorField: text("error_field"),
    criteria: text("criteria").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (table) => [index("validation_rules_org_idx").on(table.orgId)],
);

export const assignmentRules = sqliteTable(
  "assignment_rules",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().default(LOCAL_ORG_ID),
    name: text("name").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    objectType: text("object_type").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    assignToId: text("assign_to_id")
      .notNull()
      .references(() => users.id),
    sortOrder: integer("sort_order").notNull().default(1),
    criteria: text("criteria").notNull(),
    assignMode: text("assign_mode").notNull().default("user"),
    poolUserIds: text("pool_user_ids").notNull().default("[]"),
    rrCursor: integer("rr_cursor").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (table) => [index("assignment_rules_org_idx").on(table.orgId)],
);

export const automationRules = sqliteTable(
  "automation_rules",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().default(LOCAL_ORG_ID),
    name: text("name").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    objectType: text("object_type").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    runOn: text("run_on").notNull(),
    field: text("field").notNull(),
    value: text("value").notNull(),
    criteria: text("criteria").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (table) => [index("automation_rules_org_idx").on(table.orgId)],
);

export const duplicateRules = sqliteTable(
  "duplicate_rules",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().default(LOCAL_ORG_ID),
    name: text("name").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    objectType: text("object_type").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    matchField: text("match_field").notNull(),
    errorMessage: text("error_message").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (table) => [index("duplicate_rules_org_idx").on(table.orgId)],
);

export const reports = sqliteTable(
  "reports",
  {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .default(LOCAL_ORG_ID),
  name: text("name").notNull(),
  description: text("description"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  objectType: text("object_type").notNull(),
  format: text("format").notNull(),
  columns: text("columns").notNull(),
  filters: text("filters").notNull(),
  sortField: text("sort_field").notNull(),
  sortDirection: text("sort_direction").notNull(),
  groupBy: text("group_by"),
  groupBy2: text("group_by_2"),
  aggregates: text("aggregates").notNull(),
  dateField: text("date_field"),
  dateRange: text("date_range"),
  dateFrom: text("date_from"),
  dateTo: text("date_to"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  deletedAt: integer("deleted_at"),
  },
  (table) => [index("reports_org_idx").on(table.orgId)],
);

export const customFields = sqliteTable(
  "custom_fields",
  {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .default(LOCAL_ORG_ID),
  objectType: text("object_type").notNull(),
  apiName: text("api_name").notNull(),
  label: text("label").notNull(),
  type: text("type").notNull(),
  required: integer("required", { mode: "boolean" }).notNull().default(false),
  helpText: text("help_text"),
  picklistValues: text("picklist_values"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  deletedAt: integer("deleted_at"),
  },
  (table) => [index("custom_fields_org_idx").on(table.orgId)],
);

export const customFieldValues = sqliteTable(
  "custom_field_values",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .default(LOCAL_ORG_ID),
    fieldId: text("field_id")
      .notNull()
      .references(() => customFields.id),
    recordId: text("record_id").notNull(),
    objectType: text("object_type").notNull(),
    value: text("value"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("custom_field_values_field_record_uidx").on(
      table.fieldId,
      table.recordId,
    ),
    index("custom_field_values_org_idx").on(table.orgId),
  ],
);

export const orgWideDefaults = sqliteTable(
  "org_wide_defaults",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    objectType: text("object_type").notNull(),
    access: text("access").notNull(),
    grantHierarchy: integer("grant_hierarchy", { mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("org_wide_defaults_org_object_uidx").on(table.orgId, table.objectType),
  ],
);

export const roles = sqliteTable(
  "roles",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    parentRoleId: text("parent_role_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    index("roles_org_idx").on(table.orgId),
    uniqueIndex("roles_org_name_uidx")
      .on(table.orgId, table.name)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const sharingRules = sqliteTable(
  "sharing_rules",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    objectType: text("object_type").notNull(),
    access: text("access").notNull(),
    shareWithRoleId: text("share_with_role_id").notNull(),
    includeSubordinates: integer("include_subordinates", { mode: "boolean" }).notNull(),
    active: integer("active", { mode: "boolean" }).notNull(),
    criteria: text("criteria").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id),
    deletedAt: integer("deleted_at"),
  },
  (table) => [index("sharing_rules_org_idx").on(table.orgId)],
);

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().default(LOCAL_ORG_ID),
    name: text("name").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    productCode: text("product_code"),
    family: text("family"),
    description: text("description"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    index("products_org_idx").on(table.orgId),
    uniqueIndex("products_org_code_live_uidx")
      .on(table.orgId, table.productCode)
      .where(sql`deleted_at is null and product_code is not null`),
  ],
);

export const priceBooks = sqliteTable(
  "price_books",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().default(LOCAL_ORG_ID),
    name: text("name").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    isStandard: integer("is_standard", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
  },
  (table) => [
    index("price_books_org_idx").on(table.orgId),
    uniqueIndex("price_books_one_standard_uidx")
      .on(table.orgId)
      .where(sql`is_standard = 1`),
  ],
);

export const priceBookEntries = sqliteTable(
  "price_book_entries",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().default(LOCAL_ORG_ID),
    priceBookId: text("price_book_id")
      .notNull()
      .references(() => priceBooks.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    unitPriceCents: integer("unit_price_cents").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("price_book_entries_book_product_uidx").on(
      table.priceBookId,
      table.productId,
    ),
    index("price_book_entries_org_idx").on(table.orgId),
    index("price_book_entries_product_idx").on(table.productId),
  ],
);

export const opportunityLineItems = sqliteTable(
  "opportunity_line_items",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => opportunities.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
  },
  (table) => [
    index("opportunity_line_items_org_opp_idx").on(table.orgId, table.opportunityId),
  ],
);

export const dashboards = sqliteTable(
  "dashboards",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (table) => [index("dashboards_org_idx").on(table.orgId)],
);

export const dashboardComponents = sqliteTable(
  "dashboard_components",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    dashboardId: text("dashboard_id")
      .notNull()
      .references(() => dashboards.id),
    reportId: text("report_id")
      .notNull()
      .references(() => reports.id),
    title: text("title").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    index("dashboard_components_org_dash_idx").on(table.orgId, table.dashboardId),
  ],
);
