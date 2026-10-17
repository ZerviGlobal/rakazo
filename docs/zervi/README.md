# Zervi deployment notes

This directory documents the **Zervi** deployment of this fork (`ZerviGlobal/rakazo`, forked from
`elie222/rakazo`). It is not upstream documentation — read it as the operator's record for one
installation.

| File | What it is |
|---|---|
| [`DEPLOYMENT-RUNBOOK.md`](./DEPLOYMENT-RUNBOOK.md) | How this deployment is built and operated: the three compose files, image tags, deploy and rollback scripts, the Zervi employee UI (navigation, departments, Thai), and the verification suite. |
| [`CHANGELOG-ZERVI.md`](./CHANGELOG-ZERVI.md) | Dated log of what changed and why, newest first. Includes the defects found and the mistakes made while finding them. |
| [`UI-ADOPTION-ASSESSMENT.md`](./UI-ADOPTION-ASSESSMENT.md) | Assessment of how far the upstream UI could be adopted as-is, and what had to be built. |

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
