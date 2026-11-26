# SupportHub — remote Floci host with ECS workers (no laptop dependency)

Status: **prepared and rehearsed on a simulated private host; NOT deployed**. Needs: a free VM,
SSH access, a Cloudflare tunnel token and your approvals (see "What you need to do").

## Final design (zero cost, no domain purchase)

| Layer | Where | Notes |
|---|---|---|
| Frontend + `/api` proxy | Cloudflare Pages | unchanged |
| 4 API microservices | Vercel | unchanged code; Article/Identity/Search get `AWS_ENDPOINT_URL` = gateway URL |
| Database | Neon (production) | restricted role per service |
| Floci gateway | Cloudflare **Worker** on `*.workers.dev` (`infra/cloudflare/floci-gateway`) | checks the service-token headers, forwards through a **Workers VPC** binding |
| Tunnel | `cloudflared` on the VM (outbound only) | no public hostname, no domain, no open port |
| AWS layer | **Floci on a free VM** (Oracle Always Free VM.Standard.E2.1.Micro - see cost check) | private Docker network only |
| Workers | **ECS services on Floci** | article-outbox-worker, editorial-article-consumer, editorial-publication-worker |

Measured footprint (isolated stack): Floci ~100 MB, each worker ~30 MB, Lambda container
on demand, cloudflared small -> ~300-450 MB steady; images ~1.6 GB. A 1 GB VM with the 2 GB
swap created by `install-remote-host.sh` is sufficient.

### Cost check for a strict $0 budget (official docs, 2026-11-26)

| Item | Google Cloud e2-micro | Oracle Always Free E2.1.Micro |
|---|---|---|
| VM | free (1/month, US regions) | free (up to 2, 1/8 OCPU, 1 GB) |
| Public IPv4 | **billed: $0.005/h (~$3.65/month)**, only 1 h/month free | included: "one VNIC with one public IP address" |
| Avoiding the IPv4 | Cloud NAT **billed** ($0.0014/instance-h + $0.045/GiB + NAT IP) | not needed |
| Egress | 1 GB/month free, then ~$0.12/GiB | 10 TB/month free |
| Storage | 30 GB standard PD | 200 GB block+boot total |
| Spending cap | none (budgets only alert) | Always Free resources free "for the life of the account"; a written hard no-charge guarantee for non-upgraded accounts was not found (FAQ page not readable) |
| Main risk | **not $0** | idle reclamation: an Always Free VM whose 7-day 95th-percentile CPU and network are both < 20 % "may be reclaimed" (stopped; restartable) |

Cloudflare: Workers Free 100,000 requests/day (over the limit -> error 1027, no charge stated),
10 ms CPU, 50 subrequests; Workers VPC "available for free to all Workers plans" while in beta,
pricing after beta not stated; Tunnel "available on all plans"; workers.dev always runs Browser
Integrity Check (some default user agents get error 1010 - must be tested with the AWS SDK).
=> Google Cloud is rejected for the $0 budget. Oracle Always Free is the only verified $0 host,
with the reclamation and capacity risks above.

## Scripts (all idempotent, secrets never printed, no recursive/wildcard deletes)

| Where | Script | Purpose |
|---|---|---|
| laptop | `prepare-production-env.sh` | builds `production.env` (restricted DB URLs + HMAC) outside the repo, validated |
| laptop | `package-for-remote.sh` | code bundle (tracked/non-ignored files only, secret-checked) |
| VM | `install-remote-host.sh` | Docker, Node, swap, ufw (SSH only), unattended upgrades, log rotation |
| VM | `deploy-remote.sh` | compose up (no ports) -> `remote-init-aws.sh` -> build images -> ECS workers **desiredCount 0** |
| VM | `verify-remote.sh` | read-only checks: exposure, resources, ECS, Lambda, 12 IAM allow/deny probes |
| laptop | `cutover.sh --check` / `--i-approve-production-cutover` / `--rollback` | loss-free switch of the workers |
| laptop | `tests/integration/floci-gateway-check.mjs` | gateway behaviour with the real SDK clients |

Rehearsal results (simulated private host on this laptop): init 19/19, ECS deploy 14/14,
full lifecycle through the host's SQS/ECS/SNS/Lambda 10/10, verify 30/30 relevant checks
(+1 expected FAIL caused only by the laptop's own containers), cutover `--check` OK.

## What you need to do (only these steps need you)

1. **Oracle Cloud Free Tier account** (registration + identity/card verification by Oracle;
   do NOT upgrade to Pay As You Go): https://www.oracle.com/cloud/free/
   * Compute -> Instances -> Create: image **Canonical Ubuntu 24.04**, shape
     **VM.Standard.E2.1.Micro** (must show the "Always Free-eligible" label), boot volume 50 GB
   * Networking: create a VCN with a public subnet and **assign a public IPv4 address**
     (included in Always Free); add the SSH public key I will give you
   * Send me the public IP; username is `ubuntu`.
2. **Cloudflare tunnel token** (your existing account; no domain needed):
   https://dash.cloudflare.com -> Workers & Pages -> **VPC** -> **Tunnels** -> Create ->
   name `supporthub-floci` -> Save -> choose **Docker** -> copy only the token from the shown
   command into `%LOCALAPPDATA%\SupportHub\remote\cloudflared.env` as `TUNNEL_TOKEN=...`
   (I copy it to the VM; never paste it into the chat).
3. **Wrangler login** for the gateway Worker: run `! npx wrangler login` in this session
   (opens your browser; account needs the Connectivity Directory Admin role).
4. **Approvals** (each separately): (a) set Vercel env vars for Article, Identity and Search and
   redeploy; (b) run the cutover (stops the two laptop workers, starts the remote ones; the
   pending Article 21 publication event will then be published once and a receipt written).

Everything else (installation, Floci, AWS init, ECS, gateway deploy, tests, evidence,
diagram) I run myself once access is available.
