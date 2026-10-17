# Shared department assistants — design

**Status: designed, not built.** Nothing in this document is implemented yet. It records the decision
so the work can be reviewed before it touches an isolation boundary.

## The problem

Zervi's model is a **department**: several colleagues working with the *same* Ops assistant. Today that
is impossible. Measured on the live deployment:

```
Bot.userId                   → every assistant is owned by one person
listBots()      where { spaceId, userId: actor.userId }
listSpaceBotsForSpaces()     → same filter
threads, runs   → scoped the same way
```

So "share an assistant" is not a setting nobody exposed; it is the shape of the data. Round 56 recorded
it as the largest remaining gap after reachability.

## The three designs, and what each actually costs

| # | Design | Assistant | Threads | Verdict |
|---|---|---|---|---|
| A | **Space-wide** — every member sees every assistant | shared | **shared** (one conversation) | Rejected. `Thread.botId` is `@unique`, so everyone would read and write one transcript. A colleague's pay query appears in the Managing Director's sidebar. |
| B | **Opt-in per assistant** — `visibility: private \| space` | shared | **shared** (one conversation) | Rejected for the same reason; the visibility flag does not fix the transcript. |
| C | **Opt-in, per-member threads** — assistant is shared, each member gets their own conversation | shared | **per member** | **Chosen.** |

**C is the only one that matches how a department actually works:** one Ops assistant, one set of
instructions and tools, and *"my conversation with it"* per person.

## What C requires

1. **`Bot.visibility`** — `"private"` (default, today's behaviour) or `"space"`.
2. **`Thread.botId` loses `@unique`**; gains `@@unique([botId, userId])`. This is the real change:
   one thread *per member per shared assistant*.
3. **Read paths** — `listBots` and `listSpaceBotsForSpaces` become:
   ```ts
   where: { spaceId: actor.spaceId, archivedAt: null,
            OR: [{ userId: actor.userId }, { visibility: "space" }] }
   ```
   The `OR` is what preserves the guarantee that a private assistant stays invisible. **Every** one of
   the five `userId`-filtered bot queries needs the same treatment, and the ones that must stay
   owner-only (rename, delete, change computer, move department) must **not** get it.
4. **Thread resolution** — `getOrCreateThread(botId, userId)`: for a shared assistant, find the thread
   for *this* member, create it if absent. Nobody opens someone else's conversation.

## The decisions this forces (needing Archie, not me)

These are not implementation details — they are policy, and getting them wrong is a data-leak.

1. **Whose credential pays when a colleague runs a shared assistant?**
   Measured: everything resolves off `run.userId` — model key, plugins, secrets. So by default a
   colleague's run uses **their** credential, not the owner's. That is probably right (the cost follows
   the work), but it means a colleague with *no* credential cannot use the shared assistant. Zervi needs
   shared department credentials, or the deployer's key as fallback.

2. **Whose memory does a shared assistant have?**
   `Bot.memoryScope` is `isolated | shared`, keyed to the bot. With per-member threads, an "Ops
   assistant that remembers our processes" and "my private conversation with it" pull in opposite
   directions. Options: memory follows the assistant (shared, correct for process knowledge, but
   colleagues can read each other's remembered facts) or memory follows the thread (private, but the
   assistant forgets shared context). **This is the sharpest question and it is not mine to answer.**

3. **Who may create, rename, or delete a shared assistant?** Presumably the owner only — but an
   assistant owned by someone who leaves Zervi then becomes unmanageable.

4. **Who may see the run history and spend of a shared assistant?** Colleagues contribute tokens; the
   owner probably wants the usage view.

## Why this is not being shipped blind

The `userId` filter in `listBots` **is** the tenant-isolation guarantee verified in round 33. A mistake
here does not produce a bug report — it produces one employee's assistant appearing in another's
sidebar. So the work is gated on decisions 1–4, and the acceptance test is explicit:

> Create two members in one space. Share one assistant. Sign in as B: B sees the shared assistant and
> gets **their own empty conversation**. B does **not** see A's private assistant. A's transcript is
> unchanged after B's run.

Both halves matter. A change that shows the shared assistant but also leaks the private one is worse
than no change.
