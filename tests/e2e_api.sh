#!/usr/bin/env bash
# 端到端测试：在本地 Supabase（supabase start）上，用真实的登录、接口、照片存储走一遍完整流程。
# 需要环境变量：API_URL、ANON_KEY、SERVICE_ROLE_KEY（来自 supabase status -o env）
set -euo pipefail
FN="$API_URL/functions/v1/api"
pass=0
ok()   { echo "通过：$1"; pass=$((pass+1)); }
die()  { echo "测试失败：$1"; echo "$2"; exit 1; }
expect() { # 描述 期望值 实际值
  if [ "$2" = "$3" ]; then ok "$1"; else die "$1" "期望 [$2]，实际 [$3]"; fi
}

login() { # 邮箱 密码 → access token
  curl -sf "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | jq -r .access_token
}
call() { # 令牌 方法 路径 [JSON]
  local tok=$1 m=$2 p=$3 b=${4:-}
  if [ -n "$b" ]; then
    curl -s -X "$m" "$FN$p" -H "Authorization: Bearer $tok" -H "X-Agent-Name: ${AGENT:-测试Agent}" -H "Content-Type: application/json" -d "$b"
  else
    curl -s -X "$m" "$FN$p" -H "Authorization: Bearer $tok" -H "X-Agent-Name: ${AGENT:-测试Agent}"
  fi
}
code() { # 只取状态码
  local tok=$1 m=$2 p=$3 b=${4:-"{}"}
  curl -s -o /dev/null -w "%{http_code}" -X "$m" "$FN$p" -H "Authorization: Bearer $tok" -H "Content-Type: application/json" -d "$b"
}

# ---------- 第一个管理员 ----------
curl -sf "$API_URL/auth/v1/admin/users" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -d '{"email":"boss@example.com","password":"boss-pass-1234","email_confirm":true}' > /dev/null
BOSS=$(login boss@example.com boss-pass-1234)
curl -sf "$API_URL/rest/v1/rpc/bootstrap_admin" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $BOSS" \
  -H "Content-Type: application/json" -d '{"p_name":"老板"}' > /dev/null
expect "第一个管理员设置成功" "company" "$(call "$BOSS" GET /me | jq -r .role)"

# ---------- 管理员开账号 ----------
mk() { call "$BOSS" POST /admin/users "{\"name\":\"$1\",\"role\":\"$2\",\"login\":\"$3\",\"password\":\"pass-$3\"}" | jq -r .id; }
mk 销售甲 sales sales-a > /dev/null
mk 销售乙 sales sales-b > /dev/null
mk 公司二 company office2 > /dev/null
mk 司机老王 driver wang01 > /dev/null
mk 司机老李 driver li02 > /dev/null
expect "管理员开了 5 个账号" "6" "$(call "$BOSS" GET /admin/users | jq length)"

D=users.order-hub.app
SA_W=$(login sales-a@$D pass-sales-a); SB_W=$(login sales-b@$D pass-sales-b)
C2_W=$(login office2@$D pass-office2); D1_W=$(login wang01@$D pass-wang01); D2_W=$(login li02@$D pass-li02)
expect "没有邮箱的司机用登录名也能登录" "driver" "$(call "$D1_W" GET /me | jq -r .role)"
expect "非管理员不能开账号" "403" "$(code "$SA_W" POST /admin/users '{"name":"x","role":"sales","login":"xx1","password":"12345678"}')"

# ---------- 每人生成 Agent 令牌 ----------
tok() { call "$1" POST /tokens "{\"label\":\"$2\"}" | jq -r .token; }
SA=$(tok "$SA_W" Claude); SB=$(tok "$SB_W" Muse); C1=$(tok "$BOSS" 公司Agent); C2=$(tok "$C2_W" 公司Agent2)
D1=$(tok "$D1_W" Codex); D2=$(tok "$D2_W" 其他Agent)
expect "令牌以 oh_ 开头" "oh_" "${SA:0:3}"
expect "Agent 不能用令牌再生成令牌" "403" "$(code "$SA" POST /tokens)"

# ---------- 销售甲提交订单并上传照片 ----------
AGENT=Claude
O1=$(call "$SA" POST /orders '{"customer":"客户甲汽修","address":"123 Main St, Markham","contact":"王先生 905-000-0000","due_date":"2026-11-20",
  "items":[{"category":"oil","spec":"5W-30","qty":12,"unit":"箱"},{"category":"oil_filter","spec":"PH-3614","qty":20,"unit":"个"}]}' | jq -r .id)
expect "销售甲提交订单" "1" "$O1"
printf '\xff\xd8\xff\xe0fakejpeg' > /tmp/p.jpg
PH=$(curl -s -X POST "$FN/orders/$O1/photos?kind=order" -H "Authorization: Bearer $SA" -H "Content-Type: image/jpeg" --data-binary @/tmp/p.jpg | jq -r .id)
[ "$PH" != "null" ] && ok "销售甲上传订单照片" || die "销售甲上传订单照片" "$PH"
URL=$(call "$SA" GET "/photos/$PH" | jq -r .url)
expect "销售甲能打开自己的照片" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$URL")"
O2=$(call "$SB" POST /orders '{"customer":"客户乙","items":[{"category":"tire","spec":"225/65R17","qty":4,"unit":"条"}]}' | jq -r .id)

# ---------- 隔离 ----------
expect "销售乙读不到订单 1" "404" "$(code "$SB" GET /orders/$O1)"
expect "销售乙打不开订单 1 的照片" "404" "$(code "$SB" GET /photos/$PH)"
expect "销售乙列表只有自己的订单" "$O2" "$(call "$SB" GET /orders | jq -r '[.[].id] | join(",")')"
expect "错误令牌被拒绝" "401" "$(code oh_wrong GET /orders)"
expect "不带令牌被拒绝" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$FN/orders")"
notok() { if [ "$2" != "200" ]; then ok "$1（$2）"; else die "$1" "返回了 200"; fi; }
notok "匿名直接读数据库被拒绝" "$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/rest/v1/orders" -H "apikey: $ANON_KEY")"
PHPATH=$(call "$SA" GET /orders/$O1 | jq -r '.photos[0].path')
notok "匿名直接读照片被拒绝" "$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/storage/v1/object/authenticated/photos/$PHPATH" -H "apikey: $ANON_KEY")"
SB_JWT_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/storage/v1/object/authenticated/photos/$PHPATH" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $SB_W")
notok "销售乙用自己的登录直接读订单 1 的照片被拒绝" "$SB_JWT_CODE"

# ---------- 公司派单、修改 ----------
AGENT=公司Agent
expect "公司收到新订单通知" "2" "$(call "$C1" GET /notifications | jq '[.[] | select(.type=="submitted")] | length')"
call "$C1" POST /orders/$O1/assign '{"driver_name":"司机老王"}' > /dev/null
call "$C1" POST /orders/$O2/assign '{"driver_name":"司机老李"}' > /dev/null
expect "派单后销售甲不能再改" "403" "$(code "$SA" POST /orders/$O1/changes '{"fields":{"note":"x"}}')"
for t in "$SA" "$SB" "$C1" "$C2" "$D1" "$D2"; do call "$t" POST /notifications/read '{}' > /dev/null; done

ITEM_OIL=$(call "$C1" GET /orders/$O1 | jq -r '.items[] | select(.category=="oil") | .id')
expect "公司改单不写原因被拒" "400" "$(code "$C1" POST /orders/$O1/changes "{\"items\":[{\"id\":$ITEM_OIL,\"qty\":10}]}")"
call "$C1" POST /orders/$O1/changes "{\"reason\":\"库存不足\",\"items\":[{\"id\":$ITEM_OIL,\"qty\":10}]}" > /dev/null
n_mod() { call "$1" GET /notifications | jq "[.[] | select(.type==\"modified\" and .order_id==$O1)] | length"; }
expect "公司改单：销售甲收到" "1" "$(n_mod "$SA")"
expect "公司改单：公司二收到" "1" "$(n_mod "$C2")"
expect "公司改单：操作人自己不收" "0" "$(n_mod "$C1")"
expect "公司改单：销售乙收不到" "0" "$(n_mod "$SB")"
expect "公司改单：司机老王收不到" "0" "$(n_mod "$D1")"
expect "公司改单：司机老李收不到" "0" "$(n_mod "$D2")"
for t in "$SA" "$C1" "$C2"; do call "$t" POST /notifications/read '{}' > /dev/null; done

# ---------- 司机送货、现场改单 ----------
AGENT=Codex
expect "司机老李读不到订单 1" "404" "$(code "$D2" GET /orders/$O1)"
expect "司机老王看到最新数量 10" "10" "$(call "$D1" GET /orders/$O1 | jq -r ".items[] | select(.id==$ITEM_OIL) | .qty")"
call "$D1" POST /orders/$O1/start > /dev/null
expect "司机不能改送货地址" "403" "$(code "$D1" POST /orders/$O1/changes '{"reason":"x","fields":{"address":"别处"}}')"
call "$D1" POST /orders/$O1/changes "{\"reason\":\"客户现场只收 8 箱\",\"items\":[{\"id\":$ITEM_OIL,\"qty\":8}]}" > /dev/null
expect "司机改单：销售甲收到" "1" "$(n_mod "$SA")"
expect "司机改单：公司一收到" "1" "$(n_mod "$C1")"
expect "司机改单：公司二收到" "1" "$(n_mod "$C2")"
expect "司机改单：销售乙收不到" "0" "$(n_mod "$SB")"
expect "司机改单：司机老李收不到" "0" "$(n_mod "$D2")"
CH=$(call "$SA" GET /orders/$O1 | jq -r '.changes[-1] | "\(.old)→\(.new)|\(.reason)|\(.via)|\(.role)"')
expect "修改记录有原值、新值、原因、经由" "10箱→8箱|客户现场只收 8 箱|Codex|driver" "$CH"

expect "没有签收照片不能确认送达" "400" "$(code "$D1" POST /orders/$O1/delivered)"
expect "司机老李不能给订单 1 传签收照片" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$FN/orders/$O1/photos?kind=signoff" -H "Authorization: Bearer $D2" -H "Content-Type: image/jpeg" --data-binary @/tmp/p.jpg)"
curl -sf -X POST "$FN/orders/$O1/photos?kind=signoff" -H "Authorization: Bearer $D1" -H "Content-Type: image/jpeg" --data-binary @/tmp/p.jpg > /dev/null
call "$D1" POST /orders/$O1/delivered > /dev/null
expect "订单 1 已送达" "delivered" "$(call "$SA" GET /orders/$O1 | jq -r .status)"
expect "销售甲收到已送达通知" "1" "$(call "$SA" GET /notifications | jq '[.[] | select(.type=="delivered")] | length')"
expect "已送达后不能再改" "400" "$(code "$C1" POST /orders/$O1/changes "{\"reason\":\"x\",\"items\":[{\"id\":$ITEM_OIL,\"qty\":1}]}")"

# ---------- 令牌作废 ----------
U_D1=$(call "$BOSS" GET /admin/users | jq -r '.[] | select(.login=="wang01") | .id')
call "$BOSS" POST /admin/users/$U_D1/tokens/reset > /dev/null
expect "管理员作废令牌后立刻失效" "401" "$(code "$D1" GET /orders)"

echo "共 $pass 项通过"
echo E2E_API_PASSED
