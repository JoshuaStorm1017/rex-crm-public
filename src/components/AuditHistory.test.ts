import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuditHistory } from "./AuditHistory";

describe("AuditHistory timestamps", () => {
  it("shows UTC wall clock with an explicit UTC zone label", () => {
    // 09:28 America/Detroit (EDT, UTC-4) on 2026-10-16 == 13:28 UTC
    const at = Date.UTC(2026, 9, 16, 13, 28, 0);
    const html = renderToStaticMarkup(
      AuditHistory({
        entries: [
          {
            id: "0aeZONE",
            action: "update",
            actorName: "Local Operator",
            at,
            changes: [{ field: "name", label: "Name", before: "A", after: "B" }],
          },
        ],
      }),
    );
    expect(html).toContain("2026-10-16 13:28:00 UTC");
    expect(html).toMatch(/13:28:00 UTC/);
    // Must not show a bare ISO-like stamp without the zone label.
    expect(html).not.toMatch(/>2026-10-16 13:28</);
  });
});
