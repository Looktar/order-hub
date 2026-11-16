#!/usr/bin/env bash
# 通过 Supabase 管理接口执行 SQL，只需要访问令牌，不需要数据库密码。
# 用法：scripts/sb_sql.sh "select 1"   或   scripts/sb_sql.sh -f 文件.sql
# 需要环境变量：SUPABASE_ACCESS_TOKEN、PROJECT_REF
set -euo pipefail
if [ "${1:-}" = "-f" ]; then q=$(cat "$2"); else q="$1"; fi
resp=$(curl -sS -w '\n%{http_code}' -X POST "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  --data-binary "$(jq -Rs '{query: .}' <<< "$q")")
code=$(tail -n1 <<< "$resp"); body=$(sed '$d' <<< "$resp")
if [ "$code" -ge 300 ]; then echo "SQL 执行失败（$code）：$body" >&2; exit 1; fi
echo "$body"
