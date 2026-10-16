import { describe, expect, it } from "vitest";
import {
  accountSecuritySchema,
  authCapabilitiesSchema,
  legacyAuthCapabilitiesSchema,
} from "./auth.js";

it("requires explicit password and SSO capabilities", () => {
  expect(authCapabilitiesSchema.safeParse({ passwordReset: false, resetUrl: null }).success).toBe(
    false,
  );
  expect(
    authCapabilitiesSchema.parse({
      passwordAuth: false,
      passwordReset: false,
      resetUrl: null,
      sso: { name: "SSO", availability: "checking" },
    }).passwordAuth,
  ).toBe(false);
});

it("only accepts complete legacy capabilities without partial SSO fields", () => {
  expect(
    legacyAuthCapabilitiesSchema.parse({ passwordReset: false, resetUrl: null, billing: true }),
  ).toEqual({ passwordAuth: true, sso: null, passwordReset: false, resetUrl: null, billing: true });
  for (const value of [
    {},
    { passwordReset: false },
    { passwordReset: false, resetUrl: null, passwordAuth: false },
    { passwordReset: false, resetUrl: null, sso: null },
    { passwordReset: "false", resetUrl: null },
  ]) {
    expect(legacyAuthCapabilitiesSchema.safeParse(value).success).toBe(false);
  }
});

it("accepts older account security and explicit password-change policy", () => {
  const security = {
    hasPassword: true,
    freshOidcAuth: false,
    ssoLinked: false,
    emailDeletion: true,
    sso: null,
  };
  expect(accountSecuritySchema.parse(security).passwordChangeEnabled).not.toBe(false);
  expect(
    accountSecuritySchema.parse({ ...security, passwordChangeEnabled: false })
      .passwordChangeEnabled,
  ).toBe(false);
  expect(
    accountSecuritySchema.safeParse({ ...security, passwordChangeEnabled: "false" }).success,
  ).toBe(false);
});

// `signupsEnabled` was added so the landing page can stop offering a "Sign up" button that
// cannot succeed when registration is closed. It is OPTIONAL for the same reason `billing`
// is: an older server that omits it must still parse, and clients treat omission as enabled.
describe("authCapabilitiesSchema signupsEnabled", () => {
  it("accepts a server that omits it (older deployments)", () => {
    const parsed = authCapabilitiesSchema.parse({
      sso: null,
      passwordAuth: true,
      passwordReset: false,
      resetUrl: null,
    });
    expect(parsed.signupsEnabled).toBeUndefined();
  });

  it("carries the value when the server reports it", () => {
    const closed = authCapabilitiesSchema.parse({
      sso: null,
      passwordAuth: true,
      passwordReset: false,
      resetUrl: null,
      signupsEnabled: false,
    });
    expect(closed.signupsEnabled).toBe(false);
  });
});
