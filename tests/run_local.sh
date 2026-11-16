#!/usr/bin/env bash
# 本地跑权限测试：需要一个空的 Postgres（PGHOST/PGPORT/PGUSER 指向它）
set -euo pipefail
cd "$(dirname "$0")/.."
psql -v ON_ERROR_STOP=1 -q -c "drop database if exists order_hub_test" -c "create database order_hub_test"
P="psql -v ON_ERROR_STOP=1 -q -tA -o /dev/null -d order_hub_test"
$P -c "create extension if not exists pgcrypto" -f tests/supabase_stub.sql
for f in supabase/migrations/*.sql; do $P -f "$f"; done
$P -f tests/permissions_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
