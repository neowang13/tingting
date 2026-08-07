import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("SQL behavior test isolation", () => {
  it("rolls back its synthetic Auth, rental, and media fixtures", async () => {
    const sql = await readFile(path.resolve("tests/sql/migration-behavior.sql"), "utf8");
    const statements = sql
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("\\"));

    expect(statements[0].toLowerCase()).toBe("begin;");
    expect(statements.at(-1)?.toLowerCase()).toBe("rollback;");
    expect(sql).toContain("seasons-1703-migration-test");
    expect(sql).toContain("https://example.test/rentals/rental-v2.jpg");
  });
});
