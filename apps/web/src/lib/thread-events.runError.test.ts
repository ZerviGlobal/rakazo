import { describe, expect, it } from "vitest";
import type { ThreadSnapshot } from "@rakazo/contracts";
import { threadRunError, threadRunErrorForDisplay } from "./thread-events";

// Measured live: a failed run stored and painted this VERBATIM in the composer alert.
const PROVIDER_BLOB =
  '401: {"message":"Authentication Fails, Your api key: ****eae5 is invalid (request_id: 8921529a-834c-404e-b216-210ea358a3f7)","type":"authentication_error"}';
const HUMAN = "Connect a model in Settings before running bots.";
const copy = { fallback: "Something went wrong. Try again.", offline: "Could not reach the server" };

function snapshot(error: string): ThreadSnapshot {
  return { run: { id: "r1", status: "failed", error } } as unknown as ThreadSnapshot;
}

describe("threadRunErrorForDisplay", () => {
  it("hides a raw provider error body behind the fallback", () => {
    const raw = threadRunError(snapshot(PROVIDER_BLOB));
    expect(raw).toBe(PROVIDER_BLOB);                       // the stored value is unchanged
    expect(threadRunErrorForDisplay(snapshot(PROVIDER_BLOB), undefined, copy)).toBe(copy.fallback);
    expect(threadRunErrorForDisplay(snapshot(PROVIDER_BLOB), undefined, copy)).not.toContain("request_id");
  });

  it("still shows a human-readable reason as-is", () => {
    // This is the message a credential-less employee legitimately needs to read.
    expect(threadRunErrorForDisplay(snapshot(HUMAN), undefined, copy)).toBe(HUMAN);
  });

  it("returns null when nothing failed", () => {
    const ok = { run: { id: "r1", status: "completed", error: null } } as unknown as ThreadSnapshot;
    expect(threadRunErrorForDisplay(ok, undefined, copy)).toBeNull();
  });
});
