# Why there are two LobeHub databases on ZBOX

**Asked 2026-10-17.** Suspicion was that the older one came from the Odoo dev work on the box, before
the move to CloudPepper. **It did not.** Both were created within three days of each other in August,
and the difference is the *deployment tool*, not Odoo.

## The two

| | `zervi-lobe-postgres` | `zervi-lobe-postgres17` |
|---|---|---|
| Created | **2026-08-11 07:08** | **2026-08-14 00:43** |
| Image | `pgvector/pgvector:pg16` | `paradedb/paradedb:latest-pg17` |
| Data | bind → `/data/coolify/services/lobechat-zrv01/lobe-pgdata` | named volume `zervi-lobehub_pg_data` |
| Managed by | **nothing** — no compose labels at all | `zervi-lobehub` compose, `/opt/zervi/lobehub/docker-compose.yml` |
| Network | `coolify` only | `zervi-lobehub_app` (alias **`postgresql`**) |
| Restart policy | `no` | (live service) |
| Agents | 99 | 211 |
| Sessions / messages | **0 / 0** | live |
| Newest write | 2026-08-11 11:18 | today |

**Which one is live is not ambiguous.** The application resolves `postgresql`, and that name is a
network alias on `zervi-lobe-postgres17` only. The old container is on a different network and is not
reachable from the app at all. Both are still *running*, which is what makes this confusing.

## What actually happened

Two deployments of the same thing, three days apart, by two different mechanisms:

1. **2026-08-11** — LobeHub was deployed through **Coolify** (service id `lobechat-zrv01`), on pg16.
   That day it was **seeded with a demo catalogue**: 99 agents named `🤖 Shop`, `Vox`, `Sall`, `Seam`,
   `Stitch`, `Vector`, `Sage`, `Warp`… — all created in a **three-minute burst**, 11:15:52 → 11:18:45.
   Then nothing. No sessions, no messages, ever. The data directory's mtime never moved past creation.
2. **2026-08-14** — LobeHub was redeployed **by hand with the compose file in `/opt/zervi/lobehub`**,
   on pg17 using the ParadeDB image (which is what makes the vector search work).

The August 11 attempt was **abandoned, not migrated**. Its data was never imported: the 99 agents exist
only in the dead database, and the live one has 211 different agents.

**So the suspicion was reasonable but the cause is different.** It is not Odoo-era and not from the
Odoo dev work — it is a **Coolify deployment that was replaced by a hand-managed compose**, and the
old container was simply never taken down. `coolify` itself is still running on this host, but it no
longer has a record of that service, which is why nothing cleans it up.

## What is actually stranded

Worth knowing before anyone deletes anything:

- **99 agents** — the seeded demo catalogue. Created in 3 minutes, never used. No value.
- **9 knowledge bases** — these *are* Zervi's, and they are named for real things: *Zervi Agency
  Directory, Zervi Products, Zervi Finance, Zervi Commercial, Zervi SOPs, Zervi Quality, Zervi HR,
  Odoo v17 Archive, Zervi Engineering*. **Check whether their content exists in the live DB before
  discarding** — the live DB has a differently-named wiki set (*Zervi 01 Architecture* … *Zervi 08 Gap
  Audit*, *Odoo 19 Access Rights Map*), so these nine may be an earlier generation with no successor.
- **0 sessions, 0 messages** — nobody ever used it.
- **66 MB** on disk under `/data/coolify/services/lobechat-zrv01`.

## What I did NOT do

**Nothing was stopped or deleted.** This is a data-destruction gate. The old container still runs with
`restart: no`, so it will not come back after a reboot and is harmless where it is — it is on its own
network, unreachable from the app, and holds no sessions.

If it should go, the safe order is: **dump the 9 knowledge bases first** (they are the only thing with
possible value), verify the dump opens, then stop and remove the container and the 66 MB directory.
That is a deliberate action for Archie to approve, not something to do while investigating.

## The broader pattern, worth a look separately

`/data/coolify/services/` holds **11 service directories**. Six have no containers at all
(`j9kvpxyv…`, `kmv8iaos…`, `lobechat-zrv01`, `lothckkc…`, `p65pvkv8…`, `ryeozj6x…`, `w1iqg98q…`), so
the same "abandoned but still on disk" pattern is not unique to LobeHub. `coolify-db` also reports
`running:unhealthy`. That is a separate cleanup question, not part of this one.
