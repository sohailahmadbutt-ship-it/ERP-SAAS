# Deploying ERP SaaS

One server runs everything in Docker: Postgres, the API, the web app and Caddy,
which gets HTTPS certificates automatically for the main domain, the API and
each company's subdomain.

## What you need

- An Ubuntu server (2 CPU and 4 GB RAM is plenty to start) with Docker:
  `curl -fsSL https://get.docker.com | sh`
- A domain, say `erp.example.com`, with two DNS **A records** pointing at the server:
  - `erp.example.com`
  - `*.erp.example.com` (covers `api.` and every company)
- Ports 80 and 443 open to the internet.

## First install

```bash
sudo git clone https://github.com/sohailahmadbutt-ship-it/ERP-SAAS.git /opt/erp-saas
cd /opt/erp-saas/deploy
sudo cp .env.example .env
sudo nano .env        # set ROOT_DOMAIN, ACME_EMAIL, PAYMENT_INSTRUCTIONS
# Fill the three secrets:
for k in POSTGRES_PASSWORD APP_DB_PASSWORD JWT_SECRET; do sudo sed -i "s/^$k=.*/$k=$(openssl rand -hex 32)/" .env; done

sudo docker compose --env-file .env --profile caddy up -d --build
```

The first build takes a few minutes. The API applies database migrations every
time it starts.

Then create your platform console login (the password is read from the
environment so it stays out of shell history):

```bash
read -s -p "Console password: " P && sudo docker compose --env-file .env exec -e PLATFORM_ADMIN_PASSWORD="$P" api \
  node dist/platform/create-admin.js you@example.com "Your Name"; unset P
```

Open `https://erp.example.com` to sign up a company, and
`https://erp.example.com/platform` for the console.

## Updating

```bash
cd /opt/erp-saas && sudo git pull
cd deploy && sudo docker compose --env-file .env --profile caddy up -d --build
```

## Backups

`backup.sh` writes a compressed `pg_dump` to `deploy/backups/` and keeps 14 days.
Run it nightly from root's crontab (`sudo crontab -e`):

```
15 2 * * * /opt/erp-saas/deploy/backup.sh >> /var/log/erp-backup.log 2>&1
```

Copy the backups off the server too (for example with `rclone` to cloud storage).
To restore into a fresh install:
`gunzip -c backup.sql.gz | sudo docker compose exec -T postgres psql -U postgres -d erp`.

## Sharing a server that already runs nginx

If something else (an Odoo nginx, for example) already holds ports 80 and 443,
leave Caddy out (start without `--profile caddy`). The web app and API then
listen only on `127.0.0.1:3100` and `127.0.0.1:4100`, and nginx proxies to them.
See `nginx-example.conf`. Company subdomains need a wildcard certificate, which
Let's Encrypt only issues through a DNS challenge:

```bash
sudo certbot certonly --manual --preferred-challenges dns -d erp.example.com -d '*.erp.example.com'
```

(or a certbot DNS plugin for your DNS provider, so renewals are automatic).

## How HTTPS for companies works

Caddy issues each company's certificate on its first visit, after asking the API
(`/tls/allowed`) whether that company exists. Random names pointed at the server
never get certificates, and no DNS provider key is needed.
