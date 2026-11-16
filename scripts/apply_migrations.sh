#!/usr/bin/env bash
# 把 supabase/migrations 里还没执行过的文件按顺序执行，每个文件一个事务。
# 记录在 supabase_migrations.schema_migrations（和 Supabase CLI 用的是同一张表）。
set -euo pipefail
cd "$(dirname "$0")/.."
S=scripts/sb_sql.sh
$S "create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);" > /dev/null
done_list=$($S "select coalesce(json_agg(version), '[]') as v from supabase_migrations.schema_migrations" | jq -r '.[0].v[]?')
for f in supabase/migrations/*.sql; do
  base=$(basename "$f" .sql); version=${base%%_*}; name=${base#*_}
  if grep -qx "$version" <<< "$done_list"; then echo "已执行过：$base"; continue; fi
  echo "执行：$base"
  tmp=$(mktemp)
  { echo "begin;"; cat "$f"; echo;
    echo "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name');";
    echo "commit;"; } > "$tmp"
  $S -f "$tmp" > /dev/null
  rm -f "$tmp"
done
echo "数据库已是最新"
