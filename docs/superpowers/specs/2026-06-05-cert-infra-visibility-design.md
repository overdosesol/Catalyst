# Cert + Infra Visibility — Design Spec

**Bundle**: #17 из `docs/audit/INDEX.md` (Tier 1, foundation)
**Date**: 2026-06-05
**Author**: brainstorm session (operator + sonnet, operator delegated detail decisions per Bundle #16 pattern)
**Status**: Approved scope (Минимум), ready for writing-plans

---

## Goal

Закрыть PROD-007 + PROD-008 + PROD-021 + DOC-003 + DOC-004 (5 findings) через: версионирование prod nginx config в репо, простой bash-скрипт для cert expiry monitoring, документация cert renewal + secret rotation в DEPLOY.md. **Минимально инвазивный bundle**: преимущественно docs + один новый script + один новый infra file.

## Context

12-stage audit пометил три prod findings:
- **PROD-007 (HIGH)**: nginx config живёт только на VPS, не в git → drift unverifiable, recovery impossible
- **PROD-008 (HIGH)**: HTTPS может тихо умереть на 90д (cert expiry, нет alerting'а)
- **PROD-021 (MEDIUM)**: secret rotation undocumented — только 1-liner stub в DEPLOY.md

Плюс 2 documentation findings:
- **DOC-003 (HIGH)**: DEPLOY.md missing cert renewal SOP (cross-confirm PROD-008)
- **DOC-004 (HIGH)**: DEPLOY.md missing secret rotation SOP (cross-confirm PROD-021)

Operator принёс реальный prod nginx config через SSH cat. Verified:
- server_name: `catalystparser.io www.catalystparser.io`
- upstream: `127.0.0.1:8080` (внимание — DEPLOY.md §4 example говорит 7357 — **drift, закроем заодно**)
- TLS: managed by certbot, cert paths `/etc/letsencrypt/live/catalystparser.io/`
- HTTP→HTTPS redirect present
- SSE proxy_buffering off + proxy_read_timeout 24h
- 4 X-headers + Authorization passthrough
- set_real_ip_from 127.0.0.1 + real_ip_header X-Forwarded-For (TRUST_PROXY=1 contract)

---

## Scope

### In-scope

**Code/infra**:
- Create `scripts/nginx-catalyst.conf` — закоммитить prod nginx config (источник правды) в репо
- Create `scripts/check-cert-expiry.sh` — daily cert expiry check, exit 1 если < 14 дней, лог в `/var/log/catalyst-cert.log`

**Docs**:
- `DEPLOY.md` §4 fix port drift (7357 → 8080)
- `DEPLOY.md` §6.7 (new) Cert renewal verification SOP — как проверить certbot.timer, как проверить cert expiry, что делать если упало
- `DEPLOY.md` §6.8 (new) Secret rotation SOP — schedule + per-key procedure
- `ai-context/SESSION_CONTEXT.md` — обновить Production posture: nginx config now in repo, cert monitoring active, secret rotation documented
- `ai-context/WORKLOG.md` — Bundle #17 entry

**Verification (operator-driven)**:
- nginx config committed matches prod via `diff <(ssh root@... cat /etc/nginx/sites-available/catalyst) scripts/nginx-catalyst.conf` → empty
- `bash scripts/check-cert-expiry.sh` runs locally, reports days remaining
- Cron job `/etc/cron.daily/catalyst-cert-check` создан на VPS — manual test prog'a через `sudo /usr/local/bin/check-cert-expiry.sh`

### Out-of-scope

- **TG bot integration** для cert expiry alerts — это Bundle #15 territory (Bot resilience). Сейчас лог в файл + cron mail (если sysadmin настроен).
- **Auto-deploy nginx config** через `deploy.{ps1,sh}` (как catalyst-backup.sh) — требует `sudo nginx -t && systemctl reload nginx` логику. Defer — risk that broken nginx config kills site. Сейчас: commit + manual scp/reload оператором при изменении.
- **External uptime monitor** (UptimeRobot, BetterStack) — отдельная подписка, не код. Operator может настроить отдельно.
- **DR section в DEPLOY.md** (disaster recovery — VPS погиб, восстановление с нуля) — это бóльший scope, отдельный bundle.

---

## Architecture

### Files affected

| File | Action | Detail |
|---|---|---|
| `scripts/nginx-catalyst.conf` | new | Production nginx config (source of truth, manually scp'd to VPS on changes) |
| `scripts/check-cert-expiry.sh` | new | Bash, ~25 lines, daily cron, exit 1 if < 14 days |
| `DEPLOY.md` | modify | Fix §4 port drift, add §6.7 cert SOP, add §6.8 secret rotation SOP |
| `ai-context/SESSION_CONTEXT.md` | modify | Production posture: добавить refs на nginx in repo + cert monitor + secret rotation |
| `ai-context/WORKLOG.md` | modify | Bundle #17 entry |

### `scripts/nginx-catalyst.conf` content

Exact copy from prod (operator's SSH cat), без изменений:

```nginx
# catalystparser.io — public dashboard, proxied to Docker container on :8080
# TLS managed by certbot.
#
# Source of truth: scripts/nginx-catalyst.conf in repo (Bundle #17).
# On change: scp to /etc/nginx/sites-available/catalyst on VPS, then
#   sudo nginx -t && sudo systemctl reload nginx

server {
    server_name catalystparser.io www.catalystparser.io;

    # Body size cap for /api/manual-analysis
    client_max_body_size 64k;

    # Real-IP for downstream rate-limiter (TRUST_PROXY=1 in app)
    set_real_ip_from 127.0.0.1;
    real_ip_header X-Forwarded-For;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        # SSE support (/api/stream — long-lived event stream)
        proxy_buffering off;
        proxy_read_timeout 24h;

        # Standard proxy headers
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Pass through Authorization for Bearer tokens
        proxy_set_header Authorization $http_authorization;
    }

    listen [::]:443 ssl ipv6only=on; # managed by Certbot
    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/catalystparser.io/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/catalystparser.io/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}


server {
    if ($host = www.catalystparser.io) {
        return 301 https://$host$request_uri;
    } # managed by Certbot

    if ($host = catalystparser.io) {
        return 301 https://$host$request_uri;
    } # managed by Certbot

    listen 80;
    listen [::]:80;
    server_name catalystparser.io www.catalystparser.io;
    return 404; # managed by Certbot
}
```

Note: добавлен top comment с pointer на repo + manual sync procedure. Остальное — 1-в-1 копия prod.

### `scripts/check-cert-expiry.sh` content

```bash
#!/bin/bash
# Catalyst HTTPS certificate expiry check
# Source of truth: scripts/check-cert-expiry.sh in repo (Bundle #17)
# On VPS install: scp to /usr/local/bin/check-cert-expiry.sh + chmod +x
# Cron: /etc/cron.daily/catalyst-cert-check (single line: /usr/local/bin/check-cert-expiry.sh)

set -euo pipefail

DOMAIN="${1:-catalystparser.io}"
WARN_DAYS=14   # exit 1 if cert expires in less than WARN_DAYS
LOG_FILE="${LOG_FILE:-/var/log/catalyst-cert.log}"

# Fetch cert expiry date (external check — works from any host that can reach domain)
EXPIRY_RAW=$(echo | openssl s_client -connect "$DOMAIN":443 -servername "$DOMAIN" 2>/dev/null \
  | openssl x509 -noout -enddate 2>/dev/null \
  | sed 's/notAfter=//')

if [ -z "$EXPIRY_RAW" ]; then
  echo "$(date -Is) FATAL: could not fetch cert expiry for $DOMAIN" | tee -a "$LOG_FILE" >&2
  exit 2
fi

EXPIRY_TS=$(date -d "$EXPIRY_RAW" +%s)
NOW_TS=$(date +%s)
DAYS_LEFT=$(( (EXPIRY_TS - NOW_TS) / 86400 ))

if [ "$DAYS_LEFT" -lt "$WARN_DAYS" ]; then
  echo "$(date -Is) WARNING: $DOMAIN cert expires in $DAYS_LEFT days ($EXPIRY_RAW)" | tee -a "$LOG_FILE" >&2
  exit 1
fi

echo "$(date -Is) OK: $DOMAIN cert valid for $DAYS_LEFT days (expires $EXPIRY_RAW)" | tee -a "$LOG_FILE"
```

Key features:
- `set -euo pipefail` (defensive bash, как в catalyst-backup.sh)
- External check via openssl s_client — не требует SSH или сертификатов локально
- WARN_DAYS=14 — за две недели предупредить
- LOG_FILE override через env (если operator хочет другое место)
- Exit codes: 0 = OK, 1 = warn (< 14 days), 2 = could not fetch
- tee приpend в log AND stderr — оба видят (cron MAILTO + log file)

### `DEPLOY.md` §6.7 Cert renewal verification SOP

New section (~25 lines), inserted before §7:

```markdown
### 6.7. TLS certificate renewal verification

Certbot auto-renews HTTPS cert every ~60 days (cert valid 90 days, renew at 30). **Renewal can fail silently** (port 80 blocked, DNS misconfig, certbot.timer disabled).

#### Daily auto-check (Bundle #17)

`scripts/check-cert-expiry.sh` runs daily via cron, warns if cert expires in <14 days. Install on VPS:

```bash
scp scripts/check-cert-expiry.sh root@catalystparser.io:/usr/local/bin/
ssh root@catalystparser.io "chmod +x /usr/local/bin/check-cert-expiry.sh"
ssh root@catalystparser.io "cat > /etc/cron.daily/catalyst-cert-check <<EOF
#!/bin/bash
/usr/local/bin/check-cert-expiry.sh catalystparser.io
EOF
chmod +x /etc/cron.daily/catalyst-cert-check"
```

Log: `/var/log/catalyst-cert.log`. Если cron уведомления настроены (MAILTO), оператор получит email при warning. Иначе — раз в неделю прочитай лог: `ssh root@catalystparser.io "tail -10 /var/log/catalyst-cert.log"`.

#### Manual verification

```bash
# 1. Certbot timer status (should be active, enabled)
sudo systemctl status certbot.timer

# 2. Last renewal attempts
sudo journalctl -u certbot.timer -n 20

# 3. List certs + expiry dates
sudo certbot certificates

# 4. External check (from any machine, no SSH needed)
echo | openssl s_client -connect catalystparser.io:443 2>/dev/null \
  | openssl x509 -noout -dates
# Expected: notAfter=<date 30-90d in future>

# 5. Manual renewal (dry run)
sudo certbot renew --dry-run
```

#### If renewal failed

1. Check `journalctl -u certbot.timer` for error
2. Verify port 80 accessible (`ufw status`, `curl http://catalystparser.io`)
3. Manual renewal: `sudo certbot renew`
4. Reload nginx: `sudo nginx -t && sudo systemctl reload nginx`
5. Re-test cert: `echo | openssl s_client -connect catalystparser.io:443 | openssl x509 -noout -dates`
```

### `DEPLOY.md` §6.8 Secret rotation SOP

New section (~30 lines):

```markdown
### 6.8. Secret rotation

Каждый секрет имеет lifetime — рекомендуется ротация по schedule ниже + ad-hoc при подозрении на leak.

#### Rotation schedule

| Key | Cadence | Where to rotate | Verification after |
|---|---|---|---|
| `XAI_API_KEY` | 90 days | https://x.ai/api/keys | Manual trend rescore → check log "stage1 ok" |
| `OPENAI_API_KEY` | 90 days | https://platform.openai.com/api-keys | Manual trend rescore → check stage1 batch logs |
| `GEMINI_API_KEY` | 90 days | https://aistudio.google.com | Manual trend with image → check stage0b log |
| `OPENROUTER_API_KEY` | 90 days | https://openrouter.ai/keys | Same as Gemini (Vision fallback) |
| `TELEGRAM_BOT_TOKEN` | only if leaked | @BotFather → /revoke (regenerates) | `/start` → bot responds |
| `SUPPORT_BOT_TOKEN` | 180 days | @BotFather | Same |
| `ADMIN_API_KEY` | 90 days or after operator change | local `openssl rand -base64 32` | `curl -H "X-Admin-Key: ..." /admin/api/health` |
| `DASHBOARD_API_KEY` | 180 days | local `openssl rand -base64 32` | Browser login still works |
| `HELIUS_API_KEY` | 180 days | https://helius.dev | Solana payment confirmation test |
| `APIFY_TWEET_SCRAPER_TOKEN` | 180 days | https://console.apify.com/account/integrations | Manual X collection → check log |
| `APIFY_TRENDS_SCRAPER_TOKEN` | 180 days | same | Manual trends collection |
| `TIKTOK_*` keys | 180 days | https://console.apify.com | Manual TikTok collection |

#### Per-key procedure

1. **Generate** new key on provider side (keep old key active for now)
2. **Edit `.env`** on VPS: `ssh root@catalystparser.io "nano /opt/catalyst/.env"` — replace old value
3. **Restart**: `ssh root@catalystparser.io "cd /opt/catalyst && docker compose restart app"`
4. **Verify** via test from table above
5. **Revoke old key** on provider side (only AFTER verification — иначе risk downtime если новый ключ не работает)
6. **Log** в `ai-context/WORKLOG.md`:
   ```
   ## YYYY-MM-DD · rotation · <KEY_NAME> · OK · verified <method>
   ```

#### If leak suspected (incident response)

1. **Immediately**: revoke old key on provider side (даже до подготовки нового — лучше downtime, чем abuse)
2. Generate new key
3. Edit .env, restart container, verify
4. WORKLOG entry: date, key, reason (leak/suspected), source of leak if known
5. Audit: check provider usage logs for anomalies during leak window
```

### `ai-context/SESSION_CONTEXT.md` updates

В Production posture section (рядом с Daily backup + Deploy gate из предыдущих bundles), добавить:

```markdown
- **nginx config**: source of truth — `scripts/nginx-catalyst.conf` в репо. На изменении: scp → `/etc/nginx/sites-available/catalyst` на VPS + `sudo nginx -t && systemctl reload nginx`. Не правим вручную на сервере (drift unrecoverable). Bundle #17 (2026-06-05) закоммитил prod config — proxy_pass на 8080 (не 7357 как в старом DEPLOY.md примере).
- **Cert monitoring**: `/usr/local/bin/check-cert-expiry.sh` (source: `scripts/check-cert-expiry.sh`) запускается ежедневно через `/etc/cron.daily/catalyst-cert-check`. Warn в `/var/log/catalyst-cert.log` если < 14 дней до expiry. Externally проверяет via openssl s_client. Подробности: DEPLOY.md §6.7.
- **Secret rotation**: schedule + per-key procedure — DEPLOY.md §6.8. 90д для AI keys + ADMIN_API_KEY, 180д для Apify/Helius/DASHBOARD_API_KEY, only-on-leak для Telegram tokens.
```

И fix port drift в любом упоминании если есть (grep `7357` в SESSION_CONTEXT → если в контексте nginx upstream — fix на 8080).

### `DEPLOY.md` §4 port fix

Find this line in §4 (nginx example):
```nginx
proxy_pass http://127.0.0.1:7357;
```

Replace with:
```nginx
proxy_pass http://127.0.0.1:8080;
```

Comment update — section §4 currently says ":7357 public dashboard" — должно быть ":8080". Это drift discovered во время этого bundle, фиксим заодно.

---

## Verification plan

### Acceptance criteria

**Code/infra**:
- [ ] `scripts/nginx-catalyst.conf` существует, содержание матчит prod via:
  ```bash
  diff <(ssh root@37.1.196.83 "cat /etc/nginx/sites-available/catalyst") scripts/nginx-catalyst.conf
  ```
  Expected: only header comment difference (we added "Source of truth" pointer)
- [ ] `scripts/check-cert-expiry.sh` создан, `chmod +x`, syntax check `bash -n` exit 0
- [ ] Local test: `bash scripts/check-cert-expiry.sh catalystparser.io` → exit 0 с message "OK: ... cert valid for N days"

**Docs**:
- [ ] `DEPLOY.md` §4 port fixed (7357 → 8080)
- [ ] `DEPLOY.md` §6.7 Cert renewal verification SOP exists
- [ ] `DEPLOY.md` §6.8 Secret rotation SOP exists с rotation schedule table (12 keys)
- [ ] `ai-context/SESSION_CONTEXT.md` Production posture обновлён (3 new bullets: nginx, cert monitor, secret rotation)
- [ ] `ai-context/WORKLOG.md` имеет Bundle #17 entry

**Operator-driven verification (T-final)**:
- [ ] scp `scripts/check-cert-expiry.sh` на VPS в `/usr/local/bin/`, chmod +x
- [ ] Создать `/etc/cron.daily/catalyst-cert-check` (per DEPLOY.md §6.7)
- [ ] Manual run: `ssh root@37.1.196.83 "/usr/local/bin/check-cert-expiry.sh catalystparser.io"` → exit 0
- [ ] Verify nginx config in repo matches prod (diff command above)

### Closed findings

- PROD-007 (nginx now in repo as scripts/nginx-catalyst.conf)
- PROD-008 (daily cert expiry check via cron)
- PROD-021 (secret rotation SOP documented с schedule + procedure)
- DOC-003 (DEPLOY.md §6.7 has full cert renewal SOP)
- DOC-004 (DEPLOY.md §6.8 has full secret rotation SOP)

**Bonus** (discovered during brainstorm, not in audit):
- DEPLOY.md §4 port drift 7357 → 8080 fixed

---

## Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| `scripts/nginx-catalyst.conf` diverges from prod после первого commit | medium | Документировать в DEPLOY.md §4 что repo = source of truth. Quarterly drill — operator проверяет diff. Defer auto-sync (требует sudo nginx -t reload logic — отдельный bundle). |
| `check-cert-expiry.sh` exit 1 на warn ломает cron mail-flow | low | Cron mail-on-failure это feature, not bug. Operator получит уведомление. Если MAILTO не настроен — log в файле. |
| openssl формат даты non-portable (BSD vs GNU date) | medium | Скрипт использует `date -d` (GNU). Если VPS на BSD — fail. Catalyst prod = Debian/Ubuntu, GNU date работает. Документировать в comments. |
| Secret rotation table неполная — propose 90/180 cadence не подходит operator | low | Operator может adjust cadence в WORKLOG, table — recommendation, не закон. |

---

## Estimated effort

| Component | Time |
|---|---|
| `scripts/nginx-catalyst.conf` (commit of prod content) | 10 min |
| `scripts/check-cert-expiry.sh` + chmod + local test | 20 min |
| `DEPLOY.md` §4 port fix (one-liner) | 2 min |
| `DEPLOY.md` §6.7 + §6.8 docs | 45 min |
| `ai-context/SESSION_CONTEXT.md` 3-bullet update | 10 min |
| Operator: scp script + cron + manual test on VPS | 15 min |
| WORKLOG entry | 10 min |
| **Total** | **~2h** |

Within audit's ~3h estimate (well under).

---

## Open questions

All resolved per operator delegation:
- Q1: Scope (full vs minimum)? → **Минимум** (per Bundle #16 pattern)
- Q2: TG bot integration для cert alerts? → **No** (defer to Bundle #15 — Bot resilience)
- Q3: Auto-deploy nginx via deploy.sh? → **No** (defer — risk of broken config killing site)
- Q4: External uptime monitor? → **No** (separate concern, operator can add later)
- Q5: DR section (VPS погиб)? → **No** (бóльший scope, отдельный bundle)
- Q6 (sonnet-decided): nginx config location → `scripts/nginx-catalyst.conf` (existing folder, YAGNI infra/)
- Q7 (sonnet-decided): WARN_DAYS для cert check → **14** (двух недель достаточно для reaction)
- Q8 (sonnet-decided): rotation cadence → 90д для AI/admin, 180д для Apify/Helius/dashboard, only-on-leak для Telegram

---

## Transition

После approve этого spec — invoke `superpowers:writing-plans` для generation implementation plan с пошаговыми задачами.
