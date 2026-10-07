# Infrastructure

Everything backing the deployed Hospitality Hub. Local setup lives in
[README.md](../README.md); how a deploy runs is in [DEPLOYMENT.md](DEPLOYMENT.md).

## Domain

- **URL:** https://baps-bky.org (and https://www.baps-bky.org)
- **Registrar:** Amazon Lightsail (AWS account `486491621206`)
- **DNS zone:** Lightsail, `baps-bky.org`, us-east-1
- **Records:** A `baps-bky.org` → `108.174.61.68`, A `www.baps-bky.org` → `108.174.61.68`
- **Nameservers:** `ns-336.awsdns-42.com`, `ns-690.awsdns-22.net`,
  `ns-1441.awsdns-52.org`, `ns-1914.awsdns-47.co.uk` — the registrar delegates to
  the Lightsail zone, so records take effect without any registrar change.
- **Expires:** 2027-09-07 (auto-renew on)
- **Created:** 2026-09-13

## GitHub Repository

- **URL:** https://github.com/msalia/baps-bky
- **Visibility:** private
- **Default branch:** main
- **Deploy key:** `dokploy-server-1` (ed25519, read-only). Dokploy clones over
  SSH with the matching private key, stored as the `baps-bky-deploy` SSH key in
  Dokploy. A private repo cannot be cloned over anonymous HTTPS, which is why
  this exists.

## Dokploy Deployment

- **Dashboard:** https://dok.msalia.org
- **Server:** `server-1` (`108.174.61.68`)
- **Project ID:** `6ILCCKla4En-9ZkTapANW`
- **Application ID:** `AYty5rSUbFkhG-6g-zI8m`
- **Environment ID:** `n0--kd1LsMYT55rg2aWin`
- **Resource type:** application (single Dockerfile, not compose)
- **Build type:** dockerfile (`./Dockerfile`) — never nixpacks, it OOMs here
- **Source:** git over SSH, `git@github.com:msalia/baps-bky.git`, branch `main`
- **Memory limit:** 2 GB (`2147483648`) — a Next.js production build needs more
  than the usual 1 GB default
- **Memory reservation:** 512 MB (`536870912`)
- **Port:** 3000
- **SSL:** Let's Encrypt on both apex and `www`

## AWS

- **Account:** `486491621206` (`admin-msalia`)
- **Region:** us-east-1
- **In this account:** the domain, the DNS zone, and the `vpn` Lightsail instance.

### Not in this account — outstanding

The app's two runtime dependencies live somewhere else and still need to be
supplied before the site is functional:

| Dependency | State | Needed for |
|---|---|---|
| Lightsail Postgres `naam-users` | Not in account `486491621206` (no Lightsail databases exist here, in any region) | `DATABASE_URL` — every page |
| SES identity `sypramtechnology.com` | Not in account `486491621206` (no SES identities here; this account is also still in the SES sandbox, 200 emails/day) | `OTP_PROVIDER=aws` sign-in emails |

Until then the Dokploy env has a placeholder `DATABASE_URL` and
`OTP_PROVIDER=console`. See [DEPLOYMENT.md](DEPLOYMENT.md#environment-variables).
