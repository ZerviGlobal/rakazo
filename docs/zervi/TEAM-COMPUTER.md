# Team Computer

**One Linux desktop per workspace, shared by every assistant in it.**

This is the default. When you create an assistant you choose **Team** or **Private** (`ComputerMode`
= `["team", "dedicated"]`, default `team`), and you can switch later from the assistant's panel —
`bots/setComputer({botId, mode})`.

The authoritative statement is in `docs/computer-runtime.md`, and it is worth quoting because it draws
the line precisely:

> Each workspace gets one Team Computer by default. Bots share its files and installed tools. Each Team
> bot starts in `bots/<bot-id>/`, while deliberately shared work belongs in `shared/`. **These folders
> organize work but are not security boundaries: every Team bot can access the full Team workspace.**
> A bot can instead use a Private Computer, where the whole workspace is its home.

---

## What is actually shared, and what is not

Measured on the ZBOX deployment (`rakazo-bot-team-35cb…`, a live Team computer), not inferred:

| Shared | Not shared |
|---|---|
| **OS user** — `uid=1000(rakazo)` for all of them | **Browser profile** — `.browser-profiles/chromium-bot-<id>`, one per assistant |
| **Filesystem** — `/home/rakazo`, and `bots/<bot-id>/` for each | **X display / screen** — `X1`, `X2`, `X3`, `X4`, one per active assistant |
| **Installed tools** — one `apt`/`uv`/`pip` install serves everyone | **Logins & cookies** — per profile, never cloned or merged |
| **`shared/`** — the deliberate hand-off folder | **Desktop processes** — each bot gets its own Chrome |

**One computer, five assistants, five sibling folders.** Verified on disk:

```
~/bots/cmva958yt0005…   ~/bots/cmvafdbii000r…
~/bots/cmvafi4a40000…   ~/bots/cmvafi4af0004…
~/bots/cmvafi4am0008…
~/shared/     (empty)
```

The database holds one row per **space**, not per bot: `scope=team`, `scopeKey=team:<spaceId>`,
`homeKey=team-<spaceId>`. That key is what makes it "one computer" rather than one per assistant.

---

## What the folder separation does and does not buy you

The per-bot folders are **organisation, not access control**, and I confirmed that rather than taking
the docs at their word:

```
$ stat -c "%A %U" ~/bots/*
drwxr-xr-x rakazo   ← same uid, world-readable
```

A file written into one assistant's folder is readable from the same shell as another. Same uid, `755`.
So the honest framing is: **`bots/<id>/` keeps work tidy; `shared/` is a signpost; neither stops an
assistant reaching into another's files.**

If you need a real boundary, that is what **Private** computers are for — a separate workspace where
the whole home *is* that bot's. Use one when the answer to "may these two assistants see each other's
files?" must be no.

**What is genuinely separate even on Team:** browser logins. Each assistant has its own persistent
Chrome profile, keyed to its identity, never cloned from another. So one assistant being signed into
an ERP does not sign the others in — and one bot's session being revoked does not log the others out.

---

## How to use it

**Creating:** new assistant → **Computer** → **Team** (default) or **Private**. Team reuses the
workspace's existing computer, so the first assistant pays the boot cost and the rest start fast.

**Switching:** assistant panel → Computer → toggle. Switching is a config change, not a rebuild of
the chat; the conversation and memory stay.

**Working with files:** the assistant's own space is `bots/<bot-id>/`. Anything it should hand to a
colleague goes in `shared/`. Relative paths and the shell's working directory start in its own folder.

**Watching it work:** "Show computer" / "Bot screen" opens the live desktop. Each assistant has its own
screen; several can run at once without disturbing each other.

**Taking control:** "Take control" gives you an exclusive input lease on *that* assistant's screen.
One rule bites in practice — **if that assistant is mid-run, takeover is refused with
`CONFLICT: "Stop the bot first"`**, unless the run is `waiting_takeover` (the bot has explicitly asked
for protected input, e.g. a password or a 2FA code). So: stop the bot, then take control. After you
release, the agent may continue.

**Idle behaviour:** desktops start lazily when a bot first needs graphics, and run completion releases
that bot's desktop. Closing a viewer leaves the desktop intact. Whole-computer idle shutdown stops the
processes but **preserves the workspace**, so files and profile survive.

---

## Use cases, in Zervi terms

| Situation | Mode | Why |
|---|---|---|
| **A department's assistants** — Sales, Production, Purchasing — using one set of tools and a shared price list | **Team** | One `uv pip install`, one set of documents in `shared/`, no duplication |
| **One assistant that prepares a document, another that reviews it** | **Team** | Deliberate hand-off through `shared/`; both see the finished artefact |
| **Anything holding customer PII, pricing, or credentials that must not cross a boundary** | **Private** | The container is the only real boundary |
| **An assistant you don't yet trust, or an experiment** | **Private** | Contain blast radius cheaply |
| **Two assistants browsing two logged-in systems at once** | **Team** | Separate Chrome profiles and displays — must not share a desktop slot |
| **Heavy document/PDF work** | **Team** | Install the Thai font and tooling once, use everywhere |

**Where Team shines for Zervi specifically:** the toolchain. Thai fonts, `pandoc`, Python renderers —
installed once in the one home, available to every assistant. That is the difference between five
assistants each missing the Thai font and one install fixing it for all of them.

---

## The distinction that matters most

**Team shares a computer. It does not share an assistant.**

These are different axes and conflating them causes rework:

- **Computer** (this document) — the machine and files. Team or Private.
- **Assistant ownership** — `Bot` carries its own `userId`, and reads filter `spaceId AND userId`. So
  even inside a shared space with a shared computer, **each colleague still gets their own assistant**.

That is why "share one Ops assistant across the department" is not achievable today, even though
"share one computer" is the default. Team computers solve *tool and file duplication*. They do not
solve *assistant sharing* — see the gap register in `DEPLOYMENT-RUNBOOK.md`.

---

## Limits worth knowing

- **No cap by default.** `SANDBOX_TEAM_SCREEN_LIMIT` is unset on this deployment, so simultaneous
  desktops are bounded only by RAM/CPU/ports. The docs note a computer can host 100+ profiles, but
  *concurrent* desktops are what cost memory.
- **The container, not the folder, is the boundary.** CDP binds to container loopback only and is not
  published to the host.
- **Takeover needs the bot stopped** (or `waiting_takeover`) — the one operational rule people hit.
- **A shared workspace means shared history.** An assistant can read a file another one left behind.
  Assume it will.
