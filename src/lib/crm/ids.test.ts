import { describe, expect, it } from "vitest";
import { hasPrefix, ID_PREFIX, newId } from "./ids";

describe("newId", () => {
  it("starts with the object prefix and is unique", () => {
    const a = newId(ID_PREFIX.account);
    const b = newId(ID_PREFIX.account);
    expect(hasPrefix(a, ID_PREFIX.account)).toBe(true);
    expect(hasPrefix(b, ID_PREFIX.account)).toBe(true);
    expect(a).not.toBe(b);
    expect(a.startsWith("001")).toBe(true);
    expect(newId(ID_PREFIX.contact).startsWith("003")).toBe(true);
    expect(newId(ID_PREFIX.lead).startsWith("00Q")).toBe(true);
    expect(newId(ID_PREFIX.opportunity).startsWith("006")).toBe(true);
    expect(newId(ID_PREFIX.opportunityContactRole).startsWith("00K")).toBe(true);
    expect(newId(ID_PREFIX.task).startsWith("00T")).toBe(true);
    expect(newId(ID_PREFIX.listView).startsWith("00B")).toBe(true);
    expect(newId(ID_PREFIX.customField).startsWith("00N")).toBe(true);
    expect(newId(ID_PREFIX.customFieldValue).startsWith("cfv")).toBe(true);
    expect(newId(ID_PREFIX.validationRule).startsWith("03d")).toBe(true);
    expect(newId(ID_PREFIX.assignmentRule).startsWith("01Q")).toBe(true);
    expect(newId(ID_PREFIX.automationRule).startsWith("01W")).toBe(true);
    expect(newId(ID_PREFIX.duplicateRule).startsWith("0Bm")).toBe(true);
  });
});
