# Why your agents never got the value out of TMH

**Asked 2026-10-17.** The framing was wrong in my earlier evaluations: I compared *memory* engines when
you are building **work agents**. They need **knowledge** — SOPs, specs, ISO procedures, purchasing
rules — and you already have more of that than any of the four candidates would give you.

## The measurement that reframes the question

I queried the TMH knowledge hub directly (`/data/knowledge/knowledge.db` in `tdai-memory-hub`):

| | |
|---|---|
| Live wikis | **46** |
| Total pages | **4,201** |
| Status `ready` | 45 of 46 |
| **Wikis bound to an agent (`agent_id`)** | **0** |

The mass is real and it is the right kind:

| Wiki | Pages |
|---|---|
| Agent Roster | 879 |
| **Zervi Odoo V19** | 374 |
| **ISO 9001 QMS** | 260 |
| Marketing | 230 |
| Agents Knowledge for Zervi AI Copilot | 152 |
| Engineering | 149 |
| Communication & Handoffs | 128 |
| **Purchasing & Supply** | 120 |
| Stack Dictionary | 112 |
| Projects & Repos | 105 |
| Quality | 99 |

An ISO 9001 QMS with 260 pages is not a toy. Odoo V19 at 374 pages is the manual a work agent needs.

## So why did the agents never use it?

**Because there is no path from an agent to that knowledge.** Three separate barriers, and they compound:

### 1. Search is scoped to ONE wiki, and requires you to already know which

```json
{ "knowledge_id": "wiki-sd2roawj", "tool_name": "search", "params": { "query": "..." } }
```

`knowledge_id` is **mandatory**. There is no cross-wiki search. So an agent holding a question —
*"what is our customer-return procedure?"* — must first answer **"is that in ISO 9001 QMS, or Quality,
or Purchasing & Supply, or Communication & Handoffs?"** It cannot. It has no basis on which to guess.

### 2. There is no discovery surface

I probed for one and found none: `/v3/knowledge`, `/v3/wikis`, `/v3/knowledge/list` → **404**.
`get_info` describes *one* wiki when you already have its id. Nothing tells an agent **what the 46
wikis are**. So the first step of every retrieval is missing.

### 3. Nothing is bound

`agent_id` is **NULL on all 46**. So even an agent that knew the right wiki id had no configured
relationship to it. The wiring is manual and, on this deployment, unset.

**Put together: 4,201 pages that no agent can reach.** That is not a failure of the agents' intelligence.
It is a missing front door. It is also, precisely, "TMH is complicated and my agents were never good
enough to maximise it" — you were describing a missing index, not a weak model.

## What this means for the memory question

It **changes the answer**, and I should say so plainly — my previous four evaluations were answering a
narrower question than you are asking.

| Need | Right tool | Why |
|---|---|---|
| *"What is our procedure for X?"* | **TMH wikis (already built)** | 4,201 curated pages, human-written, ISO-grade. No memory engine invents this. |
| *"What did we decide last month, and why?"* | **Memori** (or Cognee) | facts, traces, decisions — a different object from a document |
| *"Why did this number come out?"* | **Semantica** | provenance |
| *"What did this person prefer?"* | Rakazo's own memory, or the semantic provider plug-point | small, personal, changes often |

**None of the four candidates is a knowledge base.** Cognee and OpenViking *build* graphs from documents
you feed them; they do not come with an ISO 9001 QMS. You already have the knowledge. What is missing is
**the front door and the binding**.

## The concrete fix, in order of leverage

1. **A cross-wiki search.** One endpoint that searches all 46 and returns `{wiki, page, score}`. This is
   the single highest-value change and it is a fan-out over an index that already exists — BM25 is
   already running per wiki. Without it, everything downstream is guesswork.

2. **A manifest.** One call an agent can make at the start of a session: *"here are 46 wikis, their
   names, page counts and one-line summaries."* `knowledge_wiki` **already stores `name`, `page_count`
   and `summary`** — this is a SELECT, not a build.

3. **Bind at the role, not the agent.** `agent_id` on the wiki row is the wrong axis for a factory with
   staff turnover. Bind *departments* to wikis — Production sees ISO 9001, Quality and Engineering;
   Purchasing sees Purchasing & Supply and Odoo V19 — and let an agent inherit from its department.

4. **Then the memory layer** — Memori, for "what happened and what was decided", sitting *beside* the
   knowledge rather than replacing it.

## What I did not do

No writes, no rebinding, no schema change. Steps 1–3 touch the TMH hub, which serves LobeHub and the DSH
fleet — not just Rakazo — so they need your sign-off and a check of who else depends on the current
shape. I have only read.

## The one-line version

**Your knowledge was never the problem — 4,201 pages says so. Your agents could not get to it: no
cross-wiki search, no list of what exists, and nothing bound. Fix the front door before buying another
engine.**
