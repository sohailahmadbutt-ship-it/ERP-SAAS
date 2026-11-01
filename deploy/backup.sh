#!/bin/bash
# Nightly database backup, keeping 14 days. Add to cron, e.g.:
#   15 2 * * * /opt/erp-saas/deploy/backup.sh >> /var/log/erp-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
file="backups/erp-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T postgres pg_dump -U postgres -d erp --no-owner | gzip > "$file"
find backups -name 'erp-*.sql.gz' -mtime +14 -delete
echo "Saved $file"
