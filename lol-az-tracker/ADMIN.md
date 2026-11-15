# Hidden admin panel

Off by default. Turned on by three values in your `.env` (they are already passed through in `docker-compose.yml`):

| Variable | What it is |
|---|---|
| `ADMIN_PATH` | The secret address, `https://lolphabet.app/<ADMIN_PATH>`. 16-64 characters. Generate one with `openssl rand -hex 16`. |
| `ADMIN_USER_IDS` | Internal user id of your account (for older Google accounts this is the Google ID; for newer ones it looks like `u_1a2b3c...`). Find it in the panel's user list, or in `data.json`. |
| `ADMIN_PASSPHRASE` | A second lock you type each time. 8+ characters, different from every other password. |
| `ADMIN_IDLE_MINUTES` | Optional. Re-locks after this long without activity (default 20). |

## What keeps it locked down

1. **Hidden.** Not linked anywhere, not in `robots.txt` or the sitemap, sent with `noindex, nofollow, noarchive`. Anyone without the address, or without being signed in, sees the site's normal "Page not found" page.
2. **Only your account.** `/api/admin/*` only responds to a signed-in session belonging to `ADMIN_USER_IDS`. For everyone else those URLs behave exactly like any other nonexistent URL, so they can't even tell the panel exists.
3. **A second factor.** Even with your session, nothing loads until the passphrase is entered. The unlock token lives in server memory only, is tied to that one session, and expires after 20 idle minutes (8 hours max). Wrong guesses are rate limited per account and per IP, with a global lockout after 10 misses in an hour.
4. **No CSRF / XSS.** Same-origin only (Origin check plus a custom header), strict Content-Security-Policy, no inline scripts, and user-supplied names and notes are never parsed as HTML. No framing, no referrer.
5. **Never exposes secrets.** Password hashes and session tokens are never sent to the browser. There is deliberately **no "log in as this user"**.
6. **Audit log + undo.** Every unlock attempt and every change is logged to `/data/admin/audit.log`. Before each change the account is snapshotted to `/data/admin/backups/` (last 40 per account), restorable from the History tab. Deleted or merged-away accounts can be brought back from Recovery.
7. The admin account can't be suspended, deleted or merged away from the panel.

Extra layer worth adding (free, no code): in Cloudflare Zero Trust create an **Access** policy for the paths `/<ADMIN_PATH>*` and `/api/admin/*`, allowing only your email. Then the panel isn't even reachable by the public internet.

## What you can do

* **Dashboard:** accounts, new/active counts, sign-in methods, sessions, shares, emails sent today, data size, and anything needing attention (accounts with no working login, duplicates).
* **Users:** search by name, email, username, Discord name, user/Google/Discord id; filter and sort.
* **Per account:** edit display name, username, email; private notes; linked Google / Discord / password / email with Unlink (lock-out protection); see sign-in times, devices and sign them out.
* **Progress:** pick a list and mode, then mark won / undo, revive a champion marked Fallen by mistake, edit wins, dates, games and notes, add or remove entries, clear a stuck dice-roll/random lock, reset one list, reset everything, download JSON, or edit the raw JSON.
* **Merge** two accounts (Discord-then-Google mix-ups): side-by-side preview, conflicts blocked, and a choice to combine the best of both, keep only one side's progress.
* **Security:** email a password-reset link, or create a one-time link to send via Discord DM; sign out everywhere; suspend / unsuspend; delete (typed confirmation).
* **Sharing:** turn off a progress share link, delete a shared list.
* **Duplicates, Audit log, Recovery** pages.

## Small changes outside the panel

* `auth-server.js`: new accounts get a `created` date, sign-ins record `lastLogin`, suspended accounts can't sign in, and a few helpers are exported for the panel.
* `server.js`: loads the panel, enforces suspension, and adds a revision check to `/api/progress`.
* `assets/js/auth.js`: sends that revision. If you fix someone's progress while they have the site open, their tab reloads your corrected copy instead of overwriting it with its stale one (they get a short "Your progress was updated" message).
