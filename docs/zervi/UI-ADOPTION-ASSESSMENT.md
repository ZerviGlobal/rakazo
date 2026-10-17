# Rakazo UI — adoption assessment and redesign scope

**Prepared by:** Zak · ZBOX · 2026-10-16
**Purpose:** Archie's priority is now the UI — *"if the UI is not user friendly, the staff will not adopt it."*
This document measures the current interface against that test. **Nothing has been changed.**
**Method:** rendered the live app and looked at it (screenshots in `/home/ubuntu/rakazo/renders/`),
counted the visible controls, and read the source for what a user must do to reach each capability.

---

## 1. What I actually saw

Rendered the live app at desktop (1600px) and phone (390px) viewports, signed in as a real user.
Screenshots: `ui-main.png`, `ui-mobile.png`, `artifacts-page.png`, `artifacts-preview.png`.

**It is a competent, modern interface.** Dark theme, clean typography, chat-first layout, a working
bot list, markdown tables rendering properly, a composer with attachments and voice. It does not look
cheap. **The problem is not visual quality — it is discoverability.**

## 2. The measured problem

| Measurement | Value | Why it matters |
|---|---|---|
| Controls **in the left sidebar** at rest | **7** — Activity, Minimize, **+**, space actions, one bot row, **Integrations**, avatar | The sidebar is nearly empty. Every feature lives elsewhere. |
| Navigation landmarks | 2 | Only bot list + menu |
| Visible controls on screen total | 40 | Most are message actions (React/Reply/More), not navigation |
| Icon-only controls lacking a label | **0** | Genuine strength — accessibility care is present |

### The discoverability defect, quantified

Your own experience is the evidence: **you asked me twice "does this app have artifacts?"** — and it
does, fully working. You could not find it because:

| Capability | Where it actually lives | Clicks to reach |
|---|---|---|
| **Artifacts** | avatar menu → Artifacts | **2**, and it is not visible at rest |
| **Board** (only if enabled) | avatar menu → Board | 2 |
| **Settings** | avatar menu → Settings | 2 |
| **Usage** | avatar menu → Usage | 2 |
| **Routines** (scheduled work) | inside a bot's context, not the sidebar | 2–3, and not obvious |
| **Log out** | avatar menu | 2 |

**A staff member cannot see that Artifacts, Board, Routines or Usage exist.** They are behind an
avatar. That is the adoption risk — not the styling.

## 3. The four adoption-blocking gaps

### G1 — No visible map of what the system can do (HIGHEST)
The sidebar shows *bots*, and one menu. Nothing tells a new user "here is where your documents are,
here is your scheduled work, here is the board." **First-run:** there is an onboarding route
(`/onboarding`, `OnboardingPage`) — good — but after onboarding, the interface does not carry a
persistent map.

### G2 — No team layer (HIGH, and it is architectural)
There is no way to see colleagues' work. I verified earlier: **Rakazo has no multi-user sharing at
all** — no invite, no team view, no "who else is here." For hiring staff, each person is an island.
The only shared concept is a **"Team Computer"** — a shared sandbox, not a shared workspace.
**This is not a UI fix; it is the product gap that matters most for staff adoption.**

### G3 — Departments do not exist (HIGH, and you already want them)
No `Department` model. The nearest structures are spaces (hard boundaries), chat groups (bots sharing
a thread) and boards/tickets. Staff cannot be organised by function — which is how people find things.

### G4 — Jargon and framing (MEDIUM)
"Artifacts", "Bots", "Spaces", "Routines", "Direct MCP" are developer words. A finance officer looking
for a report does not search for "Artifacts".

## 4. What is genuinely good (do not rebuild these)

- **Chat-first layout** — the thing staff will do most is immediately in front of them.
- **Mobile support is real** — swipe-to-open sidebar, responsive layout, a PWA manifest. I rendered
  the phone viewport and the app is usable.
- **Accessibility discipline** — zero unlabelled icon buttons; `aria-label` and `data-testid`
  throughout. Better than most internal tools.
- **Markdown/tables render well** — your Scribe bot's action register looked genuinely readable.
- **Computer screen panel** — the right-hand live desktop view is a differentiator staff will like.

## 5. Recommended scope — three waves

**Wave A — navigation and naming (visible change, low risk, no data model work)**
1. Promote **Artifacts** and **Board** out of the avatar menu into the sidebar.
2. Add a **"Work"** section: Artifacts, Board, Routines, Usage — always visible.
3. Rename user-facing jargon: *Artifacts → Documents*, *Bots → Assistants*, *Routines → Scheduled
   tasks*. (Keep the internal names untouched; this is display-only.)
4. Sidebar shows a **count badge** for unread work and scheduled tasks.

**Wave B — departments (the feature you asked for)**
5. A `Department` concept: group assistants under a department (Finance, Sales, Ops), with the
   department as the landing view instead of a flat bot list.
6. Department-level memory and document scoping.

**Wave C — team visibility (depends on the sharing gap)**
7. Either implement multi-user visibility, or accept per-person islands and design accordingly.
   **This needs a decision before design** — see §7.

## 6. How each wave is verified

Rendered screenshots at desktop **and** phone width for every changed screen, compared before/after;
a click-count measurement for each of the four "find it" journeys above (Artifacts, Board, Routines,
Usage) showing the count dropping; and a **staff-eye test** — someone who has never used it is asked
to find a document and a scheduled task, and we count how long it takes. **A UI change I have not
rendered and looked at is not a change** — that rule applied to this assessment too.

## 7. The decision I need before designing

**Is Rakazo for Archie alone, or for staff?**

| Answer | What it means |
|---|---|
| **Personal** | Wave A only. Fast, cheap, immediately better. Team layer unnecessary. |
| **Staff (a few people)** | Wave A + B, and we must solve *each person is an island* — no sharing exists today. |
| **Staff (departments)** | All three waves. Biggest job; the team layer is architectural, not cosmetic. |

**My recommendation:** do **Wave A now** regardless of the answer — it is cheap, reversible, and fixes
the defect you personally hit. Decide B and C when you know who the users are.

## 8. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Upstream looks nothing like our fork after our changes | Keep changes in clearly separated files; upstream is moving ~415 commits/30d, so re-apply cost is real |
| 2 | "Friendly naming" diverges from upstream docs, confusing future readers | Display-only mapping in one file; internal names untouched |
| 3 | We rebuild instead of configure | Everything in Wave A is additive to existing routes — no rewrite |
| 4 | We do UI work before the team-layer decision, then rework it | Wave A is safe under all three answers |

## 9. What I could not verify

- **How staff will actually behave** — no staff user exists; every judgement about "friendly" is
  mine, not observed. **The staff-eye test in §6 is the honest way to settle this.**
- Whether the mobile app (Expo) matches the web experience — I read source, did not run it.
- Whether any upstream branch already redesigns navigation (I did not survey upstream PRs).
- Load behaviour with many assistants — only 5 exist today.
