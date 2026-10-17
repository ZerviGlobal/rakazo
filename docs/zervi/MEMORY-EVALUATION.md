# Is OpenViking a better memory for Rakazo than TMH?

**Asked 2026-10-17.** Short answer: **it is not either/or, and neither is the right first move.**
Rakazo has two separate memory layers, one of which is empty by construction and one of which is
already pluggable. Understanding that distinction decides the question.

## What Rakazo's memory actually is — measured, not read off a README

There are **two** memory mechanisms in this deployment, and conflating them causes the whole confusion:

### Layer 1 — the built-in Markdown store (`packages/memory`, 159 lines)

- Storage: `memory_documents` + `memory_revisions`, Markdown files, scoped `user | bot`.
- **Retrieval is a substring match.** Literally:

```ts
const q = request.query.toLowerCase();
return documents
  .filter((doc) => doc.content.toLowerCase().includes(q) || doc.path.toLowerCase().includes(q))
  .map((doc) => ({ path: doc.path, snippet: snippet(doc.content, q), score: 1 }));
```

`score: 1` for every hit. **No embeddings, no ranking, no semantic recall.**

- **Live data**: 12 documents, 4 revisions, **222 bytes total**. Ten of the twelve are **0 bytes**.

So the honest statement is: **Rakazo's own memory is close to unused, and its retrieval is a `grep`.**
What little is in there is genuinely useful —

> `Archie's timezone is Asia/Bangkok (UTC+7). Morning brief runs daily 07:30…`
> `PREFERENCE: the team contact standard is email, never phone.`

— but 222 bytes across 8 assistants is not a memory system in use.

### Layer 2 — the semantic provider plug-point (already built)

This is the part that changes the answer. Rakazo **already defines** a semantic memory contract:

```ts
export interface SemanticMemoryProvider {
  describe(); recall(); save(); purgeHistory(); forget?();
}
```

and ships **two working implementations**: `supermemory-memory-provider.ts` (317 lines) and
`serenity-memory-provider.ts` (328 lines). There is a UI for it — *"Manage the Space semantic memory
provider"* — and a `memory/providerConfig` RPC that returns **`null`** on this deployment.

**So "upgrade Rakazo's memory" is not a rewrite. It is choosing a provider.** The whole integration
surface is four methods, and ~320 lines is the precedent.

## The three candidates

| | **Rakazo built-in** | **TMH / tdai** | **OpenViking** |
|---|---|---|---|
| What it is | Markdown docs + substring search | multi-tier memory hub already running on this host | "context database": `viking://` virtual FS |
| Retrieval | **substring `includes()`**, score always 1 | hybrid dense vector + BM25 | semantic, **directory-scoped** |
| Structure | flat docs, `user`/`bot` scope | L0/L1/L2/L3 tiers, scenes, personas | L0 abstract / L1 overview / L2 detail **per directory** |
| Inspectable | yes — Markdown in Postgres | partly (tiers via API) | **yes, and it is the headline feature** |
| Runs as | in-process | 4 containers already running (`tdai-proxy`, `tdai-memory-hub`, `tdai-memory-core`, bridge) | its own server on `:1933` + SDK |
| Language / size | TS, 159 lines | existing stack | **2,084 Python files, 74 deps** |
| Licence | repo licence | existing | **AGPLv3** |
| Embedding model needed | no | already configured | **yes — a VLM + embedding model** |
| State today | 222 bytes, unused | live, serving LobeHub | not installed |

## Where OpenViking is genuinely better

Not marketing — these are the things Rakazo's 159-line store cannot do at any size:

1. **Directory-scoped retrieval.** Search a subtree, not a flat pool. `viking://user/{id}/memories/`
   versus everything. Rakazo's store has no hierarchy beyond `path`, and its search ignores it.
2. **L0/L1/L2 summaries.** The agent reads a one-sentence abstract before opening a file. Rakazo's
   `grep` returns whole documents or nothing.
3. **Skills and resources live beside memories**, each with a `viking://` URI. That maps onto what
   Zervi actually wants: SOPs, patterns, and seat-cover knowledge next to "Archie prefers email".
4. **Sessions committed as inspectable Markdown** — conversation becomes a file you can read and edit.
   Rakazo's memory is written by the agent, opaquely, into a row.
5. **A benchmark** (LoCoMo, tau2-bench) rather than a claim. Rakazo has no memory benchmark at all.

## Where it is worse, or simply wrong for this

1. **AGPLv3.** For a self-hosted internal tool that is fine. If Rakazo is ever distributed to another
   factory, AGPL is a real constraint — and this repo is a *public fork* of an upstream project.
2. **A second memory system, not a replacement.** TMH already runs here and already serves LobeHub. Adding
   OpenViking gives Zervi **three** memory layers. That is how the "two LobeHub databases" happened.
3. **Operational weight.** Its own server, a VLM + embedding model, a vector index, 74 Python deps,
   against a deployment that currently has no vector column in its schema at all.
4. **It requires embedding infrastructure Rakazo does not have.** Verified: `schema.prisma` has **zero**
   vector or embedding columns, and the live database has only `plpgsql` installed — **pgvector is not
   available at all**. So either OpenViking holds everything and Rakazo stores nothing, or we add an
   extension and touch the Prisma schema.
5. **No Thai-specific story.** Rakazo's users are Thai; Thai tokenisation and retrieval are poor in most
   embedding stacks. Neither OpenViking nor TMH documents Thai handling.

## Cognee — a genuinely different option (asked 2026-10-17)

`topoteretes/cognee`. **The most interesting of the three**, because it changes two things that
disqualified OpenViking.

| | **Cognee** | OpenViking |
|---|---|---|
| Licence | **Apache 2.0** | AGPLv3 |
| Shape | **knowledge graph** extraction + retrieval | virtual filesystem of context |
| Python files | 2,960 | 2,084 |
| Test files | **1,169** | (not counted) |
| External services needed | **none by default** — embedded Kuzu/Ladybug graph + LanceDB vectors | own server + VLM + embedding model |
| Can it run without an LLM? | **yes** — local GLiNER extraction + local embeddings, downloads on first use | needs a VLM |
| Integration | Python lib, REST `:8000`, **MCP `:8001`** | SDK + server `:1933` |
| Paper | yes (arXiv 2505.24478) | benchmark blog |

**Why that matters here:** Apache 2.0 removes the licence problem entirely, and "no external services
by default" removes the operational weight. It is the only one of the three that could plausibly run
*inside* the existing Rakazo compose without a new database, a new vector index, or a second embedding
model — Kuzu and LanceDB are embedded, meaning files on disk next to the app.

### The catch, and it is specific to Zervi

**No multilingual or Thai support is mentioned anywhere in the repository.** The default embedding
model is `openai/text-embedding-3-large`; the local fastembed path falls back to MiniLM-family models;
the LLM-free extraction model is **GLiNER**, which is an English-first span extractor.

A **knowledge graph built by GLiNER over Thai text** is the specific risk. Thai has no word spaces, and
entity extraction is exactly the task where that bites. So Cognee's headline advantage — a real graph
structure linking *decision → discussion → implementation* — is precisely the capability most likely to
underperform on the Chonburi content.

That is not a reason to reject it. It is a reason to **test it on Thai before trusting it**, which is
the same test the other two have to pass.

### Where Cognee would actually fit Rakazo

If it works on Thai, the mapping is good:

- `cognee.remember(...)` on a committed session → durable "what we decided" memory
- The graph linking **decision → ticket → commit** is what a factory's SOPs actually are
- MCP on `:8001` means Rakazo's existing MCP tool surface could call it without new adapter code
- Its own `SemanticMemoryProvider` adapter (4 methods) remains the clean route if MCP is not wanted

## The recommendation, in order

**Do not choose between OpenViking and TMH. Do these in sequence — each is smaller than the last:**

1. **Use the plug-point that already exists.** Rakazo ships two semantic providers and has **none
   configured** (`providerConfig: null`). Before adding a third system, prove the second layer works:
   point it at TMH, or at serenity, and measure whether recall improves on the 222 bytes we have.
   *This costs configuration, not code.*

2. **Fix the retrieval floor regardless.** Even with a semantic provider, the Markdown store's
   `includes()` search stays the fallback. **`pg_trgm` is already available** on this Postgres (verified
   in `pg_available_extensions`), so a trigram or FTS index is an extension plus an index — not a new
   system, and it would make the fallback honest instead of a substring scan that always scores 1.

3. **Then pilot, behind the existing provider interface** — and **Cognee first, not OpenViking**.
   Apache 2.0, no external services by default, embedded graph and vectors, and an MCP surface. It is
   the cheapest of the three to try and the easiest to remove. OpenViking remains the one to consider if
   directory-scoped context turns out to matter more than relationships — but at AGPLv3 and with a VLM
   requirement, it should not be the first experiment.

**The reason not to start at step 3:** we have 222 bytes of memory. Neither OpenViking nor TMH can be
shown to be better on evidence that thin. The honest first question is *"why is Rakazo's memory empty?"*
— and the answer is visible in the numbers: 10 of 12 documents are 0 bytes, because the agent rarely
chooses to write.

## What would settle it

A single measurable comparison on **Zervi's** content, not LoCoMo:

1. Seed all three with the same 9 Zervi knowledge bases (SOPs, Quality, HR, Finance, Commercial,
   Products, Agency Directory, Engineering, Odoo v17 Archive) — currently stranded in the dead LobeHub
   database and worth salvaging anyway.
2. Ask 20 real questions a Chonburi factory would ask, in **Thai**.
3. Score recall, latency, and tokens for: Rakazo built-in, TMH, OpenViking.

Until that runs, "better" is an inference from architecture, not a result. I would rather say so than
recommend a 2,084-file AGPL platform on the strength of its own benchmark.
