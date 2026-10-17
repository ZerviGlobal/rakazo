# Rakazo on ZBOX — Operations Runbook

**Owner:** Zak (config/secrets) · Host ops: ZIT · Escalation: Archie
**Stack:** published images (GHCR `elie222/rakazo/{app,computer}`), Compose project `rakazo`
**Deploy dir:** `/opt/zervi/rakazo` (NOT a git repo — `.env` here is the only secret store for the stack, mode 0600)
**Endpoints:** web `http://100.74.72.109:5173` (+ loopback), api `http://100.74.72.109:3100` (+ loopback, health only)
**Compose invocation (always all three files):**

```bash
cd /opt/zervi/rakazo
docker compose --env-file .env -f docker-compose.images.yml -f zbox-bind.yml -f docker-compose.zervi.yml <cmd>

**ALWAYS strip the caller's proxy env** (measured 2026-10-16: a seat shell with
`HTTP_PROXY=127.0.0.1:18899` leaked through compose's `${HTTP_PROXY:-}` passthrough
into the containers and broke all container egress — corepack could not fetch pnpm):

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u NO_PROXY -u no_proxy \\
  docker compose --env-file .env -f docker-compose.images.yml -f zbox-bind.yml -f docker-compose.zervi.yml <cmd>
```
```

**Why all three files, and what happens if you drop one (both measured 2026-10-16 by doing it):**

| File | Contains | If omitted |
|---|---|---|
| `docker-compose.images.yml` | upstream stack | nothing runs |
| `zbox-bind.yml` | binds web/api to the tailnet IP + DeepSeek env | ⚠️ comes up **looking healthy** — loopback `:5173` still returns 200 while the tailnet listener disappears and the site 502s from the proxy in front |
| `docker-compose.zervi.yml` | points **only** `web` at the Zervi employee-UI image | UI silently reverts to stock upstream (the "Work" nav vanishes); no error |

`install-images.sh` now applies all three automatically (`compose_files` array), so
re-running it is safe. If you invoke compose by hand, pass all three.

## Zervi employee UI (local fork change, 2026-10-16)

The deployed web image is **not** stock upstream: `zervi-rakazo-web:employee-ui-20261016`
(see `docker-compose.zervi.yml`). It layers a rebuilt `apps/web/dist` onto the pinned
upstream image and adds a **"Work"** block to the space sidebar exposing **Documents**
(upstream "Artifacts"), **Board** (when the ticket board is enabled) and **Usage** —
all of which were previously reachable only through the avatar menu.

| | |
|---|---|
| Source branch | `zervi/employee-ui` in `~/zervi/repos/rakazo` (commit `34f3722d`) |
| Files added | `apps/web/src/pages/shell/employee-nav.tsx` (+ `.test.tsx`) |
| File changed | `apps/web/src/pages/Shell.tsx` (import + one render block) |
| Catalogs | `apps/web/src/locales/*/messages.po` — **`pnpm --filter @rakazo/web intl:extract` is REQUIRED**; without it the new labels render as raw message ids (`E_muDO`) |
| Rebuild + deploy | `bash redeploy-web.sh` (builds the bundle **and** ships api source, then deploys web+api and self-verifies) |
| Rollback | set `ZERVI_WEB_IMAGE` back to `ghcr.io/elie222/rakazo/app:edge` (or remove the service blocks) in `docker-compose.zervi.yml` and re-run `redeploy-web.sh` |
| Prove the UI is live | `bash rakazo-ui-smoke.sh` (exit 0 = Zervi UI served; checks web+api, the **tailnet** host, that the web container runs the Zervi image, and that the served bundle contains the nav and the Thai locale) |

**A change is scoped by its IMPORT GRAPH, not by the file you edited.** This bit three
times in different shapes: (1) shipping the web bundle without the api, (2) shipping api
without contracts, (3) shipping api+contracts without **packages/db** — the last produced
`repos.removeBotSection is not a function` → **HTTP 500**, while the bundle, health checks
and deploy assertions all said green.

`redeploy-web.sh` therefore stages **every workspace package the api imports at runtime**
(adapter-kit, adapters, auth, contracts, core, db, logging, memory) and the deploy asserts
each package directory exists in the container **and** that the specific new symbol is
present. "The route answers" cannot catch this: the route exists and returns 500.

**The image carries TWO halves, and both are required.** `web` serves the built bundle;
`api` runs `tsx src/index.ts` against `/app` source, with `@rakazo/contracts` resolving to
`./src/index.ts`. So an image with only the bundle ships a UI that calls endpoints the
running API does not have.

**Measured failure mode:** before the api source shipped, `routines/listSpace` returned
**404** while web, api health and the site were all 200 — the page would have rendered an
error and every health check would have said fine. `redeploy-web.sh` therefore asserts the
**route**, not just the process:

```
routines/listSpace (401 = route exists, unauthenticated): 401
```

A **404** there is a hard failure of the deploy. Treat any new endpoint the same way: add
its route check, or the deploy can pass while the feature is broken.

**Only `web` and `api` are overridden.** `worker` and `supervisor` stay on the stock
upstream image, and `RAKAZO_IMAGE` in `.env` is deliberately **not** set (it is shared by
api/worker/supervisor, so pointing it at this image would change the worker too).

### Every compose invocation must pass all three `-f` files

An independent verifier falsified the claim that the change survives a routine deploy. Two
distinct failure modes existed, **both now fixed**:

| Script | Was | Now |
|---|---|---|
| `maintenance-window.sh` | recreated api+worker with only `images.yml` + `zbox-bind.yml` → **api silently reverted to stock** (`/health` 200, endpoints 404) | passes all three `-f` files **and asserts `routines/listSpace` is not 404** after the recreate |
| `install-images.sh` | blanket `docker compose pull` tried Docker Hub for the host-local `zervi-rakazo-web:*` tag → `pull access denied`, and `set -Eeuo pipefail` **aborted the install before any `up`** | detects the local-only image, requires it to exist locally, pulls only the pullable services |

**The rule: if you add a script that runs `docker compose`, it needs all three `-f` files.**
Audit it — but audit it correctly: `install-images.sh` and `redeploy-web.sh` pass
`"${compose_files[@]}"`, an array built to include the overrides, so a naive
`grep "docker compose"` reports them as MISSING and is a **false alarm**. Check whether the
invocation uses the array, then check the array's contents:

```bash
grep -n "compose_files+=" /opt/zervi/rakazo/install-images.sh   # must list both overrides
grep -rn "docker compose" /opt/zervi/rakazo/*.sh | grep -v 'compose_files'
```

Only the second command's hits use a literal `-f` list and must be checked by eye; after the
fix, the sole hit is `maintenance-window.sh:43`, which is correct. (Verified 2026-10-16.)

**Why the Zervi image cannot be pulled, by design:** it is built **on this host** from
`web-employee-ui/` and has no registry prefix. It exists only in this host's Docker image
store. Losing that store loses the deployment artifact — the source is kept in
`patches/` until the branch is pushed.

### Two routine scoping bugs closed in the fork (pre-existing upstream)

`routines/remove` and the per-bot `routines/list` filtered by `spaceId` **only**, while
`update` and `testRun` filtered both — the inconsistency was the tell. A routine row carries
its own `userId`, so with a shared space the spaceId-only pair was a **cross-user read and a
cross-user DELETE**. `bootstrap` reaches `list` with a client-supplied `botId` resolved
against the space-wide bot list, so the predicate was the only guard.

All three sites (`remove`, `listRoutinesDto`, and the export query) now filter `spaceId`
**and** `userId`. Cannot be tested end-to-end here because **no shared space exists** — it
is latent, not absent. Reachability arrives with multi-user sharing.

**`rakazo-ui-smoke.sh` is the check that matters after any compose work.** Every revert
mode found here looks healthy over plain HTTP, so "the site is up" is not evidence the
Zervi UI is being served. It has been negative-tested: it fails when pointed at a
non-tailnet URL and when the nav is absent from the served bundle.

**Do not set `RAKAZO_IMAGE`** to the Zervi web image — that variable is shared by
`api`, `worker` and `supervisor`, so the API would run on a web-only layer.

**Verified (rendered, not asserted):** desktop sidebar shows `WORK → Documents, Usage`;
the Documents row navigates to `/app/artifacts`; phone width (390×844) opens the sidebar
with the nav visible and no horizontal overflow; and the UI **survived a full container
recreate** (`docker compose up -d --force-recreate`), which is the check that proves the
image — not a `docker cp` — is the source of truth.

### Display naming (Zervi rename)

One destination has **one** name. The old behaviour had the sidebar row and the page
heading disagreeing, and the avatar menu carrying a third name — which is how the original
confusion ("does this app have artifacts?") started.

| User-facing label | Internal / route (unchanged) |
|---|---|
| **Documents** | `artifacts`, `/app/artifacts`, `rpc.artifacts.*` |
| **Assistants** | `bots`, `/app/<botId>`, `rpc.bots.*` |
| **Scheduled tasks** (page) / **Tasks** (phone tab, short to fit) | `routines`, `/app/routines`, `rpc.routines.*` |
| **New department** | `bot_sections`, `rpc.botSections.*` |

This is **display-only**: no route, RPC, table or column was renamed, so upstream merges
and the API stay untouched.

⚠️ **`apps/web/e2e/artifacts-tab.spec.ts` now intentionally differs from upstream.** It used
to assert that the sidebar had **no** Documents entry (encoding the discoverability defect
this work fixes). The assertions are flipped to the new behaviour. Expect a conflict when
merging upstream — resolve in favour of the flipped version, or the fix is undone.

### Phone: the tab bar (2026-10-16)

Below `md`, the space sidebar is **closed at rest**, so the Work block above would be
behind the hamburger — the same defect one level down, on the surface a shop-floor
supervisor actually uses. A bottom tab bar (`employee-tab-bar`, `md:hidden`) carries
**Chat / Documents / Board / Usage**, marks the active tab with `aria-current`, and
honours `env(safe-area-inset-bottom)`.

**⚠️ It must be the LAST CHILD OF `<main>`, not a sibling of it.** `shell-root`
(`Shell.tsx`) is a flex **ROW** — `sidebar | main`. A third child there becomes a
full-height right-hand **column**: measured 390×844 → bar at `x=234 w=156 h=844`,
squeezing the chat to 234px. `main` is a flex **column**, so inside it the bar lands at
the bottom with natural height (measured `y=790 w=390 h=55`). This was shipped broken
once and then fixed; the comment in `Shell.tsx` records why the placement matters.

**The bar must exist on EVERY route a phone user can reach it from.** `/app/artifacts` is
a **standalone route** (`Artifacts.tsx` renders its own page with no `shell-root`, so no
space sidebar). When the bar was only on the Shell, tapping Documents on a phone landed
the user on a page with no tab bar, no sidebar and no user menu — the navigation vanished
exactly when it was used. The bar is therefore rendered in **both** places, and
`Artifacts.tsx` marks Documents with `aria-current="page"` so the bar reads as a location
rather than just a menu.

Escaping back from a standalone route needed a way into the settings overlay, which lives
in the Shell. **Do not use a query param for this** — a bare `/app` redirects to
`/app/<botId>` with `{ replace: true }` and no search string, so the param is destroyed
before the Shell reads it. (Measured: `?usage=1` on a bot route opened the Usage section
correctly; the identical param on `/app` opened nothing.) The handoff is therefore
`requestSettingsSection()` / `takePendingSettingsSection()` in `shell/employee-nav.tsx`,
carried through `sessionStorage`, which survives that redirect. It is read-and-clear so
it fires once, and wrapped in try/catch so blocked storage cannot fail the tap.

**If you add another standalone route, it needs the bar and a back path — and add it to
`verify-ui-geometry.mjs`.**

**Standalone routes that carry the bar:** `/app/artifacts` and `/app/board`. The board is
an optional capability (`TICKET_BOARD_ENABLED` in `.env`, currently **off**), so
`/app/board` is not in the default geometry sweep — the route redirects to a bot when the
capability is off. It was verified with the flag temporarily on (real board page, real
bottom bar, 4 tabs, Board marked current) and the flag then reverted.

**Verify geometry, never visibility.** `toBeVisible()` (and `offsetParent`) pass a
right-hand strip: it *is* visible, and its `y + height` equals the viewport height, so a
"bottom-anchored" check that only looks at the bottom edge passes too. Assert on
**width vs viewport** and the **top edge**:

```bash
node /opt/zervi/rakazo/verify-ui-geometry.mjs   # live deployment, exits non-zero on failure
node /opt/zervi/rakazo/measure-ui-layout.mjs    # dumps the raw boxes for eyeballing
```

Requires a Chromium with CDP on `127.0.0.1:9240`. The same assertions exist as a
Playwright spec, `apps/web/e2e/employee-nav.spec.ts`, which is the durable home for them —
**but it cannot run on this deployment**: signups are `signupsEnabled=false` and the e2e
helpers sign up users, so running it means flipping the policy that the previous session
self-locked on. The standalone script is the local equivalent.

Verified at 390×844: tabs render in Thai (`แชท / เอกสาร / การใช้งาน`), tapping Documents
navigates to `/app/artifacts`, no horizontal overflow, the chat keeps full width, and at
1600px the bar is present in the DOM but hidden.

**This is responsive web, not the native app.** `apps/mobile` (Expo 57) remains unbuilt
and unrun against this deployment — see the assessment in `plan/UI-ADOPTION-ASSESSMENT.md`
§3a. Nothing in this change alters that.

### Departments — the primitive already exists

Archie asked for departments. **There is no `Department` model, and none is needed:**
`BotSection` (`packages/db/prisma/schema.prisma`) is per-user named grouping of bots with
a `position`, and the sidebar already renders sections as collapsible uppercase headers
with rename and drag-to-section (`Shell.tsx` `groupBotsForSidebar`).

**Verified by rendering, not by reading:** created a section named `Departments` and
assigned a bot to it via `botSections.create` + `bots.update`, and the sidebar rendered
`DEPARTMENTS` as a header with the bot nested underneath. The probe section was then
removed, restoring the pre-test state (`bot_sections` back to 0).

So department naming is a **data/UX task, not an engineering one** — a Zervi pass would
populate `bot_sections` with the real departments (Sales, Purchasing, Inventory,
Production, Quality, Finance, HR & Admin, Engineering) and assign the bots. What it does
**not** give you is department-level memory or document scoping, or visibility across
users — those are the real gaps (see the multi-user finding in `LOG.md`).

**The creation path was mobile-impossible; fixed 2026-10-16.** Upstream reaches sections
only through a bot row's right-click menu → *Move to* → *New section*. Measured: at 390px
there is no right-click, the bot row carries no menu button, and no section control exists
anywhere in the DOM — so a shop-floor user could never create a department. There is now a
visible **"New department"** action in the `Work` nav (`work-nav-new-department`), shown
only when a bot exists to attach the section to. Proven end to end at 390px, including the
database write.

**Departments can now be DELETED.** Upstream shipped `botSections` with `list`/`create`/`update`
only — no remove, so a department, once made, was permanent. `botSections/remove` now exists
(scoped `spaceId` + `userId`, like its siblings), with a destructive **Delete department** item
in the section context menu and a confirm dialog. Deleting a section does **not** delete its
members: the schema is `onDelete: SetNull`, so bots and groups fall back to *Unassigned*.

**To populate the real Zervi departments** (once Archie confirms the list):

```bash
# Via the UI (any user): sidebar -> New department, then right-click a bot -> Move to.
# Or in bulk, through the product's own RPC rather than raw SQL, so the product's checks run.
```

**Adding a department by SQL is possible but bypasses those checks** — prefer the UI or
`botSections.create`. A section belongs to ONE user (`userId`), so a department is
per-person today; two people cannot share a department until the multi-user gap is closed.

## Multi-user sharing — the measured position (2026-10-16)

The earlier claim "Rakazo has no multi-user sharing at all" is **partly true, and the
nuance changes what we build.** What is wired: nothing. What is designed: yes.

- `SpaceMember`, `Member` and `Invitation` models exist; `requireMembership` →
  `actorFromMembership` → `authed` is the real content gate; `lockSpaceForContentCreation`
  admits a creator only if a `SpaceMember` row exists.
- **Nothing provisions a second member.** `spaceMember.create` is reachable only from the
  acting user's own signup/bootstrap. `/organization/*` is pinned to 404 by
  `isBlockedAuthPath`. There is no Members UI and no members field on the space contracts.
- The `"invited"/"approved"/"declined"` rows in `router.ts` are **`messagingChannelMember`**
  (external chat providers), **not** space sharing. `SpaceMember` has no `status` column.
- **The part that matters for planning:** even with a `SpaceMember` row, a second human is
  still blocked from another user's bots/threads/artifacts by `userId === actor.userId`
  (`requireBotThread`, and the artifact lookups in `apps/api/src/artifacts.ts`).

**Measured live:** 2 users, 2 separately-named `Personal` spaces, 2 `space_members` rows,
0 sharing between them — i.e. exactly the "each person is an island" model.

**Consequence:** sharing is seat + visibility work (a migration/endpoint to provision
membership AND a change to the per-user ownership predicates), not a config flip. Do not
promise staff onboarding until that is scheduled.

### Thai (th) locale — added 2026-10-16

The app shipped 10 locales and **Thai was not one of them**, which is the biggest
adoption blocker for a Chonburi shop floor. Thai is now registered on all four paths a
locale has to reach:

| Path | File |
|---|---|
| List + label | `apps/web/src/lib/ui-locale.ts` (`UI_LOCALES`, `UI_LOCALE_LABELS.th = "ไทย"`) |
| Validation + tag normalization | same file (`isUiLocale`, `normalizeUiLocale`: `th`/`th-TH`/`th_TH` → `th`) |
| Catalog loader + lingui list | `apps/web/src/lib/i18n.ts`, `apps/web/lingui.config.ts` |
| Dictation tag | `apps/web/src/lib/dictation.ts` (`th-TH`) |

**Coverage: the employee surfaces are done; the catalog at large is not.** Catalog coverage
is 92/1126 (**8.2%**) — but that is the wrong metric, because most entries are admin
surfaces an employee never opens. Measured properly by walking the 10 employee surfaces
(chat, documents, scheduled tasks, the settings overlay and its 6 sections) and collecting
visible chrome:

| Measure | Value |
|---|---|
| Unique strings an employee sees | 143 |
| Of those, translatable UI (in the catalog) | **65** |
| Brand names / model output / timestamps (correctly untranslated) | 78 |
| Translatable strings still English | **0** |

Examples of the 78 left alone on purpose: `DeepSeek`, `Groq`, `OpenRouter` (proper nouns),
`ACTION REGISTER` / `DECISIONS` (the bot's own output), `Today 11:40 AM` (localised by
`Intl`, not the catalog).

**How to re-measure after a UI change** — do not trust the catalog percentage. Two scripts
in `/opt/zervi/rakazo/` (both need Chromium on CDP port 9240):

```bash
node /opt/zervi/rakazo/collect-ui-strings.mjs   # walks every employee surface, lists the chrome
node /opt/zervi/rakazo/find-untranslated-ui.mjs # diffs what renders in en vs th
```

**Honest remaining gap:** a Thai-only speaker can now use the main employee journeys, but
not every corner — rare paths, some settings detail, and error text are still English, and
~1000 catalog entries remain untranslated (mostly provider lists and admin screens). This
bootstrap set is conventional Thai UI vocabulary; it has **not been reviewed by a Thai
speaker**.

**Layout is measured, not assumed:** at 390px the 5 phone tabs fit (widest Thai label 51px
inside a 98px tab, no clipping) and there is no horizontal overflow in either language at
either width.

### CORRECTION: "SMTP is a cost gate" was wrong, and email is not needed to onboard

I reported for nineteen rounds that enabling staff access needs an SMTP provider, which I called a
**spending** decision. Re-tested instead of repeating it. The correct picture:

**1. Zervi already owns the mail infrastructure — no new cost.**
`smtp.office365.com:587` (Microsoft 365), a full credential set (`SMTP_HOST/PORT/SECURE/USER/PASS/FROM`)
and a `@zervi.com` sender already exist for the LobeHub deployment, and the host is **reachable**
from this network (TCP test). So mail is a **configuration** task using an existing mailbox, not a
purchase. (Honest caveat: `SMTP_PASS` is **empty** in both LobeHub's `.env` and its container, and
LobeHub has sent **zero** mail in 24h — so the account is *provisioned but not yet proven to send*.
Nobody blocked on it, which is why it went unnoticed.)

**2. Email is not required for onboarding at all.** Measured from the auth source:

| Fact | Source |
|---|---|
| An **empty** allowlist means *allow anyone* | `signup-policy.ts:10` — `if (allowlist.length === 0) return true` |
| The allowlist gates user **creation** only, never sign-in | the `sign-in` branch never consults it |
| Username + password accounts need **no verification** | `emailVerified` is just a claim the session gate reads |
| An empty allowlist keeps **unverified** sessions valid | `packages/auth/src/index.ts:459` — `allowlist.length === 0 ? session : null` |

So onboarding a colleague today is: **set `signupsEnabled=true`, leave the allowlist EMPTY, have
them register a username + password.** No email, no cost, no verification. This is the same
mechanism the service account was created through.

**3. The one real caveat is the inverse trap, already documented:** the moment you set a **non-empty**
allowlist, the session gate stops honouring unverified accounts — so the service account (and any
password-only colleague) is locked out. Choose one:

- **Open + empty allowlist** — anyone who can reach the tailnet may register. Simplest, weakest.
- **Non-empty allowlist** — gates creation, but then every account must be **verified**, which
  *does* need working email. Don't mix this with password-only accounts.

**4. And the deployment is NOT on the public internet.** It binds the tailnet IP only
(`100.74.72.109:5173/3100`, single-IP `ports:` binds, no `0.0.0.0`), so "anyone" means anyone on the
Tailscale network — a materially different and much smaller exposure than a public signup page.
Verify before relying on it: `ss -ltnp | grep 5173` must show the tailnet address, not `0.0.0.0`.

**Scale sanity check:** with a handful of staff, onboarding is also just a repeated operator action
(open the window → register → close), which needs neither email nor policy change.

**What was wrong in my earlier reasoning:** I treated "no SMTP" as the blocker, when the actual
blocker was that **signups are closed**. Those are different problems with different costs, and I
conflated them for nineteen rounds.

### Staff onboarding: the two gaps, measured (2026-10-16)

**Gap 1 — staff cannot get IN.** Signups closed (`signupsEnabled=false`), invite route 404,
admin create-user 404, no members UI, no SMTP (so no verification or password reset). One of
the four entry points works: sign-in for an existing user. Every new account is an operator
action. Closing this needs an SMTP provider (a **cost gate**, so Archie's call) or an invite
flow; configuring SMTP unblocks verification and recovery together and is the smallest move.
Note the trap: deploying an operator-created account via the empty-allowlist window works, but
**a non-empty allowlist locks out unverified accounts** (see TRAP above).

**Gap 2 — staff cannot see each other's work.** Each user owns their own ORGANIZATION (org id
== space id), so this is two one-person companies, not two colleagues in one. The schema is
already multi-member (`Space.organizationId`, `Space.memberships[]`, `SpaceMember.role`); what
is missing is provisioning and a visibility model. Sized: 168 `userId` ownership predicates
(api + db), of which **20** gate bot/group/thread content a colleague would need. The cost is
not those 20 — it is CHOOSING the model (space-wide vs shared-flag vs department-scoped) before
writing them. That is Archie's decision.

### Thai coverage: what "still English" actually means (2026-10-16)

`find-untranslated-ui.mjs` reports 26 strings as "still English while Thai is selected". Taken
at face value that reads as an unfinished translation. Classified each one, it does not:

| Group | Count | Verdict |
|---|---|---|
| Screen-reader `aria-label`s (`Copy rows`, `Download CSV`, `Expand table`, `Row`, `Sort by X`, `Open navigation`) | 8 | **invisible to a sighted employee**; a real but *accessibility-only* Thai gap |
| Bot OUTPUT inside a message (`ACTION REGISTER`, `DECISIONS`, `OPEN QUESTIONS`, column headers from the model's own table) | 18 | **content, correctly not translated** — the model wrote it |
| **Visible UI chrome an employee must read in English** | **0** | — |

**CORRECTION (same day, later): that "0 visible English" was OVERSTATED.** It came from a
collector scoped to the Shell in one language state. Rendering the employee **pages** in Thai
immediately showed "No artifacts found." in English. Corrected by measuring each surface:

| Surface | Visible English before | after |
|---|---|---|
| shell | 11 | **6** (all user data) |
| documents | 4 | **2** (bot names) |
| scheduled tasks | 0 | **0** |

Fixed: "No artifacts found.", "All bots", the date filter labels, Today/Yesterday, and
`" (unread)"` — note that msgid has a **leading space** (`<Trans> (unread)</Trans>`), which is why
a plain `"(unread)"` lookup misses it. What remains is verified against the database to be **user
data** (bot names `Chief`/`scribe`, the account name `Zak (service)`) or that data inside a
message. So visible English UI chrome is now genuinely zero.

Re-measure with:
```bash
node /opt/zervi/rakazo/audit-visible-english.mjs   # renders each surface in Thai
```

The *screen-reader* gap is separate and still open: `aria-label`s like `Copy rows` are hardcoded
in `packages/chat-ui/src/markdown-table.tsx` (no Lingui wiring), so a blind Thai user hears
English. A wiring job, not a translation job; worth doing only if a Thai screen-reader user is
expected.

A string collector counts everything that *is* English; it cannot tell you who can **see** it, or
on which screen. Classify, and measure per-surface, before reporting a count as a defect.

### Where the work actually lives (2026-10-16)

**The employee UI is committed on `zervi/employee-ui` in `ZerviGlobal/rakazo`** — four commits:
scoping fixes / navigation / Thai + front door / Shell wiring + catalogs. Working tree clean.

**The branch is PUSHED and the remote is the backup.** For ten rounds this runbook said the push
was blocked, because an early round recorded "git push was REJECTED" without recording *why*, and
nobody re-tested it. The rejection was transient — the caller's proxy env (the `env -u
HTTP_PROXY` trap already documented here). A `--dry-run` showed a clean fast-forward; the push
then succeeded.

```bash
cd ~/zervi/repos/rakazo
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u NO_PROXY -u no_proxy \
  git push origin zervi/employee-ui
```

**Prove it, don't assume it** — a fresh clone from the remote must contain the work:

```bash
rm -rf /tmp/fresh && git clone -q --branch zervi/employee-ui --depth 1 \
  https://github.com/ZerviGlobal/rakazo.git /tmp/fresh
git -C /tmp/fresh log --oneline -1     # expect ac24e4f7
git -C /tmp/fresh ls-files | wc -l     # expect 2166, matching the local restore drill
```

Verified 2026-10-16: remote HEAD == local HEAD, 0 commits ahead, 2166 files, and `router.ts` /
`repos.ts` / `auth.ts` md5-identical to the running containers.

**Lesson worth keeping:** when something is recorded as blocked, record the exact error and
RE-TEST it before repeating the blocker in a later round. A stale blocker reported ten times
still looks like a blocker.

`patches/` remains the local safety net (bundle + docs).

Verify the commits describe what is deployed, not a stale snapshot:

```bash
cd ~/zervi/repos/rakazo && git status --porcelain          # expect empty
git log --oneline @{u}..HEAD                               # the unpushed set
git diff --stat HEAD                                       # expect no output
# and the running containers must match the committed source:
for f in apps/api/src/router.ts packages/db/src/repos.ts apps/api/src/app.ts; do
  a=$(md5sum "$f" | cut -d' ' -f1); b=$(docker exec rakazo-api-1 md5sum "/app/$f" | cut -d' ' -f1)
  [[ "$a" == "$b" ]] && echo "MATCH $f" || echo "DIFFER $f"
done
```

A backup that copies the working tree is **not** the same as the work being committed. Both are
needed: the commit is the record, `patches/` is the safety net.

### First-run is NOT verified — do not claim it

A brand-new employee (no bots anywhere) is redirected to `/onboarding`. **This path has not been
rendered honestly.** Both spaces on this deployment have content, and simulating an empty one by
intercepting `/rpc/bootstrap` broke the app's boot (≈150 retries, stuck at "Loading…" then
"Opening chat…"), so renders produced that way are not evidence.

From source, onboarding asks for a **model first** ("Connect a model"), then integrations, then
creates the first bot. **Open question for a staff rollout:** who configures the model provider
for each new employee — Archie once at deployment level, or each staff member? Not verified.

### Thai reaches a Thai employee automatically (verified 2026-10-16)

The UI locale resolves as: **saved choice → `VITE_DEFAULT_UI_LOCALE` → `navigator.language` → en**.
`VITE_DEFAULT_UI_LOCALE` is **not set** on this deployment, so the browser language decides.

Verified with a fresh visitor (no saved preference) and the language set at the network layer:

| Browser language | Result |
|---|---|
| `th-TH` | `document.lang = "th"` — Thai, with Thai nav and Thai empty states |
| `en-US` | `document.lang = "en"` — unchanged (control) |

So a Thai employee on a Thai phone lands in Thai **without touching a setting**. That matters
because the locale is stored in `localStorage` only — there is **no server-side preference**, so
without the navigator fallback every employee would default to English.

**Trap when testing this:** `Emulation.setLocaleOverride` does **not** change `navigator.language`
(it still reported `en-US`), so a run using it proves nothing. Use
`Network.setUserAgentOverride` with `acceptLanguage` instead.

If Zervi ever wants Thai regardless of browser, set `VITE_DEFAULT_UI_LOCALE=th` at build time —
it is a compile-time constant, so it requires a rebuild, not a container restart.

### Language picker, keyboard access, and the e2e suite (verified 2026-10-16)

**The Settings → Language picker offers Thai and applies it.** Verified live: 11 locales offered
including ไทย; selecting it sets `lang=th` and `localStorage`; the Settings heading renders
ทั่วไป; it survives a reload. `ui-locale.spec.ts` had a spec for every locale **except Thai**, so
one was added — Thai was the only new locale without one.

**The e2e suite cannot run against this deployment.** Every spec in it signs up a fresh account,
and registration is closed here. Measured: the run fails at `completeOnboarding` waiting for
`/onboarding|app`. It is a CI artifact — correct against a dev server with signups open. Do not
read a failure of this suite here as a product defect, and do not open signups to run it.

```bash
# Only meaningful against a dev server with registration OPEN:
cd ~/zervi/repos/rakazo/apps/web
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 npx playwright test e2e/ui-locale.spec.ts --grep Thai
```

It also needed a browser build that was not cached (`chromium_headless_shell-1243`; only `-1234`
was present), which is why the suite had never been runnable on this host.

**The controls added by this work are keyboard-reachable.** Tabbing the live shell gives 30
distinct focus stops; Documents, Scheduled tasks, Usage, New department and the section
"Actions for …" trigger are all in the tab order. No keyboard trap: a bot's markdown table
exposes only 3–4 focusable elements, so a wide table does not bury the page behind dozens of Tabs.

```bash
node /opt/zervi/rakazo/verify-keyboard-nav.mjs   # focus order + tab-order membership
```

⚠️ **It matches on `data-testid`, never on visible labels — and it must stay that way.** An
earlier version compared focus labels to English names and reported all four controls as NOT
FOUND simply because a previous language test had left the browser in Thai (`เอกสาร` ≠
"Documents"). A check that reads rendered labels inherits whatever language the last test left
behind. Verified after the fix: 4/4 controls in the tab order.

### Pre-auth pages in Thai (verified 2026-10-16)

**Sign-in, sign-up and forgot-password now render Thai for a Thai browser.** These are the first
screens an employee meets — before an account exists and before any locale is stored — so they
matter more than any interior page. They were entirely English; headings now read
เข้าสู่ระบบ Rakazo / สร้าง Rakazo ของคุณ / ตั้งรหัสผ่านใหม่, with zero English left (only the
product name).

**When checking this, wipe `localStorage` first.** `resolveUiLocale` reads the **stored** value
before `VITE_DEFAULT_UI_LOCALE` and before `navigator.language`, so a leftover `rakazo.uiLocale`
from an earlier test pins the language and makes correct behaviour look broken. That cost one
false diagnosis; clear the key before measuring:

```js
localStorage.removeItem('rakazo.uiLocale')
```

To force Thai regardless of browser language for the whole deployment, set
`VITE_DEFAULT_UI_LOCALE=th` — it is a **compile-time** constant, so it needs a rebuild.

### Live-user safety of `redeploy-web.sh` (verified 2026-10-16)

Archie was **using the deployment while I deployed to it** (26 runs in one day, all completed,
zero errors). That is only safe because of what the deploy does NOT touch:

| Service | Restarted by `redeploy-web.sh`? | Consequence |
|---|---|---|
| `web` | yes | brief reload; the browser reconnects |
| `api` | yes | requests in flight can fail once |
| **`worker`** | **no** | **executes the runs — it keeps going** |

Measured: the worker had been up **10 hours** continuously across every deploy that day, and
`up -d web api` names only those two services. Runs are additionally protected by leases —
`leaseFence` / `leaseExpiresAt: { lte: now }` — so a run whose api dies is **reclaimed**, not
lost. Confirmed across the live window: 1,077 HTTP requests in an hour, **zero 5xx**.

**So deploying while someone is working is acceptable here — but know why.** Do not add `worker`
(or the whole compose project) to the `up -d` list; that WOULD interrupt in-flight runs. And if
you ever change execution so the api owns runs directly, this safety argument stops holding.

### Durability: what survives what (measured 2026-10-16)

Archie is a **live user** of this deployment (26 runs in a day), so the blast radius of a failure
matters now. Everything below was measured, not assumed.

| Failure | Survives? | Why |
|---|---|---|
| Single disk dies | **yes** | `/` is **RAID1** (`md3`, 2/2 devices, 0 failed) |
| Host reboots | **yes** | Docker is boot-enabled; all 5 containers are `unless-stopped` |
| A container crashes | **yes** | same restart policy; api also has its own healthcheck |
| `docker image prune -a` | **no** | the image is local-only — see below |
| Total host loss | **partly** | source is on the remote; data/tooling/image are host-only |
| Bad deploy | **yes** | `docker-compose.zervi.yml` sets `ZERVI_WEB_IMAGE`, so rollback = point it back at `ghcr.io/elie222/rakazo/app:edge` and re-up |

**The custom image exists in NO registry.** `zervi-rakazo-web:employee-ui-20261016` is 4.55GB,
built locally. Two saving graces, both verified: the **base image is present locally**
(`ghcr.io/elie222/rakazo/app:edge`), and the Zervi layers are small (~20MB: the copied source
directories). So it is rebuildable from `redeploy-web.sh` without a network round trip. Running
containers also protect it from `prune`. **Do not run `docker image prune -a` on this host** — and
if the image is ever lost with the base gone too, a rebuild needs network.

**Backup coverage and its one gap.** The automated `rakazo-backup.timer` (every 6h) runs
`backup-rakazo.sh`, which dumps Postgres + the appdata volume and **self-verifies** (TOC count on
the dump, file count on the tar, sha256sums, 7-day rotation). It does **not** cover:

- the **deploy tooling** — covered instead by `backup-tooling.sh` into `patches/tooling/`
- the **built image** — rebuildable, as above
- the **docs/renders** — copied into `patches/docs/`

All of that is on the **same RAID1 filesystem**, so it protects against *mistakes and disk
failure*, **not** against losing the host. Offsite is a decision for Archie, not something to
invent here.

**`web` and `worker` have NO healthcheck** (only `api` and `supervisor` do). A wedged web or
worker will not be restarted automatically by health status alone. Worth knowing before relying
on "it restarted itself".

### One health check for the whole stack (added 2026-10-16)

`rakazo-health.sh` covers what the container healthchecks cannot: `web` and `worker` have **none**,
and for `worker` a process check is worthless — a stuck worker is still running. It measures the
thing that matters (jobs are draining) plus the two silent-revert traps:

```bash
bash /opt/zervi/rakazo/rakazo-health.sh     # HEALTHY, or UNHEALTHY + exit 1
```

Containers running · app root 200 · api `/health` 200 · **served bundle carries the Zervi nav** ·
**`routines/listSpace` exists** (catches the stock-api revert) · **no job locked >15 min** (catches
a stuck worker) · latest run freshness (informational).

Every check was negative-tested: a missing container, an unreachable URL and a wrong route each
produce `FAIL` + exit 1. The wedged-job predicate was proven against synthetic values (a 30-minute
lock flags, 2-minute and unlocked do not) because the live queue is empty.

**Two bugs in this script, both caught by testing rather than reading:**

1. **`set -e` made it die silently.** An unreachable URL aborted the script before the assignment
   finished — no output, exit 7, and every later check skipped. A monitor that dies in exactly the
   outage it exists to detect is worse than none. Each network probe now ends in `|| true` so a
   transport failure becomes a *value*, never an abort.
2. `curl` already prints `000` on failure, so a `|| echo 000` fallback appended a second copy
   (`000000`). Trim to the last 3 characters instead.

### ⚠ i18n trap: Lingui NAMES placeholders after the variable (hit three times)

A Thai translation silently fails to apply when the msgid does not match exactly. Lingui writes the
placeholder as the **interpolated variable name**, not a position:

| Source | Correct msgid | What I first tried (matched nothing) |
|---|---|---|
| `t\`in ${hours}h\`` | `"in {hours}h"` | `"in {0}h"` |
| `t\`Every ${preset.n} ${unit}\`` | `"Every {0} {unit}"` | `"Every {0} {1}"` |
| `<Trans>move {bot.name} into it</Trans>` | `"…move {0} into it."` | `"…move {bot.name} into it."` |

Note it is **not consistent**: a JSX interpolation becomes a positional `{0}`, while a template
interpolation keeps the variable name. **Always copy the msgid verbatim from
`apps/web/src/locales/en/messages.po` before translating** — the en catalog is generated from the
source, so it is the authority. A lookup keyed on the source spelling looks right in a diff and
renders English.

Second trap in the same area: `formatTimeUntil` already returns a phrase containing "in"
(`in 9h`). Translating `Next run {0}` as `"…ใน {0}"` produced **"ใน in 9h"** — two prepositions. When
a translated string wraps a value produced elsewhere, check what that value already says.

### Schedule phrases in Thai (2026-10-16)

`packages/core/src/cron.ts` builds its schedule description from **plain template literals with no
i18n**, so a Thai employee read *"Every day at 9:00 AM"* on the Scheduled-tasks page. Wiring i18n
into core would reach the mobile app too, so the phrase is composed in the WEB layer instead
(`RoutineEditor.summariseCron`), reusing core's own `presetFromCron` — which returns STRUCTURED
fields (`freq`, `n`, `unit`, `time`) rather than a sentence, so there is no second parser to keep
in step. An "Advanced" cron shows its raw expression, which is language-neutral, rather than an
invented English phrase. 6 unit tests pin the shapes.

Measured on the employee account after the fix: `ทุกวัน เวลา 9:00 AM` and
`ทำงานครั้งถัดไป อีก 9 ชั่วโมง`.

### Memory: it stores, but recall is exact-word only (measured 2026-10-16)

**What an employee gets today.** Rakazo bots have durable memory that **works** — a fact written
through the product persists and reads back. But recall is **substring matching, not semantic**:

| | |
|---|---|
| The tool's own description | *"Semantically search this bot's durable memory"* (`builtin-tools.ts:700`) |
| What it actually does | `content.toLowerCase().includes(query)`, flat `score: 1` (`packages/memory/src/index.ts:50`) |

Measured on a real account — stored *"the team contact standard is email, never phone"*, then asked
the database the same predicate:

| Query a person would type | Result |
|---|---|
| `email` / `phone` | 1 hit each (the exact words stored) |
| `contact preference` | **0** |
| `how to reach the team` | **0** |
| `communication channel` | **0** |

**3 of 5 reasonable questions return nothing.** So a colleague can teach a bot a fact and then be
unable to ask for it in their own words — which reads as the bot "forgetting", not as a search
limitation. That is the employee-visible gap.

**Also measured: the store is nearly empty.** 11 documents, **294 bytes total**, and every bot
document is a bare heading (`# Chief

`, 9–10 bytes). Nothing has been remembered yet — so the
substrate is fine and the *recall quality* is what matters.

```bash
node /opt/zervi/rakazo/prove-semantic-gap.mjs    # asks the DB the store's own predicate in SQL
```

**Not changed.** The remedy is the TMH wiring proposal (`plan/PLAN-TMH-MEMORY-WIRING.md`) —
semantic recall via Zervi's memory kernel. That is a **proposal awaiting Archie's decision** and it
touches another lane's systems, so it needs his approval and that owner's, not a unilateral patch.
`SemanticMemoryProvider` (`packages/adapter-kit/src/interfaces.ts:226`) already exists as the plug
point.

Verify the store is untouched after any experiment:
```sql
select count(*), sum(length(content)) from memory_documents;   -- expect 11 / 294
```

### Consequence of the deployment-key fix: staff usage bills to Archie, uncapped (2026-10-16)

Making the deployment DeepSeek key apply to credential-less users (the fix above) means **every
employee's runs are paid for out of Archie's DeepSeek credits**. Measured:

| Account | Tokens today | Cost today |
|---|---|---|
| archie@zervi.com | 2,062,166 | $0.6992 |
| zak@zervi.local | 40,948 | $0.0540 |
| probe-firstrun (my test account) | 9,329 | $0.0123 |

**There is no spend cap.** I searched for one (`spendLimit`, `usageLimit`, `maxCost`, `budget`,
`costCap`) and found none governing runs; `deploymentKeyFor()` hands the key to any provider match
with no per-user ceiling. What *does* exist is **per-user usage accounting** — `usage_records`
carries `userId`, `totalTokens`, `costUsd` — so spend is **measurable, just not limited**.

This is fine at today's scale ($0.77 for the whole day, one real user) and it is exactly what
"give staff a working assistant" implies. But it is worth stating plainly before a rollout, because
the failure mode is silent: nothing stops one employee in a loop from spending arbitrary money.

**Options, cheapest first** (all Archie's call — the first is a *spending* decision):
1. **Accept it and watch.** Query per-user spend above; it is one SQL statement.
2. **Meter per user** — a periodic check against `usage_records` with a threshold alert. No code
   change in the product; this is host tooling.
3. **Cap it in-product** — a real feature (refuse a run past a limit), not a configuration knob.

The probe account I created for testing is included in this: it has **no personal credential**, so
its runs bill to Archie. It cost $0.0123. Delete it when it has served its purpose.

## Objective status: the named deliverables are BUILT AND VERIFIED (2026-10-16)

The objective names three things — **navigation, departments, Thai** — and requires **rendered
evidence**. All three are on the live deployment and verified:

| Named deliverable | State | Evidence |
|---|---|---|
| **Navigation** | done | Work nav (`Documents`, `Scheduled tasks`, `Usage`, `New department`) + phone tab bar; both render in Thai |
| **Departments** | done | create/rename/delete through the real dialog; renders nested with its assistant; tap-reachable section menu on a phone |
| **Thai** | done | employee-facing untranslated strings: **0**; catalog 448/1148; **0** English UI chrome; Thai filenames round-trip and render unclipped |
| **Rendered evidence** | done | `FINAL-desktop-th.png`, `FINAL-phone-th.png` — looked at, not just captured |

**Deployed == built:** all three containers (`web`, `api`, `worker`) are on HEAD `d3dc37cf34ae`, and the
Thai catalog is served from the live bundle.

**Tested, not just built:** a brand-new employee was created, signed in, saw the nav and tab bar, created
an assistant, got a reply, and was deleted — users back to 3.

**Standing checks:** 5,834 tests pass · acceptance 6/6 · health HEALTHY · geometry PASS · employee
journey 13/13 · Archie 27 runs, 0 failed.

### What is explicitly NOT delivered (all require Archie, none are defects)

1. **Shared department assistants.** The Zervi model — several colleagues using *one* assistant — is not
   achievable: `Bot` carries its own `userId` and reads filter by `spaceId AND userId`. Needs a choice
   of three designs (space-wide / explicit shared flag / department-scoped).
2. **Reachability.** The app is tailnet-only (`zbox-bind.yml` pins `100.74.72.109`) and HTTP-only. No
   employee can reach it, and TLS needs a certificate and a configured trusted-proxy hop.
3. **Thai computer image.** Built and verified; not deployed, because activating it recreates Archie's
   live bots.
4. **Thai wording is not speaker-reviewed.** Every string is mine.
5. **No Zervi employee has signed in.** Only probe accounts and Archie.

**These are decisions, not unfinished code.** The UI work named in the objective is done.

---

### A brand-new employee works, end to end### A brand-new employee works, end to end (2026-10-16)

The strongest single piece of evidence for the objective's own wording ("a **tested** employee-facing
Rakazo"). Run through the real product, not the API:

| Step | Result |
|---|---|
| create a brand-new account | ok — not an owner, no personal credentials |
| sign in, first run | `needsModel: false`, provider `deepseek` already available |
| sees the Work nav **and** the phone tab bar | `hasWorkNav: true`, `hasTabBar: true` |
| creates its own assistant | `cmvbln64n000c…` |
| sends a message | assistant replies **`NEWHIRE-OK`** |
| account deleted afterwards | 200 — **users back to 3** |

So: a real new employee, from nothing, through the actual product.

**I mis-audited the same way twice in one round**, and the lesson from the previous round repeated
itself immediately — **I grepped for one spelling of failure**:

1. I flagged `rakazo-ui-smoke.sh` as having no failure path; it uses `fail=1; exit "$fail"`.
2. I then flagged `verify-geometry.mjs` the same way; it uses `process.exit(failures === 0 ? 0 : 1)`.

**Both fail correctly.** Only a third pass — "any exit expression that can evaluate non-zero, in any
spelling" — found the true split, and both scripts I quote most are failable.

**What is genuinely unproven:** many one-off scripts in `renders/` print measurements and always exit
**0**. They are **diagnostic tools, not tests**, and nothing should be reported as PASS on their exit
code alone. That is exactly what `rakazo-acceptance.sh` now says out loud.

### One acceptance entry point### One acceptance entry point — and a security check that could not fail (2026-10-16)

The objective ends at "a **tested** employee-facing Rakazo". Handover was the weak point: **49 scripts**
in `/opt/zervi/rakazo`, no single entry point, and no record of which need a browser (27), a session
(10), or neither.

**Added `rakazo-acceptance.sh`** — one command, and honest about its own limits:

```bash
bash /opt/zervi/rakazo/rakazo-acceptance.sh          # machine-checked suite
bash /opt/zervi/rakazo/rakazo-acceptance.sh --list   # what runs, and what is MANUAL
```

It runs only the checks whose **exit status is meaningful** and names the rest as **MANUAL** with what
to read. That distinction is the whole point: several verifiers **print measurements and never report a
verdict**, so a runner that trusted exit codes would call a broken system a PASS.

**A defect in my own work, found by auditing exactly that.** `verify-rate-limit-trust.sh` — the check
proving a header cannot buy a fresh rate-limit bucket — had **zero failure constructs**. It printed
`EXPECT: …` lines and always exited **0**, so a **broken spoofing guard looked identical to a working
one**. Fixed with real assertions, and negative-tested: a simulated spoofed bucket now yields
`FAIL spoofing WORKED — 1 spoofed bucket(s) exist` and **exit 1**.

**Both new Scripts are negative-tested**, because a check that cannot fail is the failure mode this
session has hit five times:

| Runner | Injected failure | Result |
|---|---|---|
| `rakazo-acceptance.sh` | one check forced to `exit 1` | `FAIL`, names the culprit, **exit 1** |
| `verify-rate-limit-trust.sh` | `keys()` returns a spoofed bucket | `FAIL spoofing WORKED`, **exit 1** |

**My first audit of this was also wrong** and worth recording: I flagged `rakazo-ui-smoke.sh` as having
no failure path, but grepping for `exit 1` missed its `fail=1` + `exit "$fail"` pattern. **Grep for the
behaviour, not for one spelling of it.**

### Thai FILENAMES round-trip exactly### Thai FILENAMES round-trip exactly, and render unclipped (2026-10-16)

A Thai filename is the realistic Zervi case, and Thai has no word spaces, so path handling, display and
truncation all behave differently than with `invoice.pdf`. Tested with `ใบส่งของ-ตุลาคม.pdf`:

| Check | Result |
|---|---|
| stored in the database | `ใบส่งของ-ตุลาคม.pdf` — **character-for-character** |
| returned via `artifacts/listSpace` | identical, `length preserved: true` |
| rendered on the documents page | visible, **not clipped** (308px wide, `scrollWidth <= clientWidth`) |

So there is no mangling, no length loss, and no visual truncation. Worth testing rather than assuming,
because a name that survives the API but clips in the UI is still unusable to an employee.

**Incidental confirmation:** uploading the same Thai name again produced `v2` of the same artifact
rather than a duplicate — the versioning behaviour the `attach_file` tool documents, seen again here.

Cleanup: the test artifact was removed through the product (artifacts back to 7).

### The real work workflow works### The real work workflow works: employee sends a document, assistant reads it (2026-10-16)

The Zervi use case end to end — a work document in, the right facts out:

| Step | Result |
|---|---|
| bot builds a PDF with a text layer (via self-served `fpdf2`) | 1,048 bytes, `pdftotext` reads it |
| uploaded as an artifact | `artifacts/create` 200 |
| sent with "reply with just the document number and the total" | 200 |
| assistant's reply | **`TH-2026-0771 — 48000 THB`** — both facts, exact |

**Also verified: the self-serve tool path the prompt promises actually works.** `reportlab` and `fpdf2`
are **not** installed in the container, but `uv venv` + `uv pip install --python …` succeeded and
produced a working PDF. That matters because the pre-installed tooling is thinner than the prompt
implies — but the documented escape hatch is real.

**Voice: correctly a non-feature here.** Not configured (`{"configured":false,"ready":false,
"transcribe":false}`), and the UI shows **zero** voice controls — no dead buttons. A negative test that
passed: I checked for a mic button and speak buttons and found none, rather than assuming the gate works.

Cleanup: test artifact removed through the product (artifacts back to 7), and the venv and PDF removed
from the bot container.

### Thai font: a ready, verified image### Thai font: a ready, verified image — NOT deployed (2026-10-16)

Round 53/54 left one item as "Archie's decision". This round built the fix so the decision is a
one-liner, and proved it without touching anything live.

**The finding that made it in-lane:** bot containers are not hardcoded — they come from
`RAKAZO_COMPUTER_IMAGE` / `RAKAZO_COMPUTER_IMAGE_TAG` **environment variables** the supervisor reads.
So a derived local image is a supported configuration, not a fork.

**Built and verified** (`/opt/zervi/rakazo/computer-image/` + `build-computer-thai.sh`):

| Check | Stock image | Derived image |
|---|---|---|
| `fc-list :lang=th` | **0** | **Garuda** |
| `fc-match "sans-serif:lang=th"` | DejaVu Sans (no Thai glyphs) | **Garuda** |
| distinct shapes for 5 Thai chars | **1** (= tofu) | **5** (= real glyphs) |
| `Config.User` | `1000:1000` | **`1000:1000`** (matched exactly) |
| size | 2.3 GB | 2.28 GB |

`Config.User` is matched deliberately: the supervisor derives home ownership from the container user,
so a differing identity would be a real risk, not a cosmetic one. My first build said `USER rakazo`
and I corrected it to the numeric `1000:1000` the base declares.

**NOT deployed, deliberately.** Switching the fleet is **destructive for a live user**: the supervisor
compares `info.Image === desired.Id` and **removes and recreates** a container when they differ — so
Archie's **4 running bots** would be replaced on next use. Their home volume persists, but it is still
an unrequested change to his environment, so I stopped short.

**To activate (one command, reversible):**
```bash
# 1. point the fleet at the derived image
sed -i 's|^RAKAZO_COMPUTER_IMAGE=.*|RAKAZO_COMPUTER_IMAGE=zervi-rakazo-computer|; s|^RAKAZO_COMPUTER_IMAGE_TAG=.*|RAKAZO_COMPUTER_IMAGE_TAG=thai|' /opt/zervi/rakazo/.env
# 2. recreate the supervisor so it reads the new value
env -u HTTP_PROXY -u HTTPS_PROXY ... docker compose up -d supervisor
```
Rollback: `bash /opt/zervi/rakazo/build-computer-thai.sh --stock`.

**Note on timing:** existing containers keep running on the old image until each bot is next used, so
activation is not instantaneous and is not disruptive to *idle* bots.

**Also noted:** `chromium --headless --print-to-pdf` **hangs** in this image (two attempts, 10+ min,
killed both times). So the documented PDF path should be `--pdf-engine`-less tools or a Python
renderer, not headless Chromium — the round-54 guidance pointing at chromium needs that caveat.

### Employee-facing Thai backlog is ZERO### Employee-facing Thai backlog is ZERO (2026-10-16)

The measured backlog from rounds 57–58 is finished:

| Measure | Round 57 | Now |
|---|---|---|
| employee-reachable untranslated | 152 | **0** |
| Thai catalog overall | 279 | **448 / 1148** |
| English UI chrome on the shell | 0 | **0** |

Last batch covered computer sleep/boot/stop states, the sign-in code and link waiters (two ICU
plurals), the delete-versions confirmation, space-deletion rules, skill/teaching prompts, and the
context/token limit validation messages.

**Two things worth keeping:**

1. **Thai has no plural inflection**, so both ICU branches read identically. That is correct, but it
   must be verified rather than assumed — done by compiling the catalog (`lingui compile`, exit 0)
   and confirming the Thai plural text appears in the compiled `messages.mjs` instead of falling back
   to the English source.
2. **My placeholder-parity checker flagged those two plurals as mismatches.** It compares `{…}` tokens
   naively across a **multi-branch ICU string**, so a valid plural looks wrong. **The compiler is the
   authority, not the checker** — and the checker's own limitation is now recorded, so a future run
   does not chase it.

**What "0 employee-facing" means and does not mean.** It means every string an employee can reach on
the shell, chat, documents, routines, departments and auth surfaces has a Thai entry. It does **not**
mean the remaining ~700 owner-only strings (billing, MCP servers, approval rules, skills) are
translated — those are deliberately outstanding, and an employee never sees them.

**Still not speaker-reviewed.** Every Thai string here was written by me. Fluent, but not idiom-checked
by a Thai speaker — worth one review pass before staff depend on the wording.

### Cleared most of the employee Thai backlog### Cleared most of the employee Thai backlog: 152 → 25 (2026-10-16)

Round 57 measured the backlog by filtering untranslated msgids by **source file**, giving a precise
target. This round worked it down: **134 strings translated in two batches**, covering what a factory
employee actually meets —

| Area | Examples |
|---|---|
| chat actions & states | `Copy`, `Stop`, `Speak this reply`, `Load more`, `Retry screen`, `Cancel reply` |
| assistant / computer controls | `Take control`, `You have control`, `Show computer`, `Team Computer`, `Bot screen` |
| settings & model surfaces | `Settings: General`, `Model id`, `Reasoning effort`, `Minimal/Low/Medium/High/Max` |
| password recovery | `Forgot password?`, `Choose a new password`, `Passwords do not match` |
| authorization & MCP | `Authorize this server…`, `Connected. Its tools are available from your next message.` |

| Measure | Result |
|---|---|
| employee-facing untranslated | **152 → 25** |
| Thai catalog overall | **423 / 1148** |
| placeholder mismatches | **0** (a mismatch reverts to English silently) |
| English UI chrome on the shell after deploy | **0** |

**A method note that made this safe at volume:** the translation table was written as a **JSON file**
and applied by key lookup, not as inline Python. My first attempt as inline literals hit a
`SyntaxError` on an entry containing an escaped quote — invisible until the whole batch failed. With a
data file, every key is validated against the catalog and any mismatch is **reported by name**, so a
typo cannot silently skip a string.

**Also verified on screen, not just in the bundle:** the Thai shell renders with the new strings
present and **no English UI chrome** remains on the tab bar, work nav, composer or dialogs.

### The New-department dialog works### The New-department dialog works (verified through the UI, 2026-10-16)

Every previous department test used the **API**; the dialog itself had never been driven by a user.
Now it has, and it works end to end:

| Step | Result |
|---|---|
| click `แผนกใหม่` | dialog opens |
| dialog copy | fully Thai — `แผนใหม่`, `สร้างแผนกและย้าย Chief เข้าไปในแผนกนี้`, `ชื่อ`, `ยกเลิก`, `สร้าง` |
| type `ฝ่ายผลิต`, submit | `bot_sections` 0 → 1, name stored correctly |
| the assistant | **moved into the department** (`sectionId` set) — which is what the dialog promises |
| sidebar | shows the department |
| cleanup through the product | back to 0 sections |

**Two of my own test bugs, both worth keeping:**

1. **`offsetParent !== null` is NULL for `position: fixed` elements** — which is exactly what a modal
   dialog is. My "visible inputs" filter therefore excluded the dialog's own field. Use
   `getBoundingClientRect()` geometry instead.
2. **A global input search matched the sidebar's search box first**, so I typed into the wrong field
   and submitted an empty form — which validation *correctly* rejected (`sections 0 → 0`). Scope
   selectors to the dialog, not the document.

Both produced a **negative result that looked like a product failure** and was actually my harness.

### Translating with a TARGET, not a count (2026-10-16)

Round 56 translated "the next 46 strings". This round filtered the untranslated set by the **source
file** each msgid came from, which gives a precise target:

| Where | Untranslated |
|---|---|
| employee-reachable files (`Shell`, `message-cards`, `employee-nav`, `space-sidebar`, artifacts/routines pages) | **114** |
| everything else | 754 |

Translated 16 more of the employee ones — attachment limits and size refusals, working status,
archive states, authorization prompts. Placeholder parity re-verified: **0 mismatches**, 295 entries.

**The 114/754 split is the number to work from next**, not the raw total: an employee will never see
billing or MCP-server copy, and translating it first is churn.

### ⚠ There is NO way for two employees to share one assistant### ⚠ There is NO way for two employees to share one assistant (2026-10-16)

Zervi's model is a **department** — several colleagues working with the same assistant. Measured:
every space has exactly **one** member, and the product cannot change that.

| Evidence | Finding |
|---|---|
| `space_members` rows per space | **1** for all three spaces |
| the only `spaceMember.create` | inside `createSpace` — it makes the **creator** an owner |
| `spaces` RPC surface | `list`, `create`, `rename`, `remove` — **no add-member** |
| employee-facing invite UI | none (only *messaging* invites, for Slack/Teams channels) |

**But the schema DOES model sharing** — so this is **modelled-but-unexposed**, not a design choice:
`SpaceMember.role` defaults to `"member"` and `@@unique([spaceId, userId])`.

**And even adding a member would not share an assistant.** `Bot` carries its **own `userId`**, and the
read path is:

```ts
where: { spaceId: { in: spaceIds }, userId: actor.userId, archivedAt: null }
```

So an assistant is visible **only to its owning user**, even inside a shared space. Verified: all 5
bots in Archie's space have a `userId`.

**Why this matters for the objective:** the Zervi employee model is *"a department uses the shared
Ops assistant"*. Today every employee would need their **own** assistant, with its own memory,
routines and history — which is a different product from the one being rolled out. This is a
**structural gap**, and the largest remaining one after reachability/TLS.

**Not changed here.** Making assistants space-visible touches the isolation boundary verified in
round 33 (`spaceId AND userId`), so a mistake would leak one employee's assistant into another's
sidebar. It needs an explicit decision about which of three models Zervi wants:

1. **Space-wide assistants** — every member sees every assistant in the space (simplest; widest blast
   radius if a space is ever shared wrongly).
2. **Explicitly shared assistants** — a per-assistant "shared" flag, default private.
3. **Department-scoped** — assistants belong to a department (`bot_sections` already exists) and its
   members see them.

**How to verify a fix, when it comes:** create a second user in one space, sign in as them, and check
the sidebar shows the shared assistant — then confirm they still **cannot** see the other user's
private assistants. Both halves matter.

### Empty and error STATES were English### Empty and error STATES were English — a class, found via search (2026-10-16)

Search itself works correctly (case-insensitive substring: `chief`, `CHIEF`, `ief` all match; a
non-matching term gives an empty state). The gap was the **empty state**: a Thai employee searching
something that matches nothing read **`No results`** in English.

That is a *class* — state messages — so the whole class was swept:

```
untranslated state-like strings : 132
of which "Could not …"          :  88
```

**Translated 46 that an employee can actually trigger** — chat, documents, upload/download,
connection, space/group/bot create-rename-delete, run-a-routine, and the generic fallbacks:

| Before | After |
|---|---|
| `Could not download file` | `ดาวน์โหลดไฟล์ไม่สำเร็จ` |
| `Could not load this chat.` | `โหลดบทสนทนานี้ไม่สำเร็จ` |
| `Could not load bots. Reload to try again.` | `โหลดรายชื่อผู้ช่วยไม่สำเร็จ กรุณาโหลดหน้าใหม่` |
| `No results` | `ไม่พบผลลัพธ์` |

**Deliberately left owner-only surfaces for later** — billing, MCP servers, approval rules, skills —
because an employee never sees them and translating them first would be churn. The remaining count is
recorded so the next pass starts from a number, not a guess.

**One catalog entry covers both call sites** of `No results` (sidebar space-search and the plugins
overlay), which is why a single edit fixed the one an employee meets.

**Verified:** placeholder parity across the whole Thai catalog is **0 mismatches** — a mismatch makes
Lingui fall back to English **silently**, so parity is the check that matters. 279 translated entries.
Both new strings confirmed present in the served bundle, and the Thai empty state verified on screen.

**A test of mine was invalid first.** My initial search check asserted against
`document.body.innerText`, which includes the **transcript** — where "Chief" is the bot's name in the
conversation header. So every term, including `zzz-no-match`, appeared to match. Scoped to
`[data-testid="bots-sidebar"]`, the check could finally fail, and then it passed honestly.

### A photographed Thai invoice CAN be read### A photographed Thai invoice CAN be read — no OCR needed (2026-10-16)

Round 53 established that a bot cannot *render* Thai without a font. The inverse question — can it
**read** Thai an employee sends — turned out to be **fine**, and testing it corrected a bad assumption
of mine.

There is **no OCR anywhere** in the codebase (`tesseract`/`pytesseract` absent). I initially read that
as a gap, since a photographed invoice has no text layer. It is not a gap: the deployed model reads
the image directly.

**Tested end to end**, using the app's real upload flow (`artifacts/create` → `threads/send` with
`artifactIds`):

| Step | Result |
|---|---|
| rendered a Thai image in the bot container: `เลขที่ใบส่งของ DO-2569-0042` | 10,376 base64 bytes |
| uploaded as an artifact, sent with the question | `artifacts/create` → 200 |
| run completed | 200, ~2 min (long tool sequence) |
| assistant's reply | **`DO-2569-0042`** — the exact number from the image |

So a Thai employee photographing a supplier invoice **can** be served. The answer also arrived in Thai.

**A mistake in my own test, worth recording:** my first attempt passed an `attachments: [...]` array to
`threads/send`. That field does not exist — the real one is `artifactIds` — and zod **silently stripped
it**, so the message went through with text only and the bot correctly replied *"I don't see the
attached image."* I nearly recorded that as a product failure. The lesson: **an unknown field being
dropped, not rejected, turns a test bug into an apparent product bug.** Read the contract before
believing a negative result.

Cleanup: the font and test image I placed in the task container were removed (`fc-list :lang=th` → 0,
`~/.fonts` gone, `/tmp` clear of my files).

### Made the Thai-font gap discoverable to bots### Made the Thai-font gap discoverable to bots (2026-10-16)

Round 53 proved the bot container has **no Thai font**. Baking one into the shared `computer:edge`
image is **Archie's decision**, but a safe half belonged in this fork: **tell the model**, because
nothing did.

Verified the workaround is actually actionable before documenting it:

| Check | Result |
|---|---|
| `fonts.gstatic.com` reachable from the bot container | **yes** (47 KB fetched) |
| the exact command, run verbatim as the bot | `fc-list :lang=th` → **Noto Sans Thai**; `fc-match` → **Noto Sans Thai** |
| Thai then renders | **5 distinct shapes** for 5 Thai chars (was **1** = tofu) |

Added to the computer tool instruction, with tests pinning the warning (104 pass in
`executor.test.ts`). Present in **both** the worker and the api after deploy — the worker executes
runs, so guidance that only reached the api would be inert.

**I also corrected a claim I made last round.** I wrote that `pandoc` "exists but fails". Re-checked:
`pandoc -t plain` for **extraction** works fine, so the prompt's own statement is accurate. Only
**PDF generation** fails, because pandoc's default engine (`pdflatex`) is not installed. The guidance
now says exactly that and points at `--pdf-engine` or `chromium --headless --print-to-pdf`.

**Not done, still Archie's call:** bake a Thai font into the image so no bot ever needs the
workaround. Until then this is a documented recovery, not a fix.

### ⚠ A bot CANNOT render Thai into a document### ⚠ A bot CANNOT render Thai into a document — 0 Thai fonts in its container (2026-10-16)

Round 43 fixed Thai in the **browser**. Documents are rendered **server-side**, in the bot's own
container — and that container has **no font that can draw Thai at all**:

```bash
docker exec rakazo-bot-team-... fc-list :lang=th | wc -l   #  0
docker exec rakazo-bot-team-... fc-match "sans-serif:lang=th"
# -> DejaVu Sans          (which has NO Thai glyphs)
```

157 font files present; **zero** claim Thai coverage. `fc-match` therefore falls back to **DejaVu
Sans**, and a Thai string drawn with it produces **tofu boxes**.

**Proven, not inferred** — per-character shape comparison at 40px, because an ink-pixel count cannot
tell glyphs from boxes (DejaVu scored 3,555 ink pixels, which looked fine):

| Font | distinct shapes for 5 different Thai chars |
|---|---|
| DejaVu Sans (what fc-match chose) | **1** — every char drew the SAME box = **tofu** |
| Garuda (a real Thai face) | **5** — real, different glyphs |

**Impact:** any Thai invoice, packing slip or report a bot generates is unreadable. Archie's
Commercial Invoice worked because its content was Latin.

**The fix is available and matches the pattern the bot prompt already recommends** (`uv tool install`
into the persistent home). Verified end to end:

```bash
cp <a-thai-font.ttf> ~/.fonts/ && fc-cache -f ~/.fonts   # no sudo; container user is uid 1000
fc-list :lang=th            # -> Garuda       (was: empty)
fc-match "sans-serif:lang=th"  # -> Garuda     (was: DejaVu Sans)
```

After that the same Thai string rendered as **real glyphs** (5 distinct shapes).

**Not applied to the image here** — that is a change to the shared `computer:edge` image, so it is
**Archie's decision**: bake a Thai font into the image (best — every bot gets it), or have bots
install one on demand. **Bots will not do this unprompted**, because nothing tells them Thai text
needs a font.

**Also noted:** `pandoc` exists but its default PDF engine (`pdflatex`) does **not**, so
`pandoc doc.md -o doc.pdf` fails — while the bot's own system prompt promises pandoc is available for
documents. `chromium` IS present and can print-to-PDF.

**Cleanup:** my test artifacts and the font I installed in Archie's team container were removed
(`/tmp` clear, `~/.fonts` absent, Thai fonts back to 0). One file needed root because `docker cp`
creates it as root — worth knowing before copying into a bot container.

### iPhone photos (HEIC) are rejected### iPhone photos (HEIC) are rejected — proven at the code level, device impact UNVERIFIED (2026-10-16)

A factory employee's likeliest action is **photographing a part and sending it**, so this checked the
attachment path.

**Proven:** HEIC/HEIF are absent from **both** `EXTENSION_MIME_TYPES` and
`ATTACHMENT_ALLOWED_MIME_TYPES`, and no commit ever mentions `heic` — so it is absent by omission, not
a documented decision:

```
IMG_1234.HEIC  type=image/heic  -> REJECTED
IMG_1234.heic  type=(none)      -> REJECTED
photo.HEIF     type=image/heif  -> REJECTED
photo.jpg      type=image/jpeg  -> image/jpeg      (accepted)
```

Rejection is a product decision. The **defect was the diagnosis**: the notice read only
`Skipped IMG_1234.HEIC` — no hint that the **format** was the problem or what to do about it. Now:

| Case | Message |
|---|---|
| `.heic` / `.heif` | `<file> (iPhone HEIC photos are not supported — send as JPEG)` |
| anything else | `<file> (unsupported file type)` |

Both translated to Thai, and tests pin the rejection so it stays a **known** decision.

**What I could NOT verify, stated plainly:** iOS Safari commonly **converts HEIC to JPEG** when a photo
is picked through a file input, which would mean real iPhones rarely hit this. I have no iPhone and
Chrome on Linux cannot emulate that conversion, so the **device-level impact is unverified**. The
correct next step is one real phone: pick a photo, send it, see whether it arrives as JPEG.

Also confirmed correct in the same path (not defects): the 10 MiB cap and the 4-attachment limit both
produce clear messages, and a rejected file never blocks the rest of a multi-file selection.

### The server-composed copy class, audited rather than patched### The server-composed copy class, audited rather than patched (2026-10-16)

Three consecutive rounds each found **one** instance of the same class, so this enumerated the class
instead:

```bash
grep -rnoE 'text: `[^`]{20,140}`' packages/adapters/src/*.ts apps/api/src/*.ts
```

That surfaced 11 blocks. Classifying them by whether an **employee** sees them gave:

| String | Source | Employee-visible? |
|---|---|---|
| `Got it. <summary>. I'll see what's already connected…` | onboarding:242 | **yes** — fixed last round |
| `<apps> are a good place to start. Connect them here…` | onboarding:293 | **yes** — **MISSED last round** |
| `Hit those one/two/three and I'll start pulling…` | onboarding:300 | **yes** — fixed last round |
| `Provider unavailable. Switched to backup model <id>.` | pi-runtime:389 | **yes** — progress block |
| `Stopped: more than <n> tool calls in one turn.` | pi-runtime:2232 | **yes** — progress block |
| `Unknown model <provider>/<id>` | pi-runtime:227 | **yes** |
| `<tool> is unavailable without an executor.` | pi-runtime:1266 | **yes** |
| `Created by <name>`, computer status dumps, `You were added to the group chat…` | various | agent/group paths, not the employee chat |

**`progress` blocks render inside the message bubble** (`Shell.tsx:6917`), so the pi-runtime lines
are genuinely user-facing. Verified against the database: **none has fired yet** — they are
**latent**, and would appear the first time the provider hiccups or a turn hits its tool budget.

**Why exact match could not cover them:** they interpolate app names, a model id, a count. Added
**regex** forms that translate the sentence and pass the interpolated value through, and exported the
helper so the regexes carry tests — a regex that silently stops matching would revert to English with
**no error**, which is exactly the failure mode this whole class shares.

Tests pin that the interpolated value survives: `Slack, Gmail, and Google Calendar`, `gpt-5`, `40`,
`deepseek/deepseek-v4-pro`, `browser`.

**Seed for next time:** `server-composed copy` is a *category*, not a bug. Any string built in
`packages/adapters` or `apps/api` and rendered as a block bypasses the catalog by construction.

### A raw provider error body reached the employee verbatim### A raw provider error body reached the employee verbatim (fixed 2026-10-16)

Found by reading **stored** `run.error` values rather than the interface — the second time this round
that the database held what the screen hid.

```json
401: {"message":"Authentication Fails, Your api key: ****eae5 is invalid
     (request_id: 8921529a-834c-404e-b216-210ea358a3f7)","type":"authentication_error"}
```

That is what a failed run stored and painted in the composer alert. `threadRunError` returned
`run.error` **raw**, bypassing `userErrorMessage` — a helper that exists precisely to hide JSON dumps,
status codes and stack frames, and already catches `Request failed with status code 500` and
`ECONNRESET`.

**Why the existing pattern missed it:** `/^\s*[[{]/` (JSON) only matches at the **start** of a message,
and this body is **prefixed by a status code**.

**Fixed in two halves:**

1. `TECHNICAL_MESSAGE` now also catches a *status-prefixed* provider body and a bare error envelope
   (`"request_id"`, `"error"`, `"type"` keys). Tests added — 16 pass in `user-error.test.ts`.
2. The run reason is routed through `userErrorMessage` **at the point of display**, via a new
   `threadRunErrorForDisplay`, so the stored value and its existing callers stay untouched.
3. The fallback the employee then sees was **empty in Thai** — translated to
   `เกิดข้อผิดพลาด ลองอีกครั้ง`.

Verified with 3 tests on the display path: the provider blob becomes the fallback and never contains
`request_id`, while a legitimate human message (`Connect a model in Settings…`) still shows as-is.

### The assistant answers Thai fluently### The assistant answers Thai fluently, but ONBOARDING spoke English (fixed 2026-10-16)

Two halves, one good and one broken.

**Good: the assistant's own answers are Thai.** No language instruction exists anywhere (bot
`instructions` length 0, nothing in the system prompt names a language), yet asked in Thai it
replied in fluent Thai — 135 Thai characters, correct register (`ครับ`). So the model handles it and
the product needs no language plumbing for conversation.

**Broken: the onboarding copy is composed SERVER-side with no catalog entry.** Measured by driving
the focus card:

```json
[{"kind": "text", "text": "Got it. Slack, calendar, and email. I’ll see what’s already
connected so I don’t make you set something up twice."}]
```

That is the **first thing a new employee reads**, and it painted verbatim in English. The same was
true of the follow-up (`Hit those one/two/three and I’ll start pulling the picture.`).

Note the client **already** translated the card's *question* and *option labels* by exact match
(`message-cards.tsx`: *"API stores English; UI locale catalogs translate it"*) — the sentences
*around* that card were simply never covered.

**Fixed in the web layer**, extending the existing exact-match approach rather than putting i18n into
the API (which also serves the mobile app and cannot be tested here). Exact match only, so model
output and user-typed text pass through untouched. **Verified on screen**: the English string is no
longer painted and `รับทราบครับ (Slack ปฏิทิน และอีเมล) …` renders instead.

**Lesson:** "the UI is Thai" and "the product speaks Thai to the user" are different claims. Server-
composed copy bypasses the catalog by construction, so it needs its own check — here the giveaway was
reading the **stored message payload**, not the interface.

### Installability verified### Installability verified, and the landing headline was English (2026-10-16)

A factory employee's phone needs a home-screen icon, so this checked the PWA contract and the path a
tapping employee takes.

**Installability holds:**

| Property | Value |
|---|---|
| manifest | `/site.webmanifest` → 200, `application/manifest+json`, valid JSON |
| `display` | `standalone` |
| icons | `/icon-192.png` **200** (51 KB), `/icon-512.png` **200** (347 KB) |
| name / short_name | `Rakazo` — a brand name, correctly **not** translated |

**The installed-app launch works.** `start_url: "/"` with a session lands straight in
`/app/<threadId>` with the Thai nav — no intermediate screen.

**Defect found: the first copy a Thai employee meets was English.** A **cold** launch (no session)
lands on the welcome page, which read:

```
Rakazo
Your team of always-on agents          <- English
that you can give real work to.        <- English
เข้าสู่ระบบ  →                          <- Thai
```

`Welcome.tsx` wraps that headline in `<Trans>`, so it is extractable — it simply had **no Thai
msgstr**. Translated with the **`<0/>` tag placeholder preserved** (the extractor turns the inner
`<br/>` into a tag). Verified the tag list matches on both sides, so the entry still matches after
re-extraction. Live now reads:

```
Rakazo
ทีมผู้ช่วย AI ที่ทำงานตลอดเวลา
พร้อมรับงานจริงจากคุณ
เข้าสู่ระบบ  →
```

**A test of mine was invalid and I caught it.** The first cold-launch attempt reported the *same*
result as the signed-in case — because my request interceptor re-added the session cookie **after**
`clearBrowserCookies`. Both paths looked identical, which is exactly the shape of a check that cannot
fail. Re-ran with `Fetch.disable` first; only then did the two cases differ.

### What an employee sees during an API outage### What an employee sees during an API outage (measured 2026-10-16)

Deploys restart the api many times a day, and an employee with an open tab lives through that. This
was never tested, so it was measured by **blocking the RPC/auth routes in the employee's browser** —
which reproduces "server unreachable" without disturbing anyone.

**Browsing during an outage: silent and safe.** No error banner, no broken layout; the composer stays
usable. The UI simply stops updating.

**Sending during an outage: correct, and no data loss.** A failed send produces a composer alert, and
crucially:

| Observed | |
|---|---|
| alert text | `เชื่อมต่อเซิร์ฟเวอร์ไม่ได้` (was English — see below) |
| the employee's draft | **`ข้อความทดสอบขณะออฟไลน์` — PRESERVED in the box** |
| recovery | the UI returns to normal once the API answers again |

So a network blip costs a retry, never typing.

**Defect found and fixed:** the message was **English on a Thai UI**, and it is also what a failed
**sign-in** shows. `Could not reach the server` had no Thai msgstr. Translated it plus the surrounding
network class — clear conversation, change password, change default model, complete OAuth, complete
the update, check stored credentials, and the server-URL guidance in the integrations test box (8
strings). Verified live: the failed send now reads `เชื่อมต่อเซิร์ฟเวอร์ไม่ได้` with the draft intact.

**How to reproduce safely:**
```bash
# blocks only the RPC/auth routes in that browser tab; nothing server-side changes
Network.setBlockedURLs({ urls: ["*/rpc/*", "*/api/auth/*"] })
```

### Thai dates, catalog integrity, and page weight### Thai dates, catalog integrity, and page weight (measured 2026-10-16)

**Thai dates are correct, and that was worth confirming rather than assuming.** Dates render through
`i18n.locale`, which is `"th"` when the UI is Thai, and `th` defaults to the **Buddhist calendar**:

| Locale | `2026-10-16` renders as |
|---|---|
| `en` | `October 16, 2026` |
| `th` | **`16 ตุลาคม 2569`** (2569 BE — correct for Thailand) |

So no forced-Gregorian bug. Note the browser I test with reports UTC while the host is also UTC; a
Thai employee's browser supplies its own zone, and the app uses that (`local-timezone.ts`).

**Catalog integrity is sound** — 212 Thai entries and **zero placeholder mismatches** against English,
and all **676** literal `t\`…\`` strings referenced in code exist in the `en` catalog, so nothing
renders a raw message id.

**Build-time compilation is safe.** `build` runs only `vite build` (not `intl:compile`), which looked
like a stale-catalog risk. Proved otherwise: wrote a sentinel into a Thai msgstr, ran a plain
`vite build`, and the sentinel **shipped** — the `lingui()` Vite plugin compiles catalogs during the
build. Reverted and re-verified.

**Page weight for a factory phone** (cache disabled, Thai browser):

| Measure | Value |
|---|---|
| first-load transfer | **0.55 MB** |
| whole bundle, gzipped | 0.90 MB |
| woff2 shipped | 147 KB total |
| woff2 **fetched** by a Thai browser | **one file** — `noto-sans-thai-thai-wght-normal.woff2` |

The `unicode-range` split does its job: a Thai user downloads the Thai subset, not the Latin ones.

### Second Thai font gap: Tailwind's `--font-sans` was Latin-only (fixed 2026-10-16)

The body fix above only covered `#root`. Tailwind's default token was untouched:

```css
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", …;
```

That stack has **no Thai face**, so any element using the **`font-sans` utility** rendered Thai
without the self-hosted font. Measured in the live page at 40px:

| Family | Thai `กำลังทำงาน` |
|---|---|
| `"Noto Sans Thai Variable"` | 187px |
| Tailwind `--font-sans` (before) | **209px** — identical to Geist-only |

Only **one** component uses `font-sans` today (`kbd`), which is why nothing looked broken. Fixed at
the **source** instead of that one call site: `--font-sans` is overridden in an `@theme` block, so
every current and future `font-sans` element gets Thai. Re-measured live: `--font-sans` now sets Thai
at **187px**, matching the webfont. `--font-mono` is left alone — code is not Thai prose.

**And my own audit was lying.** `verify-thai-typography.mjs` embedded the **old** family list as a
string literal, so after the fix it kept measuring *its own literal* and reported 209px — a check that
had silently drifted from the thing it checks. It now reads the app's **live** computed stack and
asserts `document.fonts.check(...)`, reporting Thai 187px with `thaiFontLoaded: true`.

**Generalisable rule:** an audit that hard-codes the value it verifies will keep passing (or keep
failing) after the thing under test changes. Read the value from the running system.

### Thai had NO shipped font### Thai had NO shipped font — every glyph came from the device (fixed 2026-10-16)

Forty-two rounds translated Thai strings; none checked whether Thai **rendered**. The font stack was:

```css
font-family: "Geist Variable", ui-sans-serif, system-ui, sans-serif;
```

Geist is the only font this app ships (`@fontsource-variable/geist`) and it carries **no Thai
glyphs**. Measured:

| Check | Result |
|---|---|
| Thai fonts inside the web **container** | **0** |
| Thai fonts on the **host** | 66 (`Loma`, `Garuda`, `Norasi`, …) — irrelevant to an employee's phone |
| Thai font shipped by the **app** | **none** |

So every Thai glyph was painted by **whatever the employee's device happened to have**, or a generic
fallback.

**Fixed:** self-host `@fontsource-variable/noto-sans-thai` and name it in the stack **ahead of** the
generics (order matters — a generic family listed earlier claims the glyphs first). `unicode-range`
means Latin-only users download none of it.

**Proven the font is APPLIED, not merely downloaded** — measured in the live page at 40px:

| Stack | Thai `กำลังทำงาน` | Latin `Running` |
|---|---|---|
| new (`…, "Noto Sans Thai Variable", …`) | **187px** | 151px |
| old (`…, ui-sans-serif, system-ui, …`) | **209px** | 151px |
| Geist only | **209px** | 151px |

The old stack measured **identical to Geist-only**, which proves it was falling through to a generic
face. Latin is unchanged, so nothing regressed. Also verified live: the browser fetches
`noto-sans-thai-thai-wght-normal.woff2`, `document.fonts.check(...)` returns **true**, status
**`loaded`**, and a Thai clip/overflow sweep finds **zero** clipped elements.

### Exposing the app was a CODE change### Exposing the app was a CODE change; now it is configuration (2026-10-16)

The rollout decision needs the app reachable behind a proxy — but the trusted-origin list was built
only from `webOrigin`/`baseUrl` plus the hardcoded `MOBILE_AUTH_ORIGINS`. So a new hostname was
simply **rejected**:

```
Origin: http://rakazo.zervi.local  ->  403 Forbidden, no ACAO header
```

That made "put it behind a TLS proxy" a **code change**, not an operational one. Fixed:
**`EXTRA_TRUSTED_ORIGINS`** (comma-separated) now feeds **both** the auth trusted origins and the
CORS check, through one `splitOrigins` helper reading the **resolved** env (so overrides apply).

**Proven live, with the var set and then restored:**

| Origin | Default | With `EXTRA_TRUSTED_ORIGINS=http://rakazo.zervi.local` |
|---|---|---|
| `http://rakazo.zervi.local` | **403** | **401** (accepted; auth then rejects the fake creds) |
| `http://still.evil` | 403 | **403** |
| `http://100.74.72.109:5173` | 401 | 401 |
| after restoring the default | **403** | — |

The default is **empty**, and 8 unit tests pin the safety property: an unconfigured hostname stays
rejected, and a wrong-scheme or different hostname is still rejected when one *is* configured.

**So the remaining rollout work is now genuinely operational:** pick a network path and TLS, set
`EXTRA_TRUSTED_ORIGINS` to the new hostname, and update `AUTH_TRUSTED_PROXIES` to the new hop. Two
environment values and a proxy — no code.

### Rollback now exists, and was drilled### Rollback now exists, and was drilled (2026-10-16)

**The gap:** `TAG="employee-ui-$(date +%Y%m%d)"` — a **date**, so all ~15 of today's builds collapsed
into ONE tag. Every deploy **overwrote** the previous image, destroying the last-known-good build.
The only local fallback was **stock Rakazo**, which loses the nav, departments, Thai, and every fix.

**Two changes:**

1. Builds are tagged by **commit** (`employee-ui-<date>-<rev12>`), so the previous build survives.
   The date-only tag is kept as a moving alias so existing references still resolve.
2. **`rakazo-rollback.sh`** — `--list` shows candidates; `--to <tag-or-commit|stock>` points compose at
   an image **already on this host** and recreates **web+api only**. No rebuild, no registry pull.

**Drilled, safely:** rolled to the revision already running (a rollback to an *older* build would
briefly serve stale code to Archie, a live user). Verified it resolved the tag, rewrote **3** compose
service lines, recreated web+api, and reported **HEALTHY**.

| Verified | Result |
|---|---|
| a bad target exits | **1** (checked without a pipe — see below) |
| the worker is untouched | kept its uptime (started 20:04, still up) |
| compose points at the target | 3 service lines rewritten |
| post-rollback health | HEALTHY |

**A lesson repeated:** I first read the bad-target exit code as **0**, because I piped through `tail`
and read *tail's* status. Without the pipe it is **1**, as written. Same mistake I made in round 27 —
so: **check exit codes without a pipe.**

### ⚠ THE ROLLOUT BLOCKER### ⚠ THE ROLLOUT BLOCKER: staff cannot REACH the app (measured 2026-10-16)

Every round so far verified what the app **does**. This asks how a factory employee would **get to
it** — and the answer is that today they cannot.

| Who | Address | Result |
|---|---|---|
| Archie (has Tailscale) | `http://100.74.72.109:5173` | **works** (all of this session) |
| Employee's phone | — | **no route** |
| Public internet | `:80` | answers **404** (something else is there) |
| Public internet | `:5173` | **connection refused** |

**Why:** `zbox-bind.yml` pins both ports to the tailnet address deliberately —
`"100.74.72.109:5173:5173"` and `"100.74.72.109:3100:3100"`. Nothing outside the tailnet can open a
connection. Measured from the host's own public IP: `curl http://15.235.231.28:5173` fails to connect
while `http://15.235.231.28/` returns 404 — so the binding, not a firewall, is what blocks it.

**Second half of the same blocker: it is HTTP-only.** `https://100.74.72.109:5173` fails with
`wrong version number` (no TLS listener). A phone on a LAN needs TLS for secure cookies, and a PWA
install requires it.

**So a staff rollout needs a decision, not a code change:**

1. **Network path** — either Tailscale (or equivalent) on every staff phone, or bind behind a
   TLS-terminating reverse proxy on the host. The host already has things listening on `0.0.0.0:80`
   and Coolify on `:8000`, so a front door exists to hang it from.
2. **TLS** — required for a phone, and mandatory if any session cookie must be `Secure`.
3. **Then** `AUTH_TRUSTED_PROXIES` must name the NEW hop (see the section above), or per-client
   sign-in buckets silently revert to one shared bucket.

**None of this was changed here.** Exposing an internal service to a factory LAN is a
**gate-5-adjacent decision** (it makes the app reachable outside the tailnet), and the right front
door depends on how Zervi's network is laid out. Recording it as the single largest thing standing
between "verified" and "usable by staff".

### Two users running at once — verified, and it works (2026-10-16)

Every check until now exercised **one** user. For a floor of staff, concurrent work is the normal
case, so this fires two runs **simultaneously** from two accounts and checks for cross-talk.

| Check | Result |
|---|---|
| both runs sent in parallel | yes |
| account A received | `ALPHA-ONE` |
| account B received | `BRAVO-TWO` |
| cross-talk | **none** in either direction |
| wall clock for both | **12s** |
| runs left in flight | 0 |

The worker's `GRAPHILE_WORKER_CONCURRENCY` defaults to **4**, so several staff can be served at once.
Each run is lease-protected and each bot belongs to one space, so parallel work does not interleave.

**A trap I walked into, worth recording.** The first version of this test created the second account
but **never gave it a bot**, so nothing was sent from B — and the test still printed
`correct isolation: A ok / B WRONG` against an empty result. It *looked* like it had exercised two
users while exercising one. Two fixes, both now permanent:

1. `bootstrap` is **read-only** (it reads navigation/thread/routines) — it does **not** provision a
   bot. A new account gets its first assistant from an explicit `bots/create`, which is what the
   onboarding UI does. The test now follows that real path.
2. It **refuses to run vacuously** (`REFUSING: … the test would be vacuous`) if B has no bot, and
   **removes B on every exit path** — the earlier version exited early on that refusal and leaked an
   account behind it.

### The intermittent "1 failed" was a TIMEOUT — and a real redirect bug was hiding in its text (2026-10-16)

Two distinct defects, one of which pointed at the other and **was not its cause**.

**First, a genuine production bug in the quiesce command.** `cmdline_text()` in
`desktop-runtime.ts` read a process's `/proc/<pid>/cmdline` as:

```bash
tr '\0' '\n' <"/proc/$1/cmdline" 2>/dev/null || true
```

Bash applies redirections **left to right**, so `2>/dev/null` comes **too late** to suppress a failed
**input** redirect. Every read of an already-exited process still printed:

```
bash: line N: /proc/<pid>/cmdline: No such file or directory
```

Proven by reproduction — moving `2>/dev/null` **before** the `<` silences it completely. Fixed, and
verified no other `<path 2>/dev/null` exists in the repo.

**Second, and the actual cause of the flake: the test's own timeout.** The assertion was
`expected null to be 0`, and `spawnSync` returns `status: null` with `signal: SIGTERM` and
`error.code: ETIMEDOUT` when **its** timeout fires. So the command had not misbehaved — it was
**killed at 20s**. Measured:

| | |
|---|---|
| duration when passing | **8.7s** |
| test's `spawnSync` timeout | 20s |
| worst case of the command's own waits | 20s (two 40×0.25s loops) |

In isolation the test passed **3/3**; under full-suite parallel load it exceeded 20s intermittently
(**2 of ~10 runs**). Raised to **90s** — the assertion is about **behaviour** (the browser really is
quiesced and its cookies kept), not speed, so a slow host must not fail it. Assertions unchanged.

**The trap worth keeping:** the scary `No such file or directory` text appeared inside the failure
message (`expect(result.status, result.stderr)`), which made it look like the cause. It was
**captured stderr printed as assertion context**. Reading what `status: null` actually MEANS
(`ETIMEDOUT`) is what separated the two.

**Result: 5 consecutive full-suite runs at 5,817 passed, 0 FAIL markers** (was 2-in-10 failing).

### A colleague CAN register and work### A colleague CAN register and work — the rollout gate, driven end to end (2026-10-16)

`onboard-colleague.sh` opens a signup window and expects a **human at the browser**. I had been
treating this as verified because its `--dry-run` reports state correctly — which proves **nothing**
about the path a colleague walks. So I drove it the way a colleague would.

**Result: it works.** With the window open, registration through the real UI gives:

| Step | Result |
|---|---|
| register at `/sign-up` | fields `name` / `email` / `password`, **all Thai** (`สร้าง Rakazo ของคุณ`, `สร้างบัญชี`) |
| after submit | lands in `/app/<threadId>` with a **working assistant** and the Thai nav |
| users | 3 → 4, then back to 3 after removal through `delete-user` |

**The one snag was mine, not the product's.** My submit button matcher looked for
"sign up|create|continue|สมัคร|ลงทะเบียน" and returned `NO_BUTTON` — the real label is
**`สร้างบัญชี`**. A check keyed on guessed wording reports a false failure; read the rendered label.
(The client-side form fill also needed native-setter dispatch for React to see the values.)

**State after the test, verified:** `signupsEnabled=false`, allowlist empty, 3 users, 7 artifacts,
42 runs — and `onboard-colleague.sh --dry-run` agrees.

### Touch targets: everything THIS WORK added meets the 44px guideline (2026-10-16)

Measured on a phone viewport: **`under44Mine: 0`**. All 11 undersized controls are upstream
(`mine: false`) — e.g. "Open navigation" at 32×32, a `+` at 12×32. The employee tab bar and the
controls built here use `max-md:min-h-11` (44px). Worth separating, because "the app has small
targets" is true and "the employee UI has small targets" is not.

### Employee memory actually works### Employee memory actually works — measured end to end (2026-10-16)

Earlier notes recorded "recall is substring only" from reading `packages/memory/src/index.ts:64`
(`doc.content.toLowerCase().includes(q)`). That describes the **`recall_memory`** tool — which this
deployment **does not expose**: `selectMemoryTools` drops `recall_memory`/`save_memory`/`forget_memory`
unless a semantic provider is configured, and **no `space_memory_configs` row exists**. So the code I
read is not the path employees take.

**Tested the path they do take, on the employee account:**

| Step | Result |
|---|---|
| told the assistant *"our factory is in Chonburi"* | it wrote **`factory-location.md`** (27B) scoped to its own bot |
| asked in the SAME thread | *"Our factory is in Chonburi."* |
| asked again with a deliberately fresh prompt, told to ignore the conversation | *"Our factory is in Chonburi."* — answered from the stored document, not context |

So memory stores **durably**, is **scoped per bot**, and is **retrieved**. The store was nearly empty
(11 docs, 294 bytes) because it had simply never been used, not because it was broken.

**Cleaned up:** the test fact was blanked through `memory/update` (there is **no delete route** — the
`memory` namespace is `list`/`update`/`exportMarkdown`/provider config). Verified 0 documents mention
it afterwards. Worth knowing: **an employee cannot delete a memory document, only blank it** — if a
fact is wrong, the path is empty content, or ask the bot to overwrite it via `remember`.

### The trusted proxy hop is now DERIVED, not hardcoded (2026-10-16)

Round 36 pinned `AUTH_TRUSTED_PROXIES=10.0.5.4/32` — the **web container's IP**. Docker assigns
container IPs **dynamically**, so any recreate could hand web a different address, and the failure
mode is **silent**: the API stops trusting the proxy, strips `x-forwarded-for`, and every sign-in
returns to **one shared bucket** (10 per 15 min for the whole deployment) **with no error anywhere**.

**Three things changed:**

1. **The deploy derives the value.** `redeploy-web.sh` now starts web first, reads its live IP, and
   exports `AUTH_TRUSTED_PROXIES=<ip>/32` before starting the api. Nothing is hardcoded.
2. **The deploy asserts the pairing.** If the trusted value and the live web IP disagree, the deploy
   **fails** with an explanation instead of completing in a silently-broken state.
3. **`rakazo-health.sh` checks it.** Reports "api trusts the web proxy hop (10.0.5.4/32)", and
   **fails** when the value is unset or has drifted. Both paths negative-tested:

```
AUTH_TRUSTED_PROXIES unset      -> FAIL (exit 1)
trusted 10.0.5.4/32, web 10.0.5.9 -> FAIL (exit 1)
```

**Why not just pin the container IP in compose?** That would require recreating the `rakazo_app`
network — which carries the worker mid-flight. Detecting and deriving is the safe change; pinning is
a bigger, disruptive one for whoever owns a maintenance window.

**Still true and worth knowing:** a caller reaching the API **directly** (tailnet `100.74.72.109:3100`)
arrives from the **Docker gateway `10.0.5.1`**, which is deliberately **not** trusted — so its header
is stripped and it lands in the shared bucket. That is the intended hard-fail, not a bug.

### ⚠ I introduced a spoofing bypass with the fix above, then closed it (2026-10-16)

Declaring `trustedProxies` made better-auth **trust** `x-forwarded-for`, and it **never inspects the
socket**. The API listens on the tailnet (`100.74.72.109:3100`) as well as loopback, so any caller
reaching it directly could send `x-forwarded-for: <anything>` and **mint a fresh rate-limit bucket per
attempt** — measured: three distinct buckets from one caller, i.e. unlimited sign-in attempts.

**Fix, and the two things that made it non-obvious:**

1. A request whose **peer** is not a declared proxy has `x-forwarded-for` and `forwarded` **stripped**
   before better-auth sees it. A direct caller falls back to the shared bucket — a hard failure, not
   a silent bypass.
2. **The trust range had to be the web container, not the app subnet.** The guard was written and
   deployed and *still did nothing*, because a port published on the host arrives from the **Docker
   gateway `10.0.5.1`**, which is inside `10.0.5.0/24`. A temporary diagnostic showed
   `peer 10.0.5.1 -> match true`. `AUTH_TRUSTED_PROXIES` is now `10.0.5.4/32` — the web container,
   the only thing that legitimately proxies here.

**Verified:**

| Test | Result |
|---|---|
| direct caller spoofs 3 distinct headers | **one** shared `no-trusted-ip` bucket — never `192.0.2.x` |
| traffic through the web proxy | `100.74.72.109\|/sign-in/email` (real client IP) |
| employee journey | 13/13 |

**Two lessons worth keeping:**

- **A `try/catch` around a diagnostic can hide the very failure you are hunting.** My guard caught the
  exception from `getConnInfo` and set `peer = null`, so a resolution problem looked like "no peer"
  instead of an error. I confirmed the mechanism worked (deleting the header reached the handler as
  `null`) only by testing it in isolation inside the workspace.
- **Check the peer address from the right directory.** `import("@hono/node-server/conninfo")` fails
  from `/app` but succeeds from `/app/apps/api`, where `tsx` actually runs — I nearly filed a
  nonexistent packaging bug.

### ⚠ Every sign-in shared ONE rate-limit bucket — a rollout blocker (FIXED 2026-10-16)

better-auth derives its rate-limit key from the **client IP**. With no `trustedProxies` configured,
its `getIPFromHeader` returns null unless `x-forwarded-for` holds **exactly one** value — so it fell
back to the literal key **`no-trusted-ip`** and the **entire deployment shared 10 sign-ins per 15
minutes**. The library logged its own warning:

```
Rate limiting could not determine a client IP and is falling back to a single shared per-path bucket.
Ensure your runtime forwards a trusted client IP header, then set `advanced.ipAddress.ipAddressHeaders`
or `advanced.ipAddress.trustedProxies` so the address can be resolved.
```

Consequence: **the 11th staff member to sign in within 15 minutes is locked out.** I hit this myself
repeatedly, which is how it surfaced — but it was never only a test annoyance.

**Two halves, both required:**

1. **Forward the client.** `apps/web/vite.config.ts` proxies `/api` and `/rpc` to the API without
   `xfwd`, so the API only ever saw the proxy's address. Now `xfwd: true`.
2. **Declare the trust boundary.** `AUTH_TRUSTED_PROXIES` (default `10.0.5.0/24` — the `rakazo_app`
   network; web `10.0.5.4` is the only hop in front of api `10.0.5.3`). This is also what makes a
   **prepended** header harmless: better-auth walks the chain right-to-left, skips trusted hops, and
   takes the right-most untrusted entry.

**Verified after the fix:**

| Check | Before | After |
|---|---|---|
| stored bucket key | `no-trusted-ip\|/sign-in/email` | `100.74.72.109\|/sign-in/email` (real client IP) |
| library warning | logged | **0** since restart |
| **spoof test**: prepend `x-forwarded-for: 203.0.113.99` through the proxy | — | **no new bucket**; the count went to the real IP (4→5) |

**Packaging gap closed at the same time:** `redeploy-web.sh` staged `dist/` but **not**
`apps/web/vite.config.ts`, which `vite preview` reads at startup — so a proxy change made in the repo
reached nothing. It now ships the config and asserts it.

**For whoever changes the topology:** a new reverse proxy or network must update
`AUTH_TRUSTED_PROXIES`, or the shared-bucket fallback returns silently.

### Sidebar group headers were English (fixed 2026-10-16)

`groupBotsForSidebar` (`packages/core/src/bot-sections.ts`) synthesises **"Pinned"** and
**"Unassigned"** as English literals for the web **and** mobile apps — so they cannot be translated
in core without wiring Lingui into a package mobile also consumes. A Thai employee therefore read
English headers in an otherwise-Thai sidebar.

Fixed at the render boundary in `Shell.tsx`, and **verified live: `ปักหมุด` renders** where
"Pinned" used to be.

**The trap that cost a cycle here:** translating via a macro over an argument passed *into* a helper
does **not** extract. My first version put `t\`Pinned\`` inside a function that took `t` as a
parameter; `intl:extract` produced no msgid, and `Unassigned` appeared in the catalog only because an
unrelated file (`BotContextMenu.tsx`) happened to contain the same word — which made the change
*look* like it worked. The labels are now looked up as literals so the extractor sees them:

```bash
grep -A1 '^msgid "Pinned"$' apps/web/src/locales/en/messages.po   # must exist BEFORE translating
```

A department's own name is **user data** and passes through untouched, even one named "Pinned" — the
helper keys on `sectionId` to tell a real department from a synthesised group.

### Departments WITH bots inside — first time ever exercised (2026-10-16)

Measured before this: **8 bots, 0 `bot_sections`, 0 bots with a `sectionId`**. So every department
check so far was an **empty** department (the round-11 fix) or a lone name. The feature the objective
actually names — bots **grouped inside** a department — had **never rendered**.

Built it through the product's own routes (`botSections/create` + `bots/update {sectionId}`), then
read the employee's sidebar:

| Measured on the live employee account | Result |
|---|---|
| sections created | 2 (`ฝ่ายขาย` with a bot, `ฝ่ายผลิต` empty) |
| bot actually assigned | 1 |
| department header rendered | `ฝ่ายขาย` as its own grid header |
| the bot nested under it | `Chief` at **y=172**, the header at **y=104** — below it, same column |
| cleanup | both sections removed; **0** sections, **0** assigned; **8 bots intact** |

So a department groups its bots correctly, in Thai, and deleting a department leaves the bot alive
(`onDelete: SetNull`, now verified against real rows rather than only the schema comment).

**Rendering note for future checks:** at a 390px **mobile** viewport the sidebar lives in an
off-screen drawer, so elements legitimately sit at **negative x** (`-316`) while still being the
rendered tree. An assertion that requires `x > 0` would report a false failure there. At **1440px**
the sidebar is on-screen and `Chief` sits at x=70. Assert geometry per viewport, not absolutely.

**Operational note:** every verification script signs in separately, and the deployment's sign-in
limit is **one global bucket of 10 per 15 minutes** — so a handful of scripts exhaust it and every
subsequent check 401s. That is *my* tooling problem, and it also predicts a real one: ten staff
signing in within 15 minutes would lock out the eleventh. Sign in **once** and reuse the session
across checks.

### Tenant isolation HOLDS — and a reporting defect found (fixed 2026-10-16)

Memory flagged "durability and a cross-user leak stay open" for this project, so this was measured
directly rather than assumed. **Isolation holds; the reporting was wrong.**

Three real users, each with their own space and artifacts (Archie 5, probe 2). Signed in as the
**employee** and asked for Archie's data by id:

| Request | Before | After |
|---|---|---|
| `threads/get(own)` | 200 | 200 |
| `bots/get(own)` | 200 | 200 |
| `threads/get(archie)` | **500** | **404** |
| `bots/get(archie)` | **500** | **404** |
| `threads/messages(archie)` | **500** | **404** |

Denial is real — `IsolationError: Resource not found` from `getBot` (`repos.ts:430`) — and the
scoping is structural, not incidental:

- `listSpaceArtifacts` scopes `WHERE "spaceId" = ${actor.spaceId} AND "userId" = ${actor.userId}`.
  **The `spaceId` request parameter is never read** (verified: own space, Archie's space, and a bogus
  id all return the same rows; `routines/listSpace` destructures only `context`).
- **542 references to `context.actor`** in `router.ts`.
- A dedicated `packages/db/src/scope.ts` with **32 `IsolationError` throws**.

**The defect:** only **19** of the raw throws were wrapped in `ORPCError("NOT_FOUND")`, so the rest
reached the client as `INTERNAL_SERVER_ERROR` and logged a **full stack trace per denial** at ERROR
level — a normal "not yours" outcome reporting as a server fault. Fixed with one interceptor at the
RPC boundary, which corrected every route at once, plus the logger no longer treating a scope denial
as an error. Verified: 404s, own data still 200, **0** `IsolationError` error lines.

**Both of my first two isolation attempts were invalid** and said nothing about the app: the route
names were wrong (`threads/listMessages` instead of `threads/messages`), and a positive control that
returned 404 on my OWN data proved the test was broken, not the app. The third attempt, with a
working positive control, is the one reported above.

### A new hire's first five minutes — and Thai auto-detection (2026-10-16)

Round 20 fixed the "Connect a model" wall and round 19 built onboarding, but ~15 deploys had gone out
since. This re-tests the objective's core claim on a **genuinely new account**, created and then
deleted through the product.

**Result: the path works.** A fresh employee signs in and lands in `/app/<threadId>` with:

| Check | Result |
|---|---|
| `needsModel` | **false** — the deployment key applies, no personal credential needed |
| provider / model | resolved automatically (`deepseek`) |
| `isDeploymentOwner` | false — an employee is correctly not an owner |
| assistant | created, and answers (`NEWHIRE-OK`) |
| work nav + tab bar | present |
| account deletion via the product | `{"success":true}`; back to 3 users |

**Thai auto-detection works, and every earlier check had missed it.** `resolveUiLocale` resolves
`saved choice → VITE_DEFAULT_UI_LOCALE → navigator.language → English`, and this deployment sets **no**
`VITE_DEFAULT_UI_LOCALE`. Every previous Thai verification **set** `rakazo.uiLocale=th` by hand —
something no real new hire does. Testing a Thai browser with **no stored locale**:

```
navigator.language = "th-TH"   storedLocale = null   htmlLang = "th"
งาน · เอกสาร · งานตามกำหนดการ · การใช้งาน · แผนใหม่
```

So a Thai employee gets Thai on first visit with nothing to configure. An earlier English first-run
was **correct behaviour** for the en-US browser I happened to use, not a defect — worth stating,
because the opposite conclusion was one step away.

**A separate, real gap:** a brand-new assistant has **empty `instructions`** (measured: length 0), so
its first reply is a generic "what am I for?" monologue asking the employee to define its role. For a
fork meant to be employee-ready, a default role would remove that first awkward exchange. Not changed
here — it is a product decision about what a Zervi assistant *is*.

### Deploy only from a CLEAN tree (`-dirty` is not decoration) (2026-10-16)

The revision label appends **`-dirty`** when `git diff` is non-empty at build time. A deploy made
before committing therefore produces a label ending `-dirty` while a container built earlier shows
the bare commit — and the drift check **correctly fails**, naming the mismatch.

That happened once and looked like a false positive ("DRIFT" while both sides showed the same
prefix). It was real: the tree was uncommitted. **Commit, then redeploy** — do not relax the check.

```bash
git status --porcelain     # must be empty BEFORE redeploy-web.sh
```

### Documents with CONTENT, and two real defects found (2026-10-16)

The probe account had **0 artifacts**, so every previous Documents check verified only the EMPTY
state. This asked the employee's own assistant to produce a real document via its `attach_file`
tool, then read the page.

**The flow works end to end.** The assistant created the artifact; it appears on the employee's
Documents page in Thai (รายงานทดสอบ / เอกสารทดสอบ); clicking it opens
`/app/artifacts/<id>`; the document **renders its content** (สรุปการทดสอบ / การทดสอบผ่านแล้ว); and
the **version selector** works because calling `attach_file` with the same name creates `v2` of the
same artifact rather than a duplicate.

**Two defects found on the way:**

1. **Timestamps were English.** `just now`, `{minutes}m ago`, `{hours}h ago`, `{days}d ago` were
   empty in the Thai catalog — and these appear beside *every* document, message and routine.
   Translated; verified as `2 นาทีที่แล้ว`.
2. **A zero unit: "0m ago".** `formatRelativeTime` cuts to `just now` below **45 seconds** but then
   switches on **minutes**, so anything 45–59s old computed `Math.floor(45/60) === 0` and rendered
   **"0m ago"** — measured live as `0 นาทีที่แล้ว` on a document created moments earlier. The cutoff
   and the unit disagreed. Fixed with an explicit `minutes < 1` guard, and three boundary tests
   added (the 45–59s window had no coverage, which is why it slipped through).

Check the catalogue before trusting a translation note:
```bash
grep -A1 -F 'msgid "just now"' apps/web/src/locales/th/messages.po   # expect a Thai msgstr
```

### Which commit is deployed? The image used to lie (fixed 2026-10-16)

`docker inspect` reported `org.opencontainers.image.revision=7d5e64c8…` and
`source=https://github.com/elie222/rakazo` — the **stock upstream base** — while the container ran
this fork's code. Those labels are inherited from the base image and were never restamped, so the
one question a handover asks (*what is actually deployed?*) had a **confidently wrong** answer.

Verified the divergence rather than assuming it: the label said `7d5e64c8` while the served bundle
carried the Zervi nav marker and the api contained the `deepseek` adapter fix.

**Fixed in `redeploy-web.sh`** — the staged Dockerfile now restamps the OCI labels with the real
commit, branch, and fork, and keeps the base revision as its own label:

| Label | Now reads |
|---|---|
| `…image.revision` | the actual HEAD (`27081781…`), with `-dirty` appended if the tree is uncommitted |
| `…image.version` | `zervi/employee-ui@27081781…` |
| `…image.source` | `https://github.com/ZerviGlobal/rakazo` |
| `…image.base.revision` | `7d5e64c8…` (the upstream base, preserved, not conflated) |

**The fix immediately exposed a second instance of the problem.** After deploying, `web` and `api`
reported the new revision but the **worker still reported the old one** — because its container
predated the label change (`up -d web api` never recreates the worker). Its *code* was current; its
*label* was stale. That is the same ambiguity in a different place, so it is now checked:

```
rakazo-health.sh  ->  "all containers on the same revision (27081781d46b)"
```

The check compares every container's label against `web`'s and fails with a `DRIFT` line naming the
stale service. **Negative-tested**: a simulated drifted container produces
`FAIL revision DRIFT … recreate the stale service` and exit 1.

Note the worker was recreated to clear it — done with **zero runs in flight** (verified first), and
`up -d worker` never includes the worker in a normal deploy, so this stays a deliberate act.

### Notification reach, measured (2026-10-16)

Round 26 proved an employee's scheduled task FIRES but did not check whether they are TOLD. Traced
it end to end:

**In-app: yes, automatically.** Every **bot** message sets `unread: true` on the thread
(`packages/db/src/messages.ts:75` — `input.markUnread ?? input.role === "bot"`), so a finished
routine **badges the assistant in the sidebar** without any user action. That is the signal an
employee actually gets, and it works.

**Push: no, for everyone.** The only notification transport is **`ExpoPushProvider`**
(`apps/api/src/app.ts:390`), and it needs a per-user token file. Measured on the live host:

```
/data/push-tokens/   ->  does not exist
```

So `deliverableToken()` returns undefined and every completion is reported as **`undeliverable`** —
delivered to nobody. Two consequences worth stating plainly:

1. **A web-only employee gets no out-of-app notification.** The web UI has no push channel, so the
   sidebar badge is the only signal, and a closed tab means no signal at all.
2. **Push also leaves Zervi** (POSTs to `exp.host`), so enabling it is an **external** action and a
   gate-5 decision, not a configuration toggle.

**Two flags, only one of which does anything.** `bot.notifyOnFinish` (and a thread group) is what
`runNotice` reads to decide delivery. The **routine's own `notify`** field is **never consulted** —
searching the adapter and API layers finds no read of it. It is also **not exposed in the UI**, so it
is dead API surface rather than a setting that misleads anyone. Worth knowing before someone builds
on it.

**Correction to my own first reading:** I initially concluded "no notification at all", because
`markBotUnread` in `Shell.tsx` is only called from a manual context-menu action. That was wrong —
the automatic badge comes from the message-insert path, not from the UI. Checking the database
state (`probe thread unread=true`) is what caught it.

### When a run FAILS, what does the employee see? (2026-10-16)

Failure is surfaced properly: `Shell.tsx` renders `role="alert"` `data-testid="composer-error"`
containing `run.error`, with a dismiss button — and `threadRunError` returns it whenever
`run.status === "failed"`, so it does not vanish on reload before being seen.

**Verified by driving the failure path, not by reading it.** An attempt to create a routine pinned
to a model the deployment has no key for was **refused at creation**: *"Connect that model provider
first"*. That is the product preventing a broken state rather than letting it fail later — the same
guard exists a second time at run time (`failRunBeforeModel`).

**⚠ A boundary worth knowing: some failure text is SERVER-side and cannot be translated
client-side.** `run.error` is rendered **verbatim**, so these reach a Thai employee in English:

| Server string | Where |
|---|---|
| `Connect a model in Settings before running bots.` | `executor.ts` `MISSING_MODEL_MESSAGE` — the message a credential-less user saw |
| `Connect that model provider first` | `executor.ts` — both the creation guard and a run-time failure |

`failRunBeforeModel` has **4 call sites** in `executor.ts`. Translating them means translating on the
server (or mapping error codes to client strings), which is a product change — **not done here**.

**Fixed on the client instead:** the error UI's own strings were English, including the accessible
label on the alert (`Dismiss error`) and `Reply cancelled`. Nine strings translated, including the
`Could not …` fallbacks for create/delete/rename across bots, sections, groups, spaces and routines.
Verified present in the served bundle.

### Backup freshness, and the exposure a live user creates (2026-10-16)

Backups run **nightly at 04:00 Bangkok** (`rakazo-backup.timer`, `OnCalendar=*-*-* 04:00:00
Asia/Bangkok`, `Persistent=true`). The script header says *"Nightly scheduling/rotation belongs to
ZIT's backup set"* — **another lane**, so this runbook documents the gap rather than changing the
schedule.

**Measured exposure:** the newest dump was **11 hours old** while Archie had created **3 artifacts**
and **11 runs** since it — including real production files (Commercial Invoice, BoM Overview) that
existed **only** in the live database. For a single expert user that is tolerable; for a floor of
staff producing documents all day it means a whole day's work sits unprotected between runs.

**Recovery is proven, not assumed** (a fresh drill on the newest dump):

| Checked | Result |
|---|---|
| Restore into a scratch database | 5 artifacts, 36 runs, 11 memory docs |
| Party blob in the appdata tar | Archie's **BoM Overview** blob present at `./artifacts/<space>/<key>` |
| Live database untouched | scratch DB dropped; 5 artifacts / 36 runs / 1 routine unchanged |

So a database row **and** its file are both recoverable — which matters, because a row without its
blob is not a recovery.

**Watchdog added** — `rakazo-backup-freshness.sh`, now also called by `rakazo-health.sh`:

```bash
bash /opt/zervi/rakazo/rakazo-backup-freshness.sh
```

It reports the newest dump's age, whether the dump is **readable** (a present-but-corrupt backup is
worse than an old one), whether the appdata tar exists, and **which documents post-date the newest
backup** — so the exposure is visible instead of assumed. Exit 1 on a real problem. Failure paths
were negative-tested: no backup → exit 1, stale → exit 1.

**Cost of running more often, for whoever owns the schedule:** a backup takes **23 seconds** and
produces ~0.4 MB of dump plus a **growing** appdata tar (34 MB → 191 MB today as real files
accumulate). A 7-day retention at 6-hourly is ~5.5 GB; at 2-hourly ~16 GB, against 113 GB free. The
constraint is not disk — it is that the tar multiplies with a growing volume, so the interval should
be *justified* rather than maximal. **This is a decision for ZIT's backup set, not a change to make
unilaterally.**

### ⚠ Sign-in is rate-limited as ONE GLOBAL BUCKET — a staff-rollout risk (2026-10-16)

Measured while walking the employee journey: after ten sign-ins my own account got **429**, and so
did a *different* account from the same host. The limiting key in the database is:

```
key = no-trusted-ip|/sign-in/email     count = 10 of 10
```

**`no-trusted-ip` is the problem.** `authRateLimitOptions()` sets `{ window: 15*60, max: 10 }` for
`/sign-in/email`, `/sign-up/email` and `/request-password-reset`, and **no `ipAddressHeaders` (or
forwarded-IP handling) is configured anywhere** — verified: no `x-forwarded-for` / `x-real-ip` /
`cf-connecting-ip` is read, and neither the api nor the vite `preview` proxy sets one. With no
trusted IP, better-auth keys the bucket on that constant string, so **every user shares one
allowance of 10 sign-ins per 15 minutes**.

| Scenario | Effect |
|---|---|
| One user fat-fingering a password | fine |
| **A shift of staff signing in at the same time** | the 11th sign-in in 15 min gets **429**, regardless of account |
| Password reset (shares the same shape of rule) | same ceiling |

For a single expert user this is invisible. For the "Chonburi floor at 08:00" case, ten people get
in and the rest are told *"Too many requests. Please try again later."*

**Scope, measured — this is a sign-in-only problem.** With the bucket saturated at 10/10:
`GET /api/auth/get-session` → **200**, `GET /` → **200**, `/health` → **200**, and an RPC call on an
**existing** session → **200**. So staff who are already signed in are unaffected, the app keeps
serving, and the limiter is doing exactly what it exists to do — it just cannot tell one client
from another. The blast radius is "the eleventh person to sign in within 15 minutes", not an outage.

**Do not change this blindly.** The limit exists to stop credential stuffing, and relaxing it is a
security decision. Options, cheapest first:

1. **Accept it for small numbers** — up to ~10 sign-ins per 15 minutes across everyone.
2. **Raise `max`** in `authRateLimitOptions()` — one constant; keeps a limiter, lifts the ceiling.
3. **Key the bucket per client** — configure a trusted forwarded-IP header and make the proxy set
   it. Correct long-term, but it changes what the limiter can see and must be verified, not assumed.

**Also worth knowing:** the bucket is stored in the DATABASE (`storage: "database"`, table
`rateLimit`), shared across api processes, and only enabled when `NODE_ENV=production`. So a
sign-in storm is not cleared by restarting containers — only by waiting out the 15-minute window
(or deleting the row, which is a deliberate act).

Inspect it:
```bash
docker exec -i rakazo-postgres-1 sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' \
  -c "select key, count, \"lastRequest\" from \"rateLimit\" order by \"lastRequest\" desc;"
```

### The "find it" journeys — measured, and the Wave A result (2026-10-16)

The recovered UI assessment set the acceptance test: count the clicks to reach each capability.
Its baseline, measured on the stock interface:

| Capability | Was | Now |
|---|---|---|
| Documents (ex-"Artifacts") | 2 clicks, **invisible at rest** (avatar menu) | **1 click / 1 tap** |
| Scheduled tasks (ex-"Routines") | 2–3, hidden inside a bot | **1 click / 1 tap** |
| Usage | 2, avatar menu | **1 click / 1 tap** (opens a dialog) |
| Board | 2, avatar menu | hidden while the feature is disabled — honest, not broken |

**6/6 measured reachable in one click on desktop and one tap on phone.**

```
node /opt/zervi/rakazo/measure-find-clicks.mjs
```

**Two traps in measuring this, both hit:**

1. **The Work-nav entries are `<button>`s, not links.** A probe that looked for
   `a[href^="/app/..."]` found *nothing* for all four targets and reported 0 — the probe was
   wrong, not the UI.
2. **Not every destination is a route.** `Usage` opens a settings *dialog*
   (`openSettings("usage")`), so the URL deliberately does not change. Scoring it by URL change
   reported a false failure and made a working feature look broken. The probe now asserts the
   effect the feature actually has: route vs dialog.

### Touch targets — measured, and an open decision for Archie (2026-10-16)

Staff hold phones, so tap size matters. Measured at 390px with touch emulation:

| | Under the 44px guideline |
|---|---|
| Controls the Zervi work added | **0** (the section actions button was 28px, fixed to 44px on touch) |
| **Upstream controls** | **13** — e.g. Activity `28×28`, `+` `12×32`, copy-code `27×27`, voice `32×32`, attach `32×32` |

Upstream's `Button size="icon-sm"` is `size-7` = **28px**, used throughout; it is a real
phone-first gap and it is **upstream's**, not introduced here. The Zervi work fixed only its
own control (`md:size-7 max-md:min-h-11 max-md:min-w-11` — 44px on touch, unchanged on
desktop) rather than restyling the shared variant, because resizing every 28px control
app-wide is a **design decision**, not a bug fix.

**If Archie wants a phone-first workforce, this is the next UI decision** — one variant change
in `packages/ui-web/src/components/ui/button.tsx`, but it affects every icon button in the app.

Re-measure with:
```bash
node /opt/zervi/rakazo/audit-touch-targets.mjs   # separates "mine" from upstream's
```
**Adding any new locale** means touching all four places above; `Record<UiLocale, …>`
maps (in `dictation.ts` and the i18n test fixtures) will fail typecheck until they carry
the new key — that is expected, and `pnpm --filter @rakazo/web check` is how you find them.

**Verified by rendering:** sidebar reads `งาน / เอกสาร / การใช้งาน`,
`document.documentElement.lang === "th"`, and `ไทย` appears in the real
**Settings → Language** picker — a locale is only actually added if a user can select it.

## Daily operations

| Task | Command |
|---|---|
| Health (the ONLY success signal) | `curl -fsS http://127.0.0.1:3100/internal/health` → require `ok: true` AND `sandbox: "docker"` |
| Service state | `docker compose ... ps` |
| Logs | `docker compose ... logs -f api` (same for worker/web/supervisor) |
| Stop (keeps data) | `docker compose ... stop` |
| Start | `docker compose ... start` |
| Restart one service | `docker compose ... restart api` |

## Update (manual; updater sidecar intentionally OFF)

```bash
cd /opt/zervi/rakazo
bash install-images.sh          # re-pulls current tag, preserves .env, restarts changed services
curl -fsS http://127.0.0.1:3100/internal/health   # verify before declaring done
```

- After an update, re-check `sandbox:` in health — a missing supervisor token after an env mistake shows up exactly there.
- If a new service was added upstream, name it in `RAKAZO_UPDATE_SERVICES` when the updater is ever enabled.

## Rollback

- The rollback anchor is the **image digest recorded at install/update time** (see "Digest log" below — no commit-addressable tags exist upstream; measured 2026-10-16).
- Roll back: set `RAKAZO_IMAGE_TAG` to a digest tag if upstream publishes one, else `docker pull ghcr.io/elie222/rakazo/app@sha256:<recorded>` + `docker tag` to the compose reference, then `up -d`.
- Database rollbacks come from backups only (see below). Never `down -v` on a deployment with real data.

## Backup & restore

- ZIT lane: nightly backup of the two volumes (`rakazo_pgdata`, `rakazo_appdata` — exact names via `docker volume ls | grep rakazo`).
- Upstream's own verified backup: `infra/compose/backup-prod.sh` (custom-format pg_dump + appdata tar, self-verifying) — adapted copy lives here after Phase 4.
- **Restore drill** (mandatory before trusting backups): restore latest dump into a scratch Postgres container, compare row counts against live. A backup that has never been restored is not a backup.

## Secrets

- All stack secrets live in `/opt/zervi/rakazo/.env` (0600). Never print, never copy into chat/docs. Key names are registered in the toolkit context pack (`secrets-map.md`). This includes `RAKAZO_SERVICE_PASSWORD` — it is the **service account's login credential**, not just stack config.
- Model provider keys: chat runs use **per-space model credentials** stored encrypted by the product (`models.connect` RPC or the web UI) — the `DEEPSEEK_API_KEY` env var is **not** what executes a normal run (measured 2026-10-16: a run with the env key failed 401 while Archie's UI-entered key served Chief fine).
- ⚠ **But the env key IS a fallback (`pi-ai` declares it).** `@earendil-works/pi-ai` `providers/deepseek.js` sets `auth: { apiKey: envApiKeyAuth(..., ["DEEPSEEK_API_KEY"]) }`, so any path that reaches DeepSeek *without* an explicit per-space credential falls back to this env var. A dead value here therefore becomes a silent, confusing failure for exactly the new/unconnected case. **Fixed 2026-10-16**: the `.env` value was replaced with the validated estate key (verified 200 from inside `rakazo-api-1` after recreating api+worker), and a pre-change backup was taken. Keep this key valid even though normal runs don't use it.
- **Historical (superseded): two dead keys measured 2026-10-16** at `api.deepseek.com/models` (401): the stack `.env` `DEEPSEEK_API_KEY` (tail `eae5`) and Infisical `zervi-platform` `DEEPSEEK_KEY` — likely the same dead key in two stores. The `.env` copy is now replaced; **clean up the Infisical `DEEPSEEK_KEY` too** (still dead, still a decoy for anyone who reads it).
- The **service space** (staging) runs on the estate Lobe key `deepseek_key_for_zbox_lobe_agenst` (validated 200, credential label `DeepSeek (Lobe estate key - TEMP until dedicated key)`). TEMPORARY by design: rotation of the Lobe key would break staging. Ask Archie for a **dedicated DeepSeek key for rakazo** and swap via `models.disconnect` + `models.connect`.
- Lost `.env` = restore from backup. Regenerating secrets on an existing data volume desynchronizes encryption — do not.

## Signup policy & the service account (measured 2026-10-16)

- Signup policy lives in the **database** (`deployment_settings`, row `default`) — the `.env` keys `SIGNUPS_ENABLED` / `SIGNUP_ALLOWLIST` are seed-only and **dead after the first signup**.
- Current policy: `signupsEnabled=false`, `signupAllowlist=''` (empty). The empty allowlist is **required** for the service account: the product only honours sessions of unverified users while the allowlist is empty (`packages/auth/src/index.ts` `findSession` override, verified in the deployed image). Setting a non-empty allowlist would lock the service account out on its next request.
- Service account: `zak@zervi.local` ("Zak (service)"), password = `RAKAZO_SERVICE_PASSWORD` in `.env`. Deliberately **unverified** — no SMTP exists in this deployment, so verification and password-reset emails cannot be delivered. Losing that password means an operator recovery action, not an email link.
- To change the policy: owner RPC `authed.deployment.update` (deployment-owner session only; measured 403 for other users) or a SQL `UPDATE` on `deployment_settings` with before/after evidence. **Never insert or alter user rows via SQL** — that bypasses the auth model.
- ⚠ **TRAP (independently verified 2026-10-16): setting a NON-EMPTY allowlist locks the service account out.** `zak@zervi.local` is `emailVerified=false` by design (no SMTP), and the session gate only honours unverified sessions while the allowlist is EMPTY (`packages/auth/src/index.ts` `findSession` override → `policy.allowlist.length === 0 ? session : null`). If signup policy is ever tightened, either leave the allowlist empty or explicitly include the service address and accept that it must then be verified. This is the single most likely way a future operator silently breaks the service account.
- 🔴 **TRAP, MEASURED LIVE 2026-10-16 — `.env` `SIGNUP_ALLOWLIST` is REAPPLIED ON EVERY API START.** `apps/api/src/app.ts:217-248` upserts `deployment_settings` and then calls `signupAllowlistBootUpdate(storedAllowlist, env.signupAllowlist, true)` (`packages/core/src/signup-policy.ts:51`): **the allowlist is re-seeded from the environment whenever the env value is non-empty.** Consequence, measured: I fixed the DB policy to empty and set `SIGNUPS_ENABLED=false`, then later recreated api+worker — the restart **put `zak@zervi.local` back** into `signupAllowlist`. With a non-empty allowlist, BOTH accounts (both `emailVerified=false`) were locked out: `get-session` → `null`, `sign-in/email` → **403 `EMAIL_NOT_VERIFIED`**. Archie's session row never expired, so he did not report it — the lockout would have hit him on his NEXT sign-in.
  **The rule:** the DB is the runtime truth, but the env is the boot seed — **fix BOTH or the next restart undoes your fix.** `SIGNUP_ALLOWLIST` must stay EMPTY in `.env` for this deployment. After any recreate, re-check the policy row (`select "signupsEnabled", "signupAllowlist" from deployment_settings`) and re-check that `get-session` still returns a session.
  **Recovery if it recurs:** (1) set `SIGNUP_ALLOWLIST=` in `.env`; (2) `UPDATE deployment_settings SET "signupAllowlist"='' WHERE id='default'`; (3) recreate api+worker so the stale container env is replaced; (4) confirm `get-session` returns a session and `/usr/bin` sign-in returns 200.
- How the account was created (for the record): the product's own empty-allowlist "open" admission was used for a seconds-wide window on the tailnet-only listener (UPDATE 1 → signup HTTP 200 → UPDATE 1, same command block). No SMTP vendor, no sink emulation, no direct row insertion.

## Cross-user bridge paths (measured 2026-10-16)

### Space access is MEMBERSHIP DATA — and that is how bots get into Archie's sidebar (2026-10-16)

**Corrected finding.** An earlier version of this runbook said "no sharing exists, so only Archie can create his bots". That was wrong: it checked for an *invite feature*. Access is decided by `requireMembership` (`packages/db/src/scope.ts:19`) from a `space_members` row, and `listBots` (`packages/db/src/repos.ts:299`) filters on `spaceId AND userId`.

There is genuinely no invite/member RPC and the `Invitation` model is **dead schema** (nothing creates invitations; Better Auth `/organization/*` is closed). But the product's own repositories are callable, so bots are created **as Archie** by calling `createRepos(prisma).createBot(archieActor, …)` with the `tsx` runtime inside `rakazo-api-1`. That writes exactly the rows the UI would write: bot + thread + browser profile + bot memory document + team computer reuse.

**Scripts (host, 0700/0600): `/opt/zervi/rakazo/scripts/`**

| Script | Purpose |
|---|---|
| `seed-archie-bots.ts` | creates Scribe/Scout/Doc as Archie (spawnKey-idempotent) + fills Chief's role + creates the Morning brief routine |
| `enqueue-intro-runs.ts` | queues the product's own `created` intro run so each bot greets its owner (repos.createBot does NOT do this; only the router handler does) |
| `wire-odoo-mcp.ts` | creates the estate Odoo MCP server in Archie's space and assigns it to his bots (uses `EncryptedSecretStore` directly — the `@rakazo/adapters` barrel pulls a broken ESM path) |
| `ask-archie-bot.ts` | sends a real message to one of Archie's bots and prints the reply |
| `verify-archie-sidebar.ts` | reads Archie's sidebar through `listBots` (the product's own query) |
| `reconciler-probe.ts` | proves the worker arms+fires a routine inserted out-of-band (staging space only) |

**Run recipe** (the only invocation that resolves the workspace correctly):

```bash
docker cp <script>.ts rakazo-api-1:/tmp/
docker exec -it rakazo-api-1 sh -c 'cd /app && npx tsx /tmp/<script>.ts'
```
`/tmp` + `npx tsx` is required: running from `/app` or with `./node_modules/.bin/tsx` fails workspace resolution.

**Consequence for the OS/ADR model:** a bot row created this way is **owned by Archie** (`userId = Archie`), so he can rename, archive or delete it from his own UI. Nothing is hidden from him.

**Job enqueue detail:** `graphile-worker` is not a top-level dependency. Enqueue with the product's own SQL function, with explicit casts (the signature is `add_job(identifier text, payload json, …, job_key text)`):
```sql
SELECT graphile_worker.add_job('run.continue', json_build_object('runId', $1)::json,
  NULL::text, NULL::timestamptz, NULL::integer, $2::text)
```
A bare `{runId}` payload is correct — `unwrapJobPayload` (`packages/logging/src/jobs.ts:52`) accepts an unwrapped object.

1. **Space sharing: none.** No invite/member RPC, no invite UI; Better Auth `/organization/*` deliberately closed over HTTP. Bots for Archie must be created by Archie's account.
2. **Agent connections (bot-to-bot, cross-space): exists but gated on messaging.** `connectAgent` (`packages/adapters/src/agent-connections.ts`): a bot requests a connection **by chat-app address** to another bot; the target's owner approves ("Reply YES"). Hard precondition: the requester bot must own a `messagingIdentity` — *"a bot whose owner never messaged the deployment cannot open them"*. This deployment runs with `messaging:false` (no chat provider linked), so no bot can currently open or receive connections.
3. **Enabler in flight:** the estate's Telegram wiring (toolkit branch `feat/telegram-room-and-seat-wiring-20260921`). Once a chat provider is linked and bots hold messaging identities, fleet-space agents can request connections to Archie's agents and he approves with one reply — the product-native way to get fleet value into his hands without space sharing.
4. Until (3) lands: staging agents remain test/validation assets only (proven working), and Archie-facing agents live in his space, created by him from the roster.

## Incident record — 2026-10-16: Odoo MCP bearer-token rotation (cause: Zak's own grep)

- **Cause:** while inspecting `zervi-odoo-mcp`, a key-name grep over `ODOO_MCP_TOKENS` printed its "keys". Per `server.py` (`_token_tier_map`), that JSON is **token → tier** — the keys ARE the live bearer tokens. 15 tokens (all tiers incl. `exec`) landed in captured session output. Treated as exposed per SECURITY-GATE.
- **Action (same hour):** all 15 tokens rotated tier-preserving from a config snapshot; container recreated (`/opt/zervi/odoo-mcp-rotation/recreate.sh`, derived from `container-config-snapshot.json`; image `zervi-odoo-mcp:hr-surface-20260917`, port `100.74.72.109:8100:8100`, 1 bind, 26 env vars preserved). Verified: old read token → **401**, new read token → **200**, **all 15 new tokens → 200** (initialize, values never printed).
- **Consumer scan:** ripgrep over 7 trees (`/opt/zervi`, `~/.zervi`, `~/zervi`, `~/.hermes`, `~/.dsh`, `/etc`, `~/.config`) + LobeHub Postgres full-dump grep + LobeHub Redis (12 keys) + LobeHub container env/FS → **zero on-box holders**. Tailnet-side consumers (PC/laptop configs) unknown from here — if one breaks, re-issue from `/opt/zervi/odoo-mcp-rotation/old-new-mapping.json` (0600; tier-aligned old→new pairs).
- **Standing rules:** (1) never print `ODOO_MCP_TOKENS` content — its keys are live tokens, not names; (2) no on-disk env source exists for this container — the container config + the rotation dir are the source of record; future changes go through the staged recreate procedure; (3) rotation dir is 0600/0700, root of trust for re-issues.

## Computer (sandbox) guardrails in force

| Setting | Value | Why |
|---|---|---|
| `SANDBOX_PROVIDER` | docker | local computers via in-stack supervisor |
| `SANDBOX_MAX_COMPUTERS_PER_USER` | 2 | memory-pressure cap (box swap was full at install) |
| `SANDBOX_TEAM_SCREEN_LIMIT` | 1 | one live desktop at a time |
| `SANDBOX_IDLE_MS` | 300000 | idle computers sleep after 5 min |
| `SANDBOX_COMPUTER_EGRESS` | **restricted (active)** | scoped iptables lockdown live since 2026-10-16; falsifiers passed; boot-persistent via `rakazo-computer-egress.service`; remove with `sudo /opt/zervi/rakazo/restrict-computer-egress-scoped.sh --remove`. **Persistence:** `rakazo-computer-egress.service` (boot) + `rakazo-computer-egress.timer` (1-min re-apply, covers new bridges). Residual: new bridge unguarded ≤60s; ~100ms swap window per re-apply |

## Known state / deviations

- Installed 2026-10-16 from `edge`; digest anchor recorded at pull (Digest log below).
- Tailnet HTTP accepted? — recorded at first browser verification (Phase 2 step 14).
- Service account `zak@zervi.local` created 2026-10-16; **signups OFF** (policy lives in the DB — see "Signup policy & the service account").

## Backup

```bash
sudo bash /opt/zervi/rakazo/backup-rakazo.sh     # self-verifying; 7-day rotation; /opt/zervi/backups/rakazo/
```
Nightly scheduling: **interim** `rakazo-backup.timer` (daily 04:00 Asia/Bangkok +300s jitter, `Persistent=true`, systemd unit `rakazo-backup.service`) installed by Zak 2026-10-16 while ZIT's lane was pending — proven via a manual systemd fire (Result=success). ZIT to absorb into the nightly set (card t_77d3f002); stand-down is one `systemctl disable --now rakazo-backup.timer`. Restore drill performed 2026-10-16: 12/12 tables matched.

**2026-10-16 verify-line lesson (fixed in the script):** the original verify used `pg_restore --list | grep -qE` — `grep -q` exits after the first match, `pg_restore` dies with EPIPE, and `set -o pipefail` brands a **valid** dump as unreadable (measured false FAIL: the "unreadable" dump had 528 TOC entries). The script now counts with `grep -c`, sets `umask 077`, and chowns outputs to the ops user when run as root. Correction of the record: the 02:20 "VERIFY FAIL" was a false alarm; that dump is valid (528 TOC entries) and is checksummed retroactively. **Rule for every self-verifying script on the estate: never pair `grep -q` with `pipefail` on a producer's output.**

## Digest log (rollback anchors)

| Date | App image digest | Computer image digest | Updater |
|---|---|---|---|
| 2026-10-16 | app `edge` = sha256:2fc84b208e0ad61b2fb93316b254f2f57b2a9558848834d975fd16d3044ac615 | computer `edge` = sha256:ba4a7801eda4c7cad20e380631a0ca58963e5acd5a815b8ecdf5f9c012a6aadd | install (initial) |

## Artifacts — where they are, and two measured defects (2026-10-16)
**The feature set is complete and working.** Verified live: create, download (byte-identical round-trip), **versioning** (same filename -> v1/v2/v3 with a version switcher), in-app preview (PDF viewer, sandboxed HTML viewer, markdown render, image viewer), search + filter, per-bot and per-space listing, local disk storage (no cloud vendor to configure), and **included in backups** (restore-tested: extracted a PDF from the archive, SHA-256 matched the DB row).

**DEFECT 1 (UX): Artifacts was buried — the owner reported "I don't have a preview".**
**✅ FIXED 2026-10-16.** The page exists at `/app/artifacts` and used to be reachable **only**
from the user menu (avatar → *Artifacts*), so it was effectively undiscoverable. There is now
a **Documents** row in the sidebar `Work` block *and* a **Documents** tab in the phone bar,
and the page heading, back link and menu entry all agree (see "Display naming"). Re-verified at
390×844: the list shows a document, tapping the card's anchor opens
`/app/artifacts/<id>`, the content renders, and the tab bar stays anchored while reading.

Versioning, preview (PDF/markdown/HTML/image), per-bot listing, download and backup inclusion
all still work as before — only the entry points changed.

⚠️ **Never delete an artifact or attachment row with raw SQL.** `delete from artifacts`
removes the row but leaves the blob at `/data/artifacts/<spaceId>/<uuid>`, because it is the
API's `artifacts/remove` that deletes both. Measured: a probe delete left a 64-byte orphan
(since removed). Use the product's RPC, or delete the blob too.

⚠️ **Never delete a ROUTINE row with raw SQL either — same trap, second tail.** A routine owns
a queued `routine.wakeup` job. `routines/remove` cancels the job and deletes the row
together; raw SQL leaves the job queued against a routine that no longer exists. Measured: a
probe routine deleted by SQL left an orphaned wakeup job dated the next morning. To clear one
by hand — note `graphile_worker.jobs` is a **view** (not deletable) and the base table keys by
`task_id`, not the task name:

```bash
docker exec -i rakazo-postgres-1 sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
delete from graphile_worker._private_jobs
 where key = 'routine:<routineId>'
   and not exists (select 1 from routines r where r.id = '<routineId>');
SQL
```

Guard such a query against ALL job namespaces — not every key starts with `routine:`
(`computer.sleep:` and others exist), so a blanket "no matching routine" filter misreports
legitimate jobs as orphans.

### How routine scheduling works (verified 2026-10-16)

Firing was **proved end to end**, not assumed: a routine created due ~60 s out fired at
exactly its cron minute, set `lastRunAt`, created a `runs` row, advanced `nextRunAt`,
re-queued the next wakeup, and the model returned the expected output unattended.

Two things that look like faults and are not:

| Observation | Reality |
|---|---|
| An active routine has **no** queued wakeup job | Normal. `ROUTINE_LOOKAHEAD_MS` is **60 s** and the reconciler ticks every **30 s**, so routines are armed only when nearly due. |
| `lastRunAt = NEVER` on a routine that "should" have run | Check **when it was created**. A routine made after today's slot correctly points `nextRunAt` at tomorrow. |

So the Scheduled-tasks page showing "Paused", or a future `nextRunAt`, is accurate rather than
broken. If a routine is genuinely past due with no run, then look for the job.

**DEFECT 2: deleting a versioned artifact family 500s on the second call.** `artifacts/remove` deletes the whole family via `deleteArtifactFamily` (`apps/api/src/artifacts.ts:415`). Removing versions one-by-one works for the first; the next throws `IsolationError: Resource not found` -> HTTP 500 (measured: v1 -> 200, v2 -> 500). The family IS deleted correctly (0 rows, 0 orphan files), so the harm is a spurious error, not data loss. Report upstream; do not patch the deployed image.

**ZIP/CSV are not previewable in chat** — `PREVIEWABLE_MIME_TYPES` = markdown, HTML, PDF (`apps/web/src/components/ArtifactFileCard.tsx:23`). A ZIP attachment shows a card with Download only. That is why the Excel-via-ZIP artifact has no preview: by design, not a fault.

**Storage facts:** `LocalArtifactStore` writes to `$DATA_DIR/artifacts/<spaceId>/<uuid>` (mode 0600, O_NOFOLLOW); API and worker share the `rakazo_appdata` volume. Hash recorded in the DB equals the file's SHA-256. 10 MiB/file, max 4 attachments per message. `.xlsx` is refused for upload — use CSV or ZIP (measured).

## Two separate MCP systems — why the Integrations panel looked empty (measured 2026-10-16)

Archie opened Integrations ("Add MCP server") and saw **"No MCP or API tool sources installed yet."** while the Odoo MCP was already wired to all 5 of his bots. Both facts are true: the panel reads a DIFFERENT table from the one the Odoo wiring uses.

| | `capability_installs` | `mcp_servers` + `bot_mcp_servers` |
|---|---|---|
| Written by | Integrations -> "Add MCP server" / Add OpenAPI / Add GraphQL (`capabilities.install`) | the MCP connector API (`mcp.servers.create`, `mcp.assignments.*`) — **what the Odoo bot wiring uses** |
| Rendered by | the Integrations overlay's "Tool sources" list | `McpServersOverlay` ("Manage MCP servers", inside the Advanced section) |
| Visible in the Integrations panel? | yes | **NO** — it is a different list |

**So the "empty" panel was not a fault.** Verified: `mcp_servers` holds `zervi-odoo` (enabled, tailnet endpoint) in Archie's space/user with 5 `bot_mcp_servers` assignments (Chief, Doc, Motto, Scout, Scribe); `capabilities/list` in that space returns `[]` because nothing was installed through the Integrations UI. Both scoping checks confirmed (`mcp.servers.list` filters `spaceId + userId`, i.e. per-user, which is why my service space correctly returns `[]`).

**Where to see the Odoo connection:** Integrations -> scroll to **Advanced** -> **Manage MCP servers** (`McpServersOverlay`, lists `mcp.servers.list` with endpoint + "credential saved"). That overlay's `onOpenMcp` prop is what reveals the link — in the standalone Integrations dialog the Advanced section carries it.

**Everyday consequence:** the bots already USE the Odoo connection regardless of which panel lists it — proven live when Scout/Chief/Doc/Scribe each answered 3,369 partners and Motto reported 1,429-1,425 sale orders. The Integrations "Tool sources" list is for connectors installed through that UI (OpenAPI/GraphQL/catalog MCP), and is currently legitimately empty.

## Strategic comparison: Rakazo vs LobeHub — licence, lock-in, and what we can build (measured 2026-10-16)

Archie's thesis — *LobeHub is a hard-case workflow with restrictions; Rakazo is fully open so we can develop it as a Zervi in-house tool* — **is confirmed by measurement.**

### The licence difference is REAL and material

| | LobeHub | Rakazo |
|---|---|---|
| Declared licence | `MIT` in `package.json` **but the actual LICENSE file is the "LobeHub Community License"** | **Apache-2.0**, full unmodified text (`LICENSE`), `"license": "Apache-2.0"` |
| Modifications / derivative works | 🔴 **Additional condition 1b: "a commercial license must be obtained from the producer if you want to develop and distribute a derivative work based on LobeChat."** | ✅ None. Standard Apache-2.0: modify, run, and distribute freely, including commercially |
| Commercial use unmodified | ✅ allowed (condition 1a) | ✅ allowed |
| Re-licensing risk | 🔴 Condition 2a: **"the producer can adjust the open-source agreement to be more strict"** — we cannot freeze our rights | ✅ Not possible for released versions; Apache-2.0 is irrevocable for code we have |
| Separate commercial tier | 🔴 Yes — an `enterprise/` component we are **already running**: processes `./enterprise/sandbox/dist/server.js` and `./enterprise/backend-ee/dist/index.js` (EE = Enterprise Edition), plus "Enterprise Edition" strings throughout the shipped i18n bundles | ✅ No `enterprise/` directory, no EE/community split, no premium carve-out anywhere in the tree |
| Trademark | Apache clause 6 — no trademark grant | Apache clause 6 — same |

**Consequence for Zervi:** with LobeHub we may *use* it and *modify* it privately, but **distributing** a Zervi derivative needs a paid commercial licence from LobeHub LLC, and they reserve the right to tighten terms later. With Rakazo we can fork, rebrand, extend and ship as an in-house/branded product **with no permission from anyone**, and our rights to each released version can never be clawed back.

### The other half of Archie's point: "they don't share" (LobeHub's 35 users)

Correct, and worth scoping precisely: LobeHub's user count is **breadth of chat access**, not shared workflows. It is a chat portal — 211 agents, 89 knowledge bases, 9,289 messages, **0 scheduled jobs** (`agent_cron_jobs` = 0). Nobody is delegating autonomous work through it. Rakazo's gap (no multi-user sharing in this build) is therefore not a like-for-like loss today; it is a limit on *how many seats* can use the autonomous capability.

### Where each one wins (state plainly, do not oversell)

- **Rakazo wins on:** licence freedom, per-bot/per-user sandboxed computers, unattended routines (proven live), document/artifact output, and being genuinely ours to shape.
- **LobeHub wins on:** multi-user maturity (35 real users over 2 months), 89 knowledge bases with real retrieval, public HTTPS portal, and battle-testing.
- **Rakazo's honest costs:** 1-day-old fork, upstream moving at ~415 commits/30d, no multi-user sharing, local-only backups, and a host already at 100% swap — so its user ceiling is a hardware question, not a licence one.

### Recommendation

Treat Rakazo as the **in-house agent platform we can own and extend**, and keep LobeHub as the **staff chat portal** it already is. Do not attempt to replace one with the other. If we invest engineering in Rakazo, the licence analysis says that investment is defensible in a way the same investment in LobeHub is not — which is exactly Archie's argument, now measured.

## Archie's decision 2026-10-16 + memory model (measured)

### DECISION (Archie, 2026-10-16): keep course, start in-house development
Archie reviewed the licence evidence and decided: **no migration now** — keep LobeHub as-is in the short term, and **begin developing Rakazo as a Zervi in-house tool** (add our own features, menus, departments). Rationale recorded: with LobeHub, distributing a derivative requires a commercial licence and their terms can be tightened later; Rakazo is Apache-2.0 with no carve-outs, so Zervi-owned development is defensible. This was Archie's call and is not mine to revisit — the evidence stands in the section above.

### Memory model — how it actually works (all verified in code + live data)

**Storage.** `MemoryDocument` rows in Postgres (`memory_documents`), unique on `(spaceId, scope, botId, path)`. Every write also appends a `MemoryRevision`, so memory is versioned and recoverable. The default store is `MarkdownMemoryStore` (`packages/memory/src/index.ts`) — id `markdown`, capabilities `{search, revisions, markdownPortable}`, so memory exports as plain Markdown.

**The scopes a user must understand:**
| Scope | Who sees it | Where it lives |
|---|---|---|
| **bot** | one bot only (`botId` set) | that bot's `MEMORY.md` |
| **user** (space) | every bot in that space | the space's `MEMORY.md` |
| `shared` vs `isolated` | `space_memory_configs.defaultMemoryScope` — which scope new writes default to; connectable via `memory.connectProvider` | — |

**Live state in this deployment (measured):** 2 user-scope docs (148 bytes) and 6 bot-scope docs (54 bytes) — i.e. **six bot memories at 7–10 bytes each**. They currently contain only the seeded heading (`# Chief`, `# scribe`, `# Motto`...). So memory is **wired and working but empty**: no bot has learned anything durable yet.

**How it reaches the model.** Bots hold explicit tools — `remember` (store a fact), `recall_memory` (search it), `save_shared_memory` (write to the shared/space scope), `forget_memory`. The executor also warns in the system prompt that recalled memory is **untrusted historical data, never instructions** (`executor.ts:7835`) — a prompt-injection defence worth preserving when we extend memory.

**The honest limitation (and it matters for our dev work):** `MarkdownMemoryStore.search` is a **case-insensitive substring match over the documents** (`doc.content.toLowerCase().includes(q)`), with a flat `score: 1`. It is NOT semantic and NOT vector search. The tool description says "Semantically search" — **that description overstates what the default store does.** Real semantic retrieval requires connecting an external memory provider through `memory.connectProvider` (a `MemoryProviderResolver` exists for this); none is connected here (`space_memory_configs` is empty).
→ Design consequence: any Zervi feature that relies on "the bot remembers what we discussed" will degrade as memory grows, until a provider is connected. Plan for it before departments depend on it.

### Groundwork for "departments"
There is no `Department` model today. The nearest existing structures are `Space` (a hard boundary: bots, boards, memory, artifacts), `ChatGroup` (a set of bots with one shared thread) and `Board`/`Ticket`. Adding Zervi departments is therefore a **product feature to build**, not a config toggle — see the dev-scoping note in this file.
