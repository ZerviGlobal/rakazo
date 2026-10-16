import { describe, expect, it } from "vitest";
import { splitOrigins } from "./app.js";

// Exposing the app behind a reverse proxy on a new hostname was REJECTED (measured: 403, no ACAO
// header) because the trusted list came only from webOrigin/baseUrl plus hardcoded mobile entries.
// This makes it configuration — and must never widen trust by accident.
describe("splitOrigins", () => {
  it("parses a comma-separated list, trimming blanks", () => {
    expect(splitOrigins("https://rakazo.zervi.local, https://rakazo.zervi.com"))
      .toEqual(["https://rakazo.zervi.local", "https://rakazo.zervi.com"]);
    expect(splitOrigins(" https://a.example ,, ")).toEqual(["https://a.example"]);
  });

  it("is EMPTY when unset — it must not default to trusting anything", () => {
    expect(splitOrigins("")).toEqual([]);
    expect(splitOrigins(undefined as unknown as string)).toEqual([]);
  });
});
