# OpenWorker — the closest thing to the compromise, measured

**Asked 2026-10-17.** Archie called it "the perfect candidate compromise: ready to customize." This one
is genuinely different from the previous seven, and it deserves a precise answer about where it fits and
where it does not.

| | **OpenWorker** |
|---|---|
| Licence | **MIT** |
| Files | **948** — the smallest of the serious candidates |
| Python / TS / TSX | 457 / 178 / 140 |
| Status | **open beta**, actively updated |
| Author | Andrew Ng |
| Surfaces | **headless server + browser UI + Tauri desktop** |

## Why this one is different

**It has the deployment shape we need, which none of the desktop apps had.**

```bash
# 1. start the agent server (no GUI required)
.venv/bin/python -m coworker.server.run --cwd ~/some/project --port 8765

# 2. start the UI (a separate browser app)
cd surfaces/gui && npm run dev
```

The Python server is the engine; the UI is a **separate surface**. Tauri is just one way to open it. That
means this can sit behind Zervi's reverse proxy as a browser tool — not an Electron install per worker.

**948 files against Rakazo's 926 source files / 207,000 lines.** This is a codebase one person can hold
in their head, which is what "ready to customize" actually requires.

## The governance model is the best in this whole survey

> "A ladder of earned autonomy. Actions are approval-gated by default. One-off approvals can graduate
> into standing rules, then into config allowlists — each step explicit, visible, and revocable. In
> auto-approve mode a reviewer model lets routine actions through and escalates anything it isn't sure
> about; repeated denials trip a circuit breaker that pauses the reviewer and hands control back."

That maps **directly** onto the Zervi problem: an agent reading Odoo must respect the user's rights, and
an in-house tool needs an audit trail. Rakazo has `approvalRules` and `autoReview`, but nothing this
explicit about *earned* autonomy and revocation. For a factory where a bot might post a stock move, this
is the right design.

Also: **sandboxed execution** (NVIDIA OpenShell), **MCP client** (the Odoo path), **connectors**, and
**automations** — the vocabulary fits.

## Where it does not fit — two measured gaps

### 1. Memory is recall-by-scope, not retrieval

The whole memory layer is `coworker/memory/` — five small files, one SQLite table:

```sql
CREATE TABLE memories (id, scope, key, content, summary, workspace, session_id, created_at)
```

The methods are `add`, `get`, `list`, `update`, `delete`, `delete_all`. There is **no search, no FTS, no
embeddings, no vectors**. The agent's tools are `remember`, `memory_read(memory_ids)`, `memory_update`,
`memory_forget` — it must **already know the id** of the memory it wants.

So OpenWorker's memory is a **notebook the agent maintains**, not a knowledge base. That is a legitimate
design, and for "remember that Archie prefers email" it is fine. It cannot answer *"what is our
customer-return procedure?"* over 4,201 pages.

**The good news is where that leaves us:** `memory/base.py` says *"Backends are adapters
(`SQLiteMemoryStore` now, `PostgresMemoryStore` later)."* The seam is explicit and anticipated. Swapping
in TMH-backed retrieval is a **new adapter**, not a fork.

### 2. No Thai, and no multilingual embedder to fix

There is not a single mention of Thai or multilingual in the repository. Because there is no embedding
model at all, the usual failure cannot happen — but neither can Thai semantic search. Retrieval is
something we would add.

### 3. It is single-operator

The README describes one person's machine, a local secret store, and a launch token. There is **no
multi-user, no accounts, no roles**. For a factory floor that is a change of shape, not a setting.

## The honest comparison, now that we have eight

| | Server behind a proxy | Own knowledge base | Governance / audit | Customizable by one person | Thai |
|---|---|---|---|---|---|
| **OpenWorker** | **yes** | no (notebook) | **best in survey** | **yes — 948 files** | no |
| Rakazo | yes | no | good (`approvalRules`) | no — 207k lines, 404 upstream commits/month | no |
| LobeHub | yes | **yes (89 KBs)** | unclear | no — config, not code | ? |
| Orkas / Eigent | **no / yes** | yes / no | partial | no | no |

**OpenWorker and Rakazo are the same shape with opposite trade-offs:**
- Rakazo: production machinery you would fight to customize (207k lines, constant upstream drift), but a
  real multi-user executor that has survived a 4-hour run.
- OpenWorker: small enough to actually own and shape, with the right governance design, but no multi-user
  and no retrieval.

## What "ready to customize" would concretely mean

If this is the compromise, the work is not a rewrite — it is four adapters, and each has a seam already:

1. **`PostgresMemoryStore` + retrieval** — the base class anticipates it; add FTS + a multilingual
   embedder. This is where TMH's 4,201 pages finally get a consumer.
2. **Multi-user** — accounts, per-user connector tokens, per-user Odoo rights. The largest piece, because
   the launch-token model assumes one operator.
3. **Odoo MCP connector** — the MCP client exists; this is configuration plus a tool surface.
4. **Thai** — a multilingual embedder and UI strings. Same gate as every candidate.

Items 1, 3 and 4 are adapter-shaped and small. **Item 2 is the real cost** and it is the same cost in every
option, because no candidate except LobeHub and Rakazo has multi-user at all.

## My recommendation

**Take OpenWorker seriously as the base — but price item 2 first.** Its size and governance design are
genuinely better suited to an in-house tool you intend to shape; 948 files is a different kind of object
from 207,000, and the memory seam is documented rather than accidental.

**Before committing, answer one question:** does it need to be multi-user? If a handful of trusted staff
each get their **own desktop instance** pointed at shared Postgres and the same Odoo credentials, the
multi-user gap largely disappears and OpenWorker is the clear winner. If it must be one server with many
logins, that piece has to be built, and it is not small.

That is a deployment decision, not an engineering one, and it is yours to make.
