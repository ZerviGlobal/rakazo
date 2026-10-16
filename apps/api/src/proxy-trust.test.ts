import { describe, expect, it } from "vitest";
import { isInAnyCidr } from "./app.js";

// This decides whether a connection really came from a declared proxy hop. If it is wrong in the
// permissive direction, a direct caller can spoof `x-forwarded-for` and mint a fresh rate-limit
// bucket per sign-in attempt (measured before the guard: three distinct buckets from one caller).
describe("isInAnyCidr", () => {
  const nets = ["10.0.5.0/24"];

  it("matches inside the declared network", () => {
    expect(isInAnyCidr("10.0.5.4", nets)).toBe(true);   // the web container
    expect(isInAnyCidr("10.0.5.0", nets)).toBe(true);   // network address
    expect(isInAnyCidr("10.0.5.255", nets)).toBe(true); // broadcast
  });

  it("rejects anything outside it — including a near miss", () => {
    expect(isInAnyCidr("10.0.6.4", nets)).toBe(false);   // adjacent network
    expect(isInAnyCidr("10.0.4.255", nets)).toBe(false); // just below
    expect(isInAnyCidr("127.0.0.1", nets)).toBe(false);  // loopback is NOT a declared proxy
    expect(isInAnyCidr("198.51.100.5", nets)).toBe(false);
  });

  it("handles a bare address, a /32 and a wide net", () => {
    expect(isInAnyCidr("10.0.5.4", ["10.0.5.4"])).toBe(true);
    expect(isInAnyCidr("10.0.5.5", ["10.0.5.4"])).toBe(false);
    expect(isInAnyCidr("10.0.5.4", ["10.0.5.4/32"])).toBe(true);
    expect(isInAnyCidr("8.8.8.8", ["0.0.0.0/0"])).toBe(true);
  });

  it("is not fooled by junk or a different address family", () => {
    expect(isInAnyCidr("::ffff:10.0.5.4", nets)).toBe(false); // caller must normalise first
    expect(isInAnyCidr("not-an-ip", nets)).toBe(false);
    expect(isInAnyCidr("10.0.5.4", ["nonsense"])).toBe(false);
    expect(isInAnyCidr("10.0.5.4", ["10.0.5.0/99"])).toBe(false);
    expect(isInAnyCidr("10.0.5.4", [])).toBe(false);
  });
});
