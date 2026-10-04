import { describe, expect, it } from "vitest";
import { resolveAlias } from "../../src/server/services/aliasResolver";

describe("spoken doctor titles", () => {
  it.each(["الدكتورة سارة القحطاني", "دكتورة سارة القحطاني", "د. سارة القحطاني", "سارة القحطاني"])("resolves %s without changing the name", (query) => {
    expect(resolveAlias(query, [{ id: "sara", aliases: ["سارة القحطاني"], value: "sara" }])).toEqual({ status: "matched", value: "sara" });
  });
  it("does not turn a different surname into a match", () => {
    expect(resolveAlias("الدكتورة سارة العتيبي", [{ id: "sara", aliases: ["سارة القحطاني"], value: "sara" }])).toEqual({ status: "not_found" });
  });
});
