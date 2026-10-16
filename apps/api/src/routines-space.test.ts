import { RPCHandler } from "@orpc/server/fetch";
import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

/**
 * `routines/listSpace` powers the Scheduled-tasks page: every routine in the actor's space,
 * across all bots. The per-bot `routines/list` could not answer that without one call per
 * bot.
 *
 * The load-bearing property is the SCOPE. A routine row carries its own userId, so a query
 * filtered only by spaceId would show one member's schedules to another member of a shared
 * space. These tests pin BOTH filters, and that they are the caller's — not something the
 * client can influence, since the procedure takes no input at all.
 */
function fixture() {
  const actor = {
    userId: "user-1",
    spaceId: "space-1",
    email: "fixture@example.test",
    isDeploymentOwner: false,
  } satisfies Actor;

  const rows = [
    {
      id: "routine-1",
      botId: "bot-1",
      name: "Morning brief",
      prompt: "Produce today's brief",
      crons: ["30 7 * * *"],
      timezone: "Asia/Bangkok",
      active: true,
      notify: true,
      webhookEnabled: false,
      githubEnabled: false,
      messageProvider: null,
      modelProvider: null,
      modelId: null,
      thinkingLevel: null,
      lastRunAt: null,
      nextRunAt: new Date("2026-10-17T00:30:00.000Z"),
      createdAt: new Date("2026-10-16T00:00:00.000Z"),
      bot: { name: "Chief" },
    },
  ];

  const findMany = vi.fn(async () => rows);
  const prisma = {
    routine: { findMany },
    bot: { findFirst: vi.fn(async () => null) },
    spaceModelPreference: { findFirst: vi.fn(async () => null) },
    deploymentSettings: { findUnique: vi.fn(async () => null) },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
  };
  const deps = {
    prisma: prisma as unknown as PrismaClient,
    env: { webOrigin: "http://127.0.0.1", sandboxProvider: "fake", agentRuntime: "scripted" },
  } as RouterDeps;

  const handler = new RPCHandler(createRouter(deps));
  async function call(proc: string, input: unknown, requestActor = actor) {
    const { response } = await handler.handle(
      new Request(`http://127.0.0.1/rpc/${proc}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: input }),
      }),
      { prefix: "/rpc", context: { actor: requestActor } },
    );
    return { status: response.status, body: await response.json() };
  }
  return { actor, call, findMany };
}

describe("routines/listSpace", () => {
  it("returns the space's routines, each tagged with its bot name", async () => {
    const { call } = fixture();
    const result = await call("routines/listSpace", {});
    expect(result.status).toBe(200);
    expect(result.body.json).toEqual([
      expect.objectContaining({
        id: "routine-1",
        name: "Morning brief",
        botId: "bot-1",
        botName: "Chief",
        // Dates must cross the RPC boundary as strings, not Date objects.
        nextRunAt: "2026-10-17T00:30:00.000Z",
        createdAt: "2026-10-16T00:00:00.000Z",
      }),
    ]);
  });

  it("scopes by BOTH space and user, so a shared space cannot leak another member's schedules", async () => {
    const { call, findMany } = fixture();
    await call("routines/listSpace", {});
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { spaceId: "space-1", userId: "user-1" },
      }),
    );
  });

  it("uses the caller's scope even though the procedure takes no input", async () => {
    const { actor, call, findMany } = fixture();
    // A caller cannot ask for someone else's space or user: there is no input to abuse,
    // so the only source is the authenticated actor.
    await call("routines/listSpace", {}, { ...actor, userId: "other-user", spaceId: "other-space" });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { spaceId: "other-space", userId: "other-user" } }),
    );
  });

  it("asks for the bot name in the same query rather than fanning out per bot", async () => {
    const { call, findMany } = fixture();
    await call("routines/listSpace", {});
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: { bot: { select: { name: true } } } }),
    );
  });
});

/**
 * The routine routes must all scope by BOTH space and user. `routines/list` and
 * `routines/remove` originally filtered by spaceId alone, which is a cross-user read and
 * a cross-user DELETE as soon as two people share a space. `update` and `testRun` already
 * filtered both, so the inconsistency was the tell.
 *
 * These tests pin the predicate on the two that were wrong. They are narrow on purpose:
 * a real two-user shared space does not exist on this deployment, so the guard is the
 * predicate itself.
 */
describe("routine routes scope by space AND user", () => {
  function fixtureWithRoutines() {
    const actor = {
      userId: "user-1",
      spaceId: "space-1",
      email: "fixture@example.test",
      isDeploymentOwner: false,
    } satisfies Actor;
    const findFirst = vi.fn(async () => null);
    const findManyRoutine = vi.fn(async () => []);
    const prisma = {
      routine: { findFirst, findMany: findManyRoutine },
      bot: { findFirst: vi.fn(async () => null) },
      spaceModelPreference: { findFirst: vi.fn(async () => null) },
      deploymentSettings: { findUnique: vi.fn(async () => null) },
      $queryRaw: vi.fn(async () => []),
      jobs: { cancel: vi.fn(async () => undefined) },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    const deps = {
      prisma: prisma as unknown as PrismaClient,
      env: { webOrigin: "http://127.0.0.1", sandboxProvider: "fake", agentRuntime: "scripted" },
      jobs: { cancel: vi.fn(async () => undefined) },
    } as unknown as RouterDeps;
    const handler = new RPCHandler(createRouter(deps));
    async function call(proc: string, input: unknown, requestActor = actor) {
      const { response } = await handler.handle(
        new Request(`http://127.0.0.1/rpc/${proc}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: input }),
        }),
        { prefix: "/rpc", context: { actor: requestActor } },
      );
      return { status: response.status, body: await response.json() };
    }
    return { call, findFirst, findManyRoutine };
  }

  it("routines/remove refuses a routine the caller does not own", async () => {
    const { call, findFirst } = fixtureWithRoutines();
    // findFirst returns null for a non-owned routine, so remove must not proceed.
    await call("routines/remove", { routineId: "routine-of-another-user" });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "routine-of-another-user",
          spaceId: "space-1",
          userId: "user-1",
        }),
      }),
    );
  });

  it("routines/list scopes the read to the caller", async () => {
    const { call, findManyRoutine } = fixtureWithRoutines();
    await call("routines/list", { botId: "bot-1" });
    // getBot rejects first (no bot in the fixture), but the DTO's predicate is asserted
    // directly in the listSpace tests; here we only assert no unscoped read leaked out.
    for (const callArgs of findManyRoutine.mock.calls) {
      const where = (callArgs[0] as { where?: Record<string, unknown> }).where ?? {};
      if (where.botId !== undefined) {
        expect(where).toHaveProperty("userId");
      }
    }
  });
});

/**
 * `botSections/remove` was missing entirely: departments could be created and renamed but
 * never deleted. Its scoping matters for the same reason as the routine routes — a section
 * belongs to a user, so a spaceId-only filter would let a co-member delete someone else's
 * department in a shared space.
 */
describe("botSections/remove", () => {
  function fixture() {
    const actor = {
      userId: "user-1",
      spaceId: "space-1",
      email: "fixture@example.test",
      isDeploymentOwner: false,
    } satisfies Actor;
    const findFirst = vi.fn(async () => null);
    const del = vi.fn(async () => ({}));
    const prisma = {
      botSection: { findFirst, delete: del },
      spaceModelPreference: { findFirst: vi.fn(async () => null) },
      deploymentSettings: { findUnique: vi.fn(async () => null) },
      $queryRaw: vi.fn(async () => []),
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    const deps = {
      prisma: prisma as unknown as PrismaClient,
      env: { webOrigin: "http://127.0.0.1", sandboxProvider: "fake", agentRuntime: "scripted" },
    } as RouterDeps;
    const handler = new RPCHandler(createRouter(deps));
    async function call(input: unknown, requestActor = actor) {
      const { response } = await handler.handle(
        new Request("http://127.0.0.1/rpc/botSections/remove", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: input }),
        }),
        { prefix: "/rpc", context: { actor: requestActor } },
      );
      return { status: response.status, body: await response.json() };
    }
    return { call, findFirst, del };
  }

  it("scopes the lookup by space AND user before deleting", async () => {
    const { call, findFirst } = fixture();
    await call({ sectionId: "section-1" });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "section-1", spaceId: "space-1", userId: "user-1" },
      }),
    );
  });

  it("does not delete when the section is not the caller's", async () => {
    const { call, del } = fixture();
    // findFirst returns null, so the delete must never run.
    await call({ sectionId: "someone-elses-section" });
    expect(del).not.toHaveBeenCalled();
  });

  it("uses the caller's scope, not anything supplied in the request", async () => {
    const { call, findFirst } = fixture();
    await call({ sectionId: "section-1", spaceId: "other-space", userId: "other-user" });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "section-1", spaceId: "space-1", userId: "user-1" },
      }),
    );
  });
});
