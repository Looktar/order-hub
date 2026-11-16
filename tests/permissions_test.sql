-- 权限与通知规则测试。对应开发提示词第 11 节的验收标准。
-- 运行：先执行 supabase_stub.sql（仅本地）和全部迁移，再执行本文件。任何一条失败都会报错退出。
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema t;
grant usage on schema t to authenticated, anon;
create function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception '测试失败：%', msg; end if;
  raise notice '通过：%', msg;
end $$;
create function t.fails(sql text, msg text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    raise notice '通过：% （%）', msg, sqlerrm;
    return;
  end;
  raise exception '测试失败：本应被拒绝：%', msg;
end $$;
grant execute on all functions in schema t to authenticated, anon;

-- 测试账号
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000a001'), ('00000000-0000-0000-0000-00000000a002'),
  ('00000000-0000-0000-0000-00000000c001'), ('00000000-0000-0000-0000-00000000c002'),
  ('00000000-0000-0000-0000-00000000d001'), ('00000000-0000-0000-0000-00000000d002');
insert into public.profiles (id, name, role, is_admin) values
  ('00000000-0000-0000-0000-00000000a001', '销售甲', 'sales', false),
  ('00000000-0000-0000-0000-00000000a002', '销售乙', 'sales', false),
  ('00000000-0000-0000-0000-00000000c001', '公司一', 'company', true),
  ('00000000-0000-0000-0000-00000000c002', '公司二', 'company', false),
  ('00000000-0000-0000-0000-00000000d001', '司机一', 'driver', false),
  ('00000000-0000-0000-0000-00000000d002', '司机二', 'driver', false);

create function t.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p, false)
$$;
grant execute on function t.as_user(text) to authenticated, anon;

-- ============ 销售提交订单 ============
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000a001');
select t.ok(public.submit_order('{"customer":"客户甲","address":"地址甲","items":[
  {"category":"oil","spec":"5W-30","qty":12,"unit":"箱"},
  {"category":"oil_filter","spec":"F-100","qty":20,"unit":"个"}]}', 'Claude') = 1, '销售甲提交订单 #1');

select t.as_user('00000000-0000-0000-0000-00000000a002');
select t.ok(public.submit_order('{"customer":"客户乙","items":[
  {"category":"tire","spec":"225/65R17","qty":4,"unit":"条"}]}') = 2, '销售乙提交订单 #2');

-- 销售之间互相隔离
select t.ok((select count(*) from public.orders) = 1 and (select min(id) from public.orders) = 2, '销售乙只看到自己的订单');
select t.ok((select count(*) from public.order_items where order_id = 1) = 0, '销售乙读不到订单 #1 的货品');
select t.ok(public.order_detail(1) is null, '销售乙读不到订单 #1 的详情');
select t.fails($$select public.modify_order(1, '{"items":[{"id":1,"qty":1}]}', 'x')$$, '销售乙不能改销售甲的订单');

select t.as_user('00000000-0000-0000-0000-00000000a001');
select t.ok((select count(*) from public.orders) = 1 and (select min(id) from public.orders) = 1, '销售甲只看到自己的订单');

-- 销售在公司处理前可以改
select t.ok(public.modify_order(1, '{"fields":{"note":"下午送"}}', null) = 1, '销售甲在公司处理前可以改自己的订单');

-- 角色限制
select t.fails($$select public.assign_driver(1, '00000000-0000-0000-0000-00000000d001')$$, '销售不能派单');

-- ============ 公司 ============
select t.as_user('00000000-0000-0000-0000-00000000c001');
select t.ok((select count(*) from public.orders) = 2, '公司看到全部订单');
select t.ok((select count(*) from public.my_notifications() where type = 'submitted') = 2, '公司收到两张新订单通知');
select t.fails($$select public.submit_order('{"customer":"x","items":[{"category":"oil","qty":1}]}')$$, '公司不能以销售身份提交订单');

select public.assign_driver(1, '00000000-0000-0000-0000-00000000d001', '公司Agent');
select public.assign_driver(2, '00000000-0000-0000-0000-00000000d002');

-- 派单后销售不能再改
select t.as_user('00000000-0000-0000-0000-00000000a001');
select t.fails($$select public.modify_order(1, '{"fields":{"note":"改"}}', null)$$, '公司处理后销售不能再改');
select t.ok(exists (select 1 from public.my_notifications() where order_id = 1 and type = 'assigned'), '销售甲收到派单通知');

-- 先清空所有人的未读，方便下面精确检查"谁收到了修改通知"
reset role;
update public.event_recipients set read_at = now();
set role authenticated;

-- 公司修改订单
select t.as_user('00000000-0000-0000-0000-00000000c001');
select t.fails($$select public.modify_order(1, '{"items":[{"id":1,"qty":10}]}', '')$$, '公司修改必须填原因');
select t.ok(public.modify_order(1, '{"items":[{"id":1,"qty":10}]}', '库存不足', '公司Agent') = 1, '公司把机油 12 箱改为 10 箱');

reset role;
select t.ok((select array_agg(p.name order by p.name) from public.event_recipients r
               join public.events e on e.id = r.event_id join public.profiles p on p.id = r.user_id
              where e.type = 'modified' and e.order_id = 1 and r.read_at is null)
            = array['公司二', '销售甲'], '公司修改：只有其他公司账号和该单销售收到通知（司机、其他销售、操作人本人都收不到）');
select t.ok((select old_value || '→' || new_value || '|' || reason || '|' || via || '|' || actor_role
               from public.order_changes where order_id = 1 and field like '机油%')
            = '12箱→10箱|库存不足|公司Agent|company', '修改记录有原值、新值、原因、经由');
update public.event_recipients set read_at = now();
set role authenticated;

-- ============ 司机 ============
select t.as_user('00000000-0000-0000-0000-00000000d002');
select t.ok((select count(*) from public.orders) = 1 and (select min(id) from public.orders) = 2, '司机二只看到派给自己的订单');
select t.fails($$select public.modify_order(1, '{"items":[{"id":1,"qty":1}]}', '客户要求')$$, '司机二不能改别人的订单');
select t.fails($$select public.start_delivery(1)$$, '司机二不能操作别人的订单');

select t.as_user('00000000-0000-0000-0000-00000000d001');
select t.ok((select count(*) from public.orders) = 1 and (select min(id) from public.orders) = 1, '司机一只看到派给自己的订单');
select t.ok((select (public.order_detail(1)->'items'->0->>'qty')::numeric) = 10, '司机看到的是公司修改后的最新数量');
select t.ok((select public.order_detail(1)->>'modified_by') = 'company', '司机看到"公司改过"的标记');
select public.start_delivery(1, 'Codex');

select t.fails($$select public.modify_order(1, '{"items":[{"id":1,"qty":8}]}', null)$$, '司机修改必须填原因');
select t.fails($$select public.modify_order(1, '{"fields":{"address":"别处"}}', '客户要求')$$, '司机不能改送货地址');
select t.ok(public.modify_order(1, '{"items":[{"id":1,"qty":8},{"add":{"category":"rim","spec":"17寸","qty":4,"unit":"个"}}]}',
                                '客户现场只收 8 箱，另加 4 个轮毂', 'Codex') = 2, '司机在送货时修改数量并加货品');

reset role;
select t.ok((select array_agg(p.name order by p.name) from public.event_recipients r
               join public.events e on e.id = r.event_id join public.profiles p on p.id = r.user_id
              where e.type = 'modified' and e.order_id = 1 and r.read_at is null)
            = array['公司一', '公司二', '销售甲'], '司机修改：只有公司和该单销售收到通知');
select t.ok((select count(*) from public.order_changes where order_id = 1 and actor_role = 'driver') = 2, '司机的两项修改都有记录');
select t.ok((select modified_by from public.orders where id = 1) = 'driver', '订单标记为司机修改过');

-- 直接改表一律被拒绝
set role authenticated;
select t.fails($$update public.orders set status = 'delivered' where id = 1$$, '不能绕过函数直接改订单表');
select t.fails($$delete from public.order_changes$$, '修改记录不能删除');
select t.fails($$update public.order_changes set reason = 'x'$$, '修改记录不能改');
select t.fails($$select * from public.agent_tokens$$, '读不到 Agent 令牌表');
select t.fails($$select app.emit(1, 'x', null, '{"zh":"x","en":"x","es":"x"}'::jsonb, array['company'])$$, '不能直接伪造通知');

-- 送达
select t.fails($$select public.confirm_delivered(1)$$, '没有签收照片不能确认送达');
select t.as_user('00000000-0000-0000-0000-00000000d002');
select t.fails($$insert into storage.objects (bucket_id, name) values ('photos', '1/signoff/x.jpg')$$, '司机二不能给订单 #1 传签收照片');
select t.as_user('00000000-0000-0000-0000-00000000a001');
select t.fails($$insert into storage.objects (bucket_id, name) values ('photos', '1/signoff/y.jpg')$$, '销售不能传签收照片');
select t.as_user('00000000-0000-0000-0000-00000000d001');
insert into storage.objects (bucket_id, name) values ('photos', '1/signoff/ok.jpg');
select t.ok(public.add_photo(1, 'signoff', '1/signoff/ok.jpg', 'Codex') > 0, '司机一上传签收照片');
select t.fails($$select public.add_photo(1, 'signoff', '2/signoff/z.jpg')$$, '照片路径必须属于本订单');
select public.confirm_delivered(1, 'Codex');
select t.fails($$select public.modify_order(1, '{"items":[{"id":1,"qty":1}]}', 'x')$$, '已送达后司机不能再改');

select t.as_user('00000000-0000-0000-0000-00000000a001');
select t.ok(exists (select 1 from public.my_notifications() where order_id = 1 and type = 'delivered'), '销售甲收到已送达通知');
select t.ok((select count(*) from storage.objects where name like '1/%') = 1, '销售甲能看到自己订单的照片');
select t.ok(public.mark_read() > 0, '销售甲标记通知已读');
select t.ok((select count(*) from public.my_notifications()) = 0, '标记后没有未读通知');

select t.as_user('00000000-0000-0000-0000-00000000a002');
select t.ok((select count(*) from storage.objects where name like '1/%') = 0, '销售乙看不到订单 #1 的照片');
select t.ok(not exists (select 1 from public.my_notifications(false) where order_id = 1), '销售乙从没收到过订单 #1 的任何通知');
select t.ok((select count(*) from public.events where order_id = 1) = 0, '销售乙读不到订单 #1 的事件');

-- 问题上报
select t.as_user('00000000-0000-0000-0000-00000000d002');
select public.report_issue(2, '客户不在');
select t.as_user('00000000-0000-0000-0000-00000000a002');
select t.ok(exists (select 1 from public.my_notifications() where order_id = 2 and type = 'issue'), '销售乙收到送货问题通知');
select t.as_user('00000000-0000-0000-0000-00000000a001');
select t.ok(not exists (select 1 from public.my_notifications(false) where order_id = 2), '销售甲收不到订单 #2 的通知');

-- 停用账号
reset role;
update public.profiles set active = false where id = '00000000-0000-0000-0000-00000000a002';
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000a002');
select t.ok((select count(*) from public.orders) = 0, '停用的账号看不到任何订单');

-- 未登录
reset role;
set role anon;
select t.as_user('');
select t.fails($$select * from public.orders$$, '未登录读不到订单');
select t.fails($$select * from public.my_notifications()$$, '未登录读不到通知');
select t.fails($$select public.order_detail(1)$$, '未登录读不到订单详情');
set role authenticated;
select t.as_user('');
select t.ok((select count(*) from public.orders) = 0, '令牌无效（无身份）时读不到订单');
select t.ok((select count(*) from storage.objects) = 0, '令牌无效（无身份）时读不到照片');

-- 时间戳
reset role;
select t.ok((select created_at is not null and assigned_at is not null and started_at is not null and delivered_at is not null
               and created_at <= assigned_at and assigned_at <= started_at and started_at <= delivered_at
             from public.orders where id = 1), '订单 #1 下单、派单、出发、送达时间都有，且先后顺序正确');
select t.ok((select assigned_at is not null and started_at is null and delivered_at is null from public.orders where id = 2), '订单 #2 只有派单时间（还没出发）');
select t.ok((public.order_detail(1) ? 'started_at') and (public.order_detail(1) ? 'assigned_at'), '订单详情里有派单和出发时间');
update public.orders set created_at = now() + interval '1 day' where id = 1;
select t.ok((select created_at < now() from public.orders where id = 1), '下单时间不能被改');

-- 多语言
reset role;
select t.ok((select count(*) from public.events where summary_i18n ?& array['zh', 'en', 'es']) = (select count(*) from public.events), '每条通知都有中英西三种语言');
select t.ok((select summary_i18n->>'en' from public.events where type = 'modified' and order_id = 1 order by id desc limit 1)
            like 'Order #1 changed by 司机一 (driver): Engine oil 5W-30: 10 → 8箱%reason: 客户现场只收 8 箱%', '英文修改通知内容正确');
select t.ok((select summary_i18n->>'es' from public.events where type = 'delivered' and order_id = 1) like 'Pedido #1 (客户甲) entregado.%', '西班牙文送达通知内容正确');
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000a001');
select public.set_my_lang('es');
select t.ok((select summary from public.my_notifications(false) where type = 'delivered' limit 1) like 'Pedido #1%', '销售甲改成西班牙语后通知按西班牙语显示');
select t.ok((select summary from public.my_notifications(false, 50, 'en') where type = 'delivered' limit 1) like 'Order #1%', '可以临时指定英语');
select t.ok((public.order_detail(1)->'items'->0->>'category_label') = 'Aceite de motor', '订单详情货品名按西班牙语显示');
select t.ok((select string_agg(c->>'field', ',') from jsonb_array_elements(public.order_detail(1, 'en')->'changes') c) like '%Engine oil 5W-30%', '修改记录按英语显示货品名');
select t.fails($$select public.set_my_lang('fr')$$, '不支持的语言被拒绝');
do $$ begin
  perform public.modify_order(1, '{"items":[{"id":1,"qty":1}]}', 'x');
  raise exception '本应失败';
exception when others then
  declare h text; begin
    get stacked diagnostics h = pg_exception_hint;
    if h is distinct from 'order_not_found' and h is distinct from 'sales_edit_locked' then raise exception '测试失败：错误代码不对：%', h; end if;
    raise notice '通过：报错带错误代码（%）', h;
  end;
end $$;

-- 第一个管理员只能设一次
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'x@example.com');
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000e1');
select t.ok(public.needs_bootstrap() = false, '已有管理员时不需要初始化');
select t.fails($$select public.bootstrap_admin('冒充者')$$, '已有管理员时不能再把自己设为管理员');
select t.ok((select count(*) from public.orders) = 0, '没有资料的登录用户看不到任何订单');

reset role;
\echo ALL_TESTS_PASSED
