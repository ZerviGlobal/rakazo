# Zervi deployment notes

This directory documents the **Zervi** deployment of this fork (`ZerviGlobal/rakazo`, forked from
`elie222/rakazo`). It is not upstream documentation — read it as the operator's record for one
installation.

| File | What it is |
|---|---|
| [`DEPLOYMENT-RUNBOOK.md`](./DEPLOYMENT-RUNBOOK.md) | How this deployment is built and operated: the three compose files, image tags, deploy and rollback scripts, the Zervi employee UI (navigation, departments, Thai), and the verification suite. |
| [`CHANGELOG-ZERVI.md`](./CHANGELOG-ZERVI.md) | Dated log of what changed and why, newest first. Includes the defects found and the mistakes made while finding them. |
| [`UI-ADOPTION-ASSESSMENT.md`](./UI-ADOPTION-ASSESSMENT.md) | Assessment of how far the upstream UI could be adopted as-is, and what had to be built. |
| [`TMH-KNOWLEDGE-REACH.md`](./TMH-KNOWLEDGE-REACH.md) | **Read this first.** Why the agents never used TMH: 46 wikis, 4,201 pages, **0 bound**, no cross-wiki search, no discovery. The knowledge was never the problem. |
| [`MEMORY-EVALUATION.md`](./MEMORY-EVALUATION.md) | What Rakazo's memory actually is (measured), and whether OpenViking would be better than TMH — answer: use the plug-point already there first. |
| [`SHARED-ASSISTANTS-DESIGN.md`](./SHARED-ASSISTANTS-DESIGN.md) | Design for letting a department share one assistant. Records why the obvious version leaks, and the four policy decisions it needs. **Designed, not built.** |
| [`TEAM-COMPUTER.md`](./TEAM-COMPUTER.md) | What a Team Computer is, what it shares and does not, how to use it, and when to pick Private instead. |
| [`diagrams/`](./diagrams/) | Diagrams: how the deployment is wired, the logic of one message, and a side-by-side comparison of Rakazo against LobeHub. Open the HTML; the JSON beside it is the editable structural record. |

## Reading these honestly

Both files record failures as well as fixes, on purpose. Where something could not be verified, the
text says so. Where a check turned out to be incapable of failing, that is written down too — several
verification scripts in this campaign reported PASS for reasons that had nothing to do with the product.

**Host-specific paths** like `/opt/zervi/rakazo` refer to the ZBOX host this is deployed on. They are
not part of the repository and will not exist on a fresh clone.

## Current state at the time of writing

- Employee-facing UI: navigation, departments, Thai, verified by rendered evidence on a live deployment.
- 5,834 tests pass; the host-side acceptance script reports 6/6.
- **Not done, and needing a decision:** assistants cannot be shared between colleagues (an assistant
  belongs to one user, even inside a shared space); the deployment is tailnet-only and HTTP-only; Thai
  wording has not been reviewed by a native speaker.
