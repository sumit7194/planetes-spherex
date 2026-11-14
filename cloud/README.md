# Planetes cloud pieces

- **AWS (us-east-1, next to NASA's SPHEREx bucket):** a function that reads just the needed pieces of SPHEREx files and packs them into small tiles; later, the release-driven whole-sky jobs.
- **Cloudflare:** the front door near users. A Worker answers requests, R2 keeps every tile made, and the network caches them worldwide with no charge for data sent to users.

Logins are done by Sumit only. Claude never handles passwords, keys or codes. Anything that creates resources or could cost money is asked first.

---

## AWS CLI: what we actually use (set up 14 Nov 2026)

The account is on AWS's **Free plan**: $100 of credits, ending 14 May 2027. On this plan AWS doesn't charge a card; when the credits run out, paid services stop until the plan is upgraded.

The CLI uses **`aws login`**, which borrows your console sign-in (no access keys, no Identity Center needed):
```sh
aws login --profile planetes
```
The browser opens; you approve once. The CLI then refreshes its short-term keys by itself until that sign-in expires. Check it:
```sh
aws sts get-caller-identity --profile planetes
```
Profile `planetes`: region `us-east-1`, output `json`.

**Important:** NASA's SPHEREx bucket must be read **without signing** (`--no-sign-request`, or plain HTTPS as our code does). Signed requests from this account get *403 Forbidden*.

The single sign-on steps below are kept for later, if we ever want separate users.

## (Later, optional) AWS single sign-on (IAM Identity Center)

**In the AWS console** (signed in with your new account's root login):

1. **Protect the root login:** account name (top right) → *Security credentials* → *Assign MFA device*. Never create access keys for root.
2. Top-right region selector → **US East (N. Virginia) us-east-1**.
3. Search **IAM Identity Center** → **Enable** (choose *Enable with AWS Organizations* if asked).
4. **Users → Add user**: a username (e.g. `sumit-planetes`) and your email. Accept the invite email, set a password, and set up MFA for this user too.
5. **Permission sets → Create permission set → Predefined → AdministratorAccess**, session duration 4 hours.
   *(Why admin: the function needs its own small "role", and the narrower PowerUser set can't create roles. It's a single-person account, Claude asks before creating anything, and the session expires.)*
6. **AWS accounts →** tick your account → **Assign users or groups →** your user → the AdministratorAccess set → **Submit**.
7. Copy the **AWS access portal URL** (Identity Center *Dashboard* or *Settings*; it looks like `https://d-xxxxxxxxxx.awsapps.com/start`).

**In your terminal:**

```sh
aws configure sso
```
Answers:
- **SSO session name:** `planetes`
- **SSO start URL:** the portal URL from step 7
- **SSO region:** `us-east-1`
- **Registration scopes:** press Enter

Your browser opens; approve. Then pick your account and the AdministratorAccess role, and continue:
- **Default client Region:** `us-east-1`
- **Output format:** `json`
- **Profile name:** `planetes`

Check it works:
```sh
aws sts get-caller-identity --profile planetes
```
On later days, when the session has expired:
```sh
aws sso login --profile planetes
```

---

## One-time setup: Cloudflare

1. **Dashboard → R2 → Enable R2** (the free plan: 10 GB storage, 1 M writes and 10 M reads a month; it may ask for a payment method).
2. In your terminal:
```sh
cd ~/Github/SpaceAppChallenge/cloud && npx wrangler login
```
The browser opens; click **Allow**. Then check it works:
```sh
npx wrangler whoami
```

---

## Cost guardrails (Claude sets these up after login, with your OK)
- **AWS Budget** with email alerts at $5 and $20 a month.
- **Free tiers we aim to stay inside:**
  - AWS Lambda: 1 M requests and 400,000 GB-seconds a month.
  - AWS: 100 GB a month of data out to the internet.
  - Cloudflare Workers: 100 k requests a day.
  - R2: as above.

---

## Measured: Cloudflare Worker → NASA bucket (14 Nov 2026, test Worker `planetes-probe`)
| Placement | Where the Worker ran | One small read from NASA (median) |
|---|---|---|
| none / `smart` | Singapore (near the visitor) | ~1,000 ms (~270 ms on a reused connection) |
| `targeted`, `hostname = "nasa-irsa-spherex.s3.amazonaws.com"` | Atlanta (`cf-placement: remote-ATL`), after ~15 min | **~85 ms** (35–140 ms) |

So a Worker with targeted placement reads NASA's files about **12× faster** than one near the visitor. The move took ~15 minutes after deploying.
