#!/bin/bash
# ============================================================
# Sourcing Lab — 프로덕션 배포 스크립트
# 사용법: 
#   서버에서 직접: bash deploy.sh
#   원격에서:      ssh -p 2222 root@lumiriz.kr "cd /root/sourcing-lab && bash deploy.sh"
# ============================================================

set -e
cd /root/sourcing-lab

echo "==============================="
echo " Sourcing Lab Deploy Script"
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo "==============================="

# 1. Git pull (reset local changes like rebuilt zip files)
echo "[1/5] Git reset + pull..."
git checkout -- . 2>&1 || true
git pull origin main 2>&1

# 2. Install deps
echo "[2/5] Installing dependencies..."
pnpm install --frozen-lockfile 2>&1 || pnpm install 2>&1

# 3. Run DB migrations (if new migration exists)
echo "[3/5] Checking DB migrations..."
if [ -f drizzle/0008_keyword_daily_stats.sql ]; then
  echo "  Applying 0008_keyword_daily_stats.sql..."
  mysql -u root -p"$MYSQL_ROOT_PASS" sourcing_lab < drizzle/0008_keyword_daily_stats.sql 2>&1 || echo "  (already applied or skipped)"
fi
if [ -f drizzle/0009_product_tracking.sql ]; then
  echo "  Applying 0009_product_tracking.sql..."
  mysql -u root -p"$MYSQL_ROOT_PASS" sourcing_lab < drizzle/0009_product_tracking.sql 2>&1 || echo "  (already applied or skipped)"
fi
if [ -f drizzle/0010_sales_estimation.sql ]; then
  echo "  Applying 0010_sales_estimation.sql..."
  mysql -u root -p"$MYSQL_ROOT_PASS" sourcing_lab < drizzle/0010_sales_estimation.sql 2>&1 || echo "  (already applied or skipped)"
fi
if [ -f drizzle/0011_hybrid_data_collection.sql ]; then
  echo "  Applying 0011_hybrid_data_collection.sql..."
  mysql -u root -p"$MYSQL_ROOT_PASS" sourcing_lab < drizzle/0011_hybrid_data_collection.sql 2>&1 || echo "  (already applied or skipped)"
fi

# 4. Build
echo "[4/5] Building..."
pnpm run build 2>&1

# 5. Restart PM2
echo "[5/5] Restarting PM2..."
pm2 restart sourcing-lab --update-env 2>&1 || pm2 restart all 2>&1

echo ""
echo "==============================="
echo " Deploy complete!"
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo "==============================="

# Verify
sleep 2
curl -s http://localhost:3003/api/deploy/status 2>&1 || echo "(status check pending...)"
