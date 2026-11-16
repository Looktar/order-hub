-- 多语言（中文 zh / 英文 en / 西班牙文 es）
-- 1. 每个用户有自己的语言；Agent 接口默认按这个语言回复
-- 2. 每条通知同时生成三种语言（events.summary_i18n），各人看自己的语言
-- 3. 修改记录存字段代码（field_key），由网页按语言显示
-- 4. 所有报错带一个错误代码（hint），网页和接口按语言翻译；原来的中文说明保留在 message 里

-- ---------------------------------------------------------------- 结构
alter table public.profiles add column lang text not null default 'zh' check (lang in ('zh', 'en', 'es'));
alter table public.events add column summary_i18n jsonb;
alter table public.order_changes add column field_key text;
alter table public.order_changes alter column reason drop not null;

-- 旧记录补上三语摘要（目前只有中文）
update public.events set summary_i18n = jsonb_build_object('zh', summary, 'en', summary, 'es', summary) where summary_i18n is null;

-- ---------------------------------------------------------------- 标签
create or replace function app.category_i18n(c public.item_category) returns jsonb
language sql immutable as $$
  select case c
    when 'oil'        then '{"zh":"机油","en":"Engine oil","es":"Aceite de motor"}'
    when 'oil_filter' then '{"zh":"机油滤芯","en":"Oil filter","es":"Filtro de aceite"}'
    when 'tire'       then '{"zh":"轮胎","en":"Tire","es":"Neumático"}'
    when 'rim'        then '{"zh":"轮毂","en":"Rim","es":"Rin"}'
  end::jsonb
$$;

create or replace function app.role_i18n(r public.user_role) returns jsonb
language sql immutable as $$
  select case r
    when 'sales'   then '{"zh":"销售","en":"sales rep","es":"vendedor"}'
    when 'company' then '{"zh":"公司","en":"company","es":"empresa"}'
    when 'driver'  then '{"zh":"司机","en":"driver","es":"conductor"}'
  end::jsonb
$$;

create or replace function app.field_i18n(f text) returns jsonb
language sql immutable as $$
  select case f
    when 'customer' then '{"zh":"客户","en":"Customer","es":"Cliente"}'
    when 'address'  then '{"zh":"送货地址","en":"Delivery address","es":"Dirección de entrega"}'
    when 'contact'  then '{"zh":"收货人","en":"Recipient","es":"Contacto"}'
    when 'due_date' then '{"zh":"要求送达","en":"Requested delivery date","es":"Fecha de entrega"}'
    when 'note'     then '{"zh":"备注","en":"Note","es":"Nota"}'
  end::jsonb
$$;

-- 数量加单位：拉丁字母的单位前面加空格（8 cajas），中文单位不加（8箱）
create or replace function app.qu(q numeric, unit text) returns text
language sql immutable as $$
  select app.fmt_qty(q) || case when coalesce(unit, '') ~ '^[A-Za-zÀ-ÿ]' then ' ' else '' end || coalesce(unit, '')
$$;

-- 抛出带错误代码的异常：message 是中文说明，hint 是错误代码，detail 是参数（JSON）
create or replace function app.fail(p_key text, p_msg text, p_params jsonb default '{}', p_code text default 'P0001')
returns void language plpgsql as $$
begin
  raise exception using message = p_msg, hint = p_key, detail = p_params::text, errcode = p_code;
end $$;

-- ---------------------------------------------------------------- 内部函数（加错误代码）
create or replace function app.require_me() returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare v public.profiles;
begin
  v := app.me();
  if v.id is null then perform app.fail('not_logged_in', '未登录或账号已停用', '{}', '42501'); end if;
  return v;
end $$;

create or replace function app.lock_order(p_order bigint) returns public.orders
language plpgsql security definer set search_path = public as $$
declare v public.orders;
begin
  select * into v from public.orders where id = p_order for update;
  if v.id is null or not app.can_see_order(p_order) then
    perform app.fail('order_not_found', format('订单 #%s 不存在或无权访问', p_order), jsonb_build_object('id', p_order), '42501');
  end if;
  return v;
end $$;

-- 新的通知函数：p_summary 是 {"zh","en","es"}
drop function if exists app.emit(bigint, text, text, text, text[]);
create function app.emit(p_order bigint, p_type text, p_via text, p_summary jsonb, p_to text[])
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_event bigint;
  v_o     public.orders;
begin
  select * into v_o from public.orders where id = p_order;
  insert into public.events (order_id, type, actor_id, via, summary, summary_i18n)
  values (p_order, p_type, auth.uid(), app.via(p_via), p_summary->>'zh', p_summary)
  returning id into v_event;

  insert into public.event_recipients (event_id, user_id)
  select distinct v_event, uid from (
    select p.id as uid from public.profiles p
      where 'company' = any(p_to) and p.role = 'company' and p.active
    union all select v_o.sales_id  where 'sales'  = any(p_to)
    union all select v_o.driver_id where 'driver' = any(p_to) and v_o.driver_id is not null
  ) r
  where uid is not null and uid is distinct from auth.uid();
  return v_event;
end $$;
revoke execute on function app.emit(bigint, text, text, jsonb, text[]) from public, anon, authenticated;

-- 三语句子工具：按语言填同一组参数
create or replace function app.tri(zh text, en text, es text) returns jsonb
language sql immutable as $$ select jsonb_build_object('zh', zh, 'en', en, 'es', es) $$;

-- ---------------------------------------------------------------- 写操作（重写，内容与之前相同，只是多语言化）
create or replace function public.submit_order(p jsonb, p_via text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := app.require_me();
  v_id bigint;
  it jsonb;
  i int := 0;
  c text := p->>'customer';
begin
  if me.role <> 'sales' then perform app.fail('sales_only_submit', '只有销售可以提交订单', '{}', '42501'); end if;
  if nullif(trim(coalesce(c, '')), '') is null then perform app.fail('customer_required', '请填写客户名称'); end if;
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then perform app.fail('need_items', '订单至少要有一项货品'); end if;

  insert into public.orders (sales_id, customer, address, contact, due_date, note)
  values (me.id, trim(c), coalesce(p->>'address', ''), coalesce(p->>'contact', ''),
          nullif(p->>'due_date', '')::date, coalesce(p->>'note', ''))
  returning id into v_id;

  for it in select * from jsonb_array_elements(p->'items') loop
    i := i + 1;
    if coalesce((it->>'qty')::numeric, -1) < 0 then perform app.fail('qty_negative', '数量不能小于 0'); end if;
    insert into public.order_items (order_id, category, spec, qty, unit, original_qty, position)
    values (v_id, (it->>'category')::public.item_category, coalesce(it->>'spec', ''),
            (it->>'qty')::numeric, coalesce(it->>'unit', ''), (it->>'qty')::numeric, i);
  end loop;

  perform app.emit(v_id, 'submitted', p_via, app.tri(
    format('新订单 #%s：%s（销售 %s 提交）', v_id, trim(c), me.name),
    format('New order #%s: %s (submitted by sales rep %s)', v_id, trim(c), me.name),
    format('Nuevo pedido #%s: %s (enviado por el vendedor %s)', v_id, trim(c), me.name)),
    array['company']);
  return v_id;
end $$;

create or replace function public.modify_order(p_order bigint, p_changes jsonb, p_reason text, p_via text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := app.require_me();
  o  public.orders := app.lock_order(p_order);
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  f text; v_old text; v_new text;
  ch jsonb; it public.order_items;
  n int := 0;
  lz text[] := '{}'; le text[] := '{}'; ls text[] := '{}';
  lab jsonb; fl jsonb;
  v_pos int; v_new_id bigint; v_qty numeric; v_unit text; v_cat public.item_category; v_spec text;
  rl jsonb := app.role_i18n(me.role);
begin
  if me.role = 'sales' then
    if o.sales_id <> me.id or o.status <> 'pending' then
      perform app.fail('sales_edit_locked', '公司开始处理后，销售不能再改订单', '{}', '42501');
    end if;
  elsif me.role = 'company' then
    if o.status = 'delivered' then perform app.fail('delivered_locked', '已送达的订单不能修改'); end if;
  elsif me.role = 'driver' then
    if o.driver_id is distinct from me.id or o.status not in ('assigned', 'delivering') then
      perform app.fail('driver_edit_scope', '司机只能修改派给自己、尚未送达的订单', '{}', '42501');
    end if;
    if p_changes ? 'fields' and p_changes->'fields' <> '{}'::jsonb then
      perform app.fail('driver_items_only', '司机只能修改货品，不能改客户和送货信息', '{}', '42501');
    end if;
  end if;
  if me.role in ('company', 'driver') and v_reason is null then
    perform app.fail('reason_required', '修改订单必须填写原因');
  end if;

  -- 订单字段
  for f, v_new in select key, value #>> '{}' from jsonb_each(coalesce(p_changes->'fields', '{}')) loop
    if f not in ('customer', 'address', 'contact', 'due_date', 'note') then
      perform app.fail('bad_field', format('不能修改字段 %s', f), jsonb_build_object('field', f));
    end if;
    if f = 'customer' and nullif(trim(coalesce(v_new, '')), '') is null then perform app.fail('customer_required', '请填写客户名称'); end if;
    execute format('select (%I)::text from public.orders where id = $1', f) into v_old using p_order;
    if coalesce(v_old, '') is distinct from coalesce(v_new, '') then
      execute format('update public.orders set %I = $1::%s where id = $2', f,
                     case f when 'due_date' then 'date' else 'text' end)
        using case when f in ('due_date') then nullif(v_new, '') else coalesce(v_new, '') end, p_order;
      fl := app.field_i18n(f);
      insert into public.order_changes (order_id, actor_id, actor_role, via, field, field_key, old_value, new_value, reason)
      values (p_order, me.id, me.role, app.via(p_via), fl->>'zh', f, v_old, v_new, v_reason);
      lz := lz || format('%s：%s → %s', fl->>'zh', coalesce(nullif(v_old, ''), '空'), coalesce(nullif(v_new, ''), '空'));
      le := le || format('%s: %s → %s', fl->>'en', coalesce(nullif(v_old, ''), '(empty)'), coalesce(nullif(v_new, ''), '(empty)'));
      ls := ls || format('%s: %s → %s', fl->>'es', coalesce(nullif(v_old, ''), '(vacío)'), coalesce(nullif(v_new, ''), '(vacío)'));
      n := n + 1;
    end if;
  end loop;

  -- 货品
  for ch in select * from jsonb_array_elements(coalesce(p_changes->'items', '[]')) loop
    if ch ? 'add' then
      v_cat := (ch->'add'->>'category')::public.item_category;
      v_spec := coalesce(ch->'add'->>'spec', '');
      v_qty := (ch->'add'->>'qty')::numeric;
      v_unit := coalesce(ch->'add'->>'unit', '');
      if v_qty is null or v_qty < 0 then perform app.fail('qty_negative', '数量不能小于 0'); end if;
      select coalesce(max(position), 0) + 1 into v_pos from public.order_items where order_id = p_order;
      insert into public.order_items (order_id, category, spec, qty, unit, original_qty, position)
      values (p_order, v_cat, v_spec, v_qty, v_unit, 0, v_pos)
      returning id into v_new_id;
      lab := app.category_i18n(v_cat);
      insert into public.order_changes (order_id, actor_id, actor_role, via, item_id, field, field_key, old_value, new_value, reason)
      values (p_order, me.id, me.role, app.via(p_via), v_new_id, trim(lab->>'zh' || ' ' || v_spec) || ' 数量', 'add',
              '0', app.qu(v_qty, v_unit), v_reason);
      lz := lz || format('新增 %s × %s', trim(lab->>'zh' || ' ' || v_spec), app.qu(v_qty, v_unit));
      le := le || format('added %s × %s', trim(lab->>'en' || ' ' || v_spec), app.qu(v_qty, v_unit));
      ls := ls || format('se agregó %s × %s', trim(lab->>'es' || ' ' || v_spec), app.qu(v_qty, v_unit));
      n := n + 1;
      continue;
    end if;

    select * into it from public.order_items where id = (ch->>'id')::bigint and order_id = p_order and not removed;
    if it.id is null then
      perform app.fail('no_item', format('订单 #%s 没有货品 %s', p_order, ch->>'id'), jsonb_build_object('id', p_order, 'item', ch->>'id'));
    end if;
    lab := app.category_i18n(it.category);

    if coalesce((ch->>'remove')::boolean, false) then
      update public.order_items set removed = true, qty = 0 where id = it.id;
      insert into public.order_changes (order_id, actor_id, actor_role, via, item_id, field, field_key, old_value, new_value, reason)
      values (p_order, me.id, me.role, app.via(p_via), it.id, trim(lab->>'zh' || ' ' || it.spec) || ' 数量', 'remove',
              app.qu(it.qty, it.unit), null, v_reason);
      lz := lz || format('删除 %s', trim(lab->>'zh' || ' ' || it.spec));
      le := le || format('removed %s', trim(lab->>'en' || ' ' || it.spec));
      ls := ls || format('se eliminó %s', trim(lab->>'es' || ' ' || it.spec));
      n := n + 1;
    elsif ch ? 'qty' and (ch->>'qty')::numeric is distinct from it.qty then
      v_qty := (ch->>'qty')::numeric;
      if v_qty < 0 then perform app.fail('qty_negative', '数量不能小于 0'); end if;
      update public.order_items set qty = v_qty where id = it.id;
      insert into public.order_changes (order_id, actor_id, actor_role, via, item_id, field, field_key, old_value, new_value, reason)
      values (p_order, me.id, me.role, app.via(p_via), it.id, trim(lab->>'zh' || ' ' || it.spec) || ' 数量', 'qty',
              app.qu(it.qty, it.unit), app.qu(v_qty, it.unit), v_reason);
      lz := lz || format('%s：%s → %s', trim(lab->>'zh' || ' ' || it.spec), app.fmt_qty(it.qty), app.qu(v_qty, it.unit));
      le := le || format('%s: %s → %s', trim(lab->>'en' || ' ' || it.spec), app.fmt_qty(it.qty), app.qu(v_qty, it.unit));
      ls := ls || format('%s: %s → %s', trim(lab->>'es' || ' ' || it.spec), app.fmt_qty(it.qty), app.qu(v_qty, it.unit));
      n := n + 1;
    end if;
  end loop;

  if n = 0 then perform app.fail('nothing_changed', '没有需要修改的内容'); end if;
  if not exists (select 1 from public.order_items where order_id = p_order and not removed) then
    perform app.fail('keep_one_item', '订单至少要保留一项货品');
  end if;

  update public.orders
     set updated_at = now(),
         modified_by = case when me.role in ('company', 'driver') then me.role else modified_by end
   where id = p_order;

  -- 通知：只发给公司和这张订单的销售
  perform app.emit(p_order, 'modified', p_via, app.tri(
    format('订单 #%s 被%s %s修改：%s%s', p_order, rl->>'zh', me.name, array_to_string(lz, '；'),
           coalesce('（原因：' || v_reason || '）', '')),
    format('Order #%s changed by %s (%s): %s%s', p_order, me.name, rl->>'en', array_to_string(le, '; '),
           coalesce(' (reason: ' || v_reason || ')', '')),
    format('Pedido #%s modificado por %s (%s): %s%s', p_order, me.name, rl->>'es', array_to_string(ls, '; '),
           coalesce(' (motivo: ' || v_reason || ')', ''))),
    array['company', 'sales']);
  return n;
end $$;

create or replace function public.assign_driver(p_order bigint, p_driver uuid, p_via text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := app.require_me();
  o  public.orders := app.lock_order(p_order);
  d  public.profiles;
begin
  if me.role <> 'company' then perform app.fail('company_only_assign', '只有公司可以派单', '{}', '42501'); end if;
  if o.status not in ('pending', 'assigned') then perform app.fail('already_delivering', '订单已经开始送货，不能再派单'); end if;
  select * into d from public.profiles where id = p_driver and role = 'driver' and active;
  if d.id is null then perform app.fail('driver_not_found', '找不到这位司机'); end if;
  if o.driver_id = d.id then return; end if;

  if o.driver_id is not null then
    perform app.emit(p_order, 'unassigned', p_via, app.tri(
      format('订单 #%s 已改派给其他司机，不用再送', p_order),
      format('Order #%s was reassigned to another driver. You no longer need to deliver it.', p_order),
      format('El pedido #%s se reasignó a otro conductor. Ya no tienes que entregarlo.', p_order)),
      array['driver']);
  end if;
  update public.orders set driver_id = d.id, status = 'assigned', updated_at = now() where id = p_order;
  perform app.emit(p_order, 'assigned', p_via, app.tri(
    format('订单 #%s（%s）已派给司机 %s', p_order, o.customer, d.name),
    format('Order #%s (%s) assigned to driver %s', p_order, o.customer, d.name),
    format('Pedido #%s (%s) asignado al conductor %s', p_order, o.customer, d.name)),
    array['sales', 'driver']);
end $$;

create or replace function public.start_delivery(p_order bigint, p_via text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := app.require_me();
  o  public.orders := app.lock_order(p_order);
begin
  if me.role <> 'driver' or o.driver_id is distinct from me.id then
    perform app.fail('driver_only_start', '只有被派单的司机可以开始送货', '{}', '42501');
  end if;
  if o.status <> 'assigned' then perform app.fail('bad_state_start', '订单当前状态不能开始送货'); end if;
  update public.orders set status = 'delivering', updated_at = now() where id = p_order;
  perform app.emit(p_order, 'delivering', p_via, app.tri(
    format('订单 #%s（%s）司机 %s 已出发送货', p_order, o.customer, me.name),
    format('Order #%s (%s): driver %s is on the way', p_order, o.customer, me.name),
    format('Pedido #%s (%s): el conductor %s va en camino', p_order, o.customer, me.name)),
    array['sales']);
end $$;

create or replace function public.confirm_delivered(p_order bigint, p_via text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := app.require_me();
  o  public.orders := app.lock_order(p_order);
begin
  if me.role <> 'driver' or o.driver_id is distinct from me.id then
    perform app.fail('driver_only_deliver', '只有被派单的司机可以确认送达', '{}', '42501');
  end if;
  if o.status not in ('assigned', 'delivering') then perform app.fail('bad_state_deliver', '订单当前状态不能确认送达'); end if;
  if not exists (select 1 from public.order_photos where order_id = p_order and kind = 'signoff') then
    perform app.fail('need_signoff_photo', '请先上传签收照片');
  end if;
  update public.orders set status = 'delivered', delivered_at = now(), updated_at = now() where id = p_order;
  perform app.emit(p_order, 'delivered', p_via, app.tri(
    format('订单 #%s（%s）已送达，司机 %s 已上传签收照片', p_order, o.customer, me.name),
    format('Order #%s (%s) delivered. Driver %s uploaded the proof-of-delivery photo.', p_order, o.customer, me.name),
    format('Pedido #%s (%s) entregado. El conductor %s subió la foto de entrega.', p_order, o.customer, me.name)),
    array['company', 'sales']);
end $$;

create or replace function public.report_issue(p_order bigint, p_note text, p_via text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := app.require_me();
  o  public.orders := app.lock_order(p_order);
  v  text := nullif(trim(coalesce(p_note, '')), '');
begin
  if me.role <> 'driver' or o.driver_id is distinct from me.id then
    perform app.fail('driver_only_issue', '只有被派单的司机可以报告送货问题', '{}', '42501');
  end if;
  if v is null then perform app.fail('issue_note_required', '请写明是什么问题'); end if;
  update public.orders set has_issue = true, issue_note = v, updated_at = now() where id = p_order;
  perform app.emit(p_order, 'issue', p_via, app.tri(
    format('订单 #%s（%s）送货有问题：%s', p_order, o.customer, v),
    format('Delivery problem on order #%s (%s): %s', p_order, o.customer, v),
    format('Problema de entrega en el pedido #%s (%s): %s', p_order, o.customer, v)),
    array['company', 'sales']);
end $$;

create or replace function public.resolve_issue(p_order bigint, p_note text default null, p_via text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := app.require_me();
  o  public.orders := app.lock_order(p_order);
  v  text := nullif(trim(coalesce(p_note, '')), '');
begin
  if me.role <> 'company' then perform app.fail('company_only_resolve', '只有公司可以处理送货问题', '{}', '42501'); end if;
  if not o.has_issue then return; end if;
  update public.orders set has_issue = false, updated_at = now() where id = p_order;
  perform app.emit(p_order, 'issue_resolved', p_via, app.tri(
    format('订单 #%s 的送货问题已处理%s', p_order, coalesce('：' || v, '')),
    format('Delivery problem on order #%s resolved%s', p_order, coalesce(': ' || v, '')),
    format('Problema de entrega del pedido #%s resuelto%s', p_order, coalesce(': ' || v, ''))),
    array['sales', 'driver']);
end $$;

create or replace function public.add_photo(p_order bigint, p_kind public.photo_kind, p_path text, p_via text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := app.require_me();
  v_id bigint;
begin
  perform app.lock_order(p_order);
  if not app.can_upload_photo(p_order, p_kind) then
    perform app.fail('photo_not_allowed', format('无权为订单 #%s 上传这类照片', p_order), jsonb_build_object('id', p_order), '42501');
  end if;
  if p_path not like p_order || '/' || p_kind || '/%' or p_path like '%..%' then
    perform app.fail('photo_path', format('照片路径必须是 %s/%s/文件名', p_order, p_kind));
  end if;
  insert into public.order_photos (order_id, kind, path, uploaded_by, via)
  values (p_order, p_kind, p_path, me.id, app.via(p_via)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.bootstrap_admin(p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then perform app.fail('not_logged_in', '请先登录', '{}', '42501'); end if;
  perform pg_advisory_xact_lock(905001);
  if exists (select 1 from public.profiles where is_admin and active) then
    perform app.fail('admin_exists', '系统已经有管理员了，请找管理员开通账号', '{}', '42501');
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then perform app.fail('name_required', '请填写姓名'); end if;
  insert into public.profiles (id, name, role, is_admin, login)
  values (auth.uid(), trim(p_name), 'company', true, (select email from auth.users where id = auth.uid()))
  on conflict (id) do update set role = 'company', is_admin = true, active = true, name = excluded.name;
end $$;

-- 设置自己的语言
create function public.set_my_lang(p_lang text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require_me();
  if p_lang not in ('zh', 'en', 'es') then perform app.fail('bad_lang', '语言只能是 zh、en 或 es'); end if;
  update public.profiles set lang = p_lang where id = auth.uid();
end $$;

-- ---------------------------------------------------------------- 读取
drop function if exists public.my_notifications(boolean, int);
create function public.my_notifications(p_unread_only boolean default true, p_limit int default 50, p_lang text default null)
returns table (event_id bigint, order_id bigint, type text, summary text, summary_i18n jsonb, via text,
               actor_name text, created_at timestamptz, read_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, e.order_id, e.type,
         coalesce(e.summary_i18n ->> coalesce(p_lang, (select lang from public.profiles where id = auth.uid()), 'zh'), e.summary),
         e.summary_i18n, e.via, p.name, e.created_at, r.read_at
  from public.event_recipients r
  join public.events e on e.id = r.event_id
  left join public.profiles p on p.id = e.actor_id
  where r.user_id = auth.uid() and app.my_role() is not null
    and (not p_unread_only or r.read_at is null)
  order by e.created_at desc
  limit least(greatest(p_limit, 1), 200)
$$;

drop function if exists public.order_detail(bigint);
create function public.order_detail(p_order bigint, p_lang text default null) returns jsonb
language sql stable security invoker set search_path = public as $$
  with l as (select coalesce(p_lang, (select lang from public.profiles where id = auth.uid()), 'zh') as lang)
  select jsonb_build_object(
    'id', o.id, 'status', o.status, 'customer', o.customer, 'address', o.address,
    'contact', o.contact, 'due_date', o.due_date, 'note', o.note,
    'has_issue', o.has_issue, 'issue_note', o.issue_note, 'modified_by', o.modified_by,
    'created_at', o.created_at, 'updated_at', o.updated_at, 'delivered_at', o.delivered_at,
    'sales', (select jsonb_build_object('id', id, 'name', name) from public.profiles where id = o.sales_id),
    'driver', (select jsonb_build_object('id', id, 'name', name) from public.profiles where id = o.driver_id),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'category', i.category, 'category_label', app.category_i18n(i.category) ->> l.lang,
        'spec', i.spec, 'qty', i.qty, 'unit', i.unit, 'original_qty', i.original_qty, 'removed', i.removed)
        order by i.position) from public.order_items i where i.order_id = o.id), '[]'),
    'changes', coalesce((select jsonb_agg(jsonb_build_object(
        'at', c.created_at, 'by', p.name, 'role', c.actor_role, 'via', c.via,
        'field', case when c.item_id is not null
                      then trim((app.category_i18n(i.category) ->> l.lang) || ' ' || i.spec)
                      else coalesce(app.field_i18n(c.field_key) ->> l.lang, c.field) end,
        'field_key', coalesce(c.field_key, case when c.item_id is not null then 'qty' end), 'item_id', c.item_id,
        'old', c.old_value, 'new', c.new_value, 'reason', c.reason) order by c.id)
        from public.order_changes c join public.profiles p on p.id = c.actor_id
        left join public.order_items i on i.id = c.item_id where c.order_id = o.id), '[]'),
    'photos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', ph.id, 'kind', ph.kind, 'path', ph.path, 'at', ph.created_at) order by ph.id)
        from public.order_photos ph where ph.order_id = o.id), '[]'),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object(
        'at', e.created_at, 'type', e.type, 'via', e.via, 'by', p.name,
        'summary', coalesce(e.summary_i18n ->> l.lang, e.summary), 'summary_i18n', e.summary_i18n) order by e.id)
        from public.events e left join public.profiles p on p.id = e.actor_id where e.order_id = o.id), '[]')
  )
  from public.orders o, l where o.id = p_order
$$;

-- ---------------------------------------------------------------- 权限
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function app.category_i18n(public.item_category), app.field_i18n(text), app.role_i18n(public.user_role)
  to authenticated;
revoke execute on function app.fail(text, text, jsonb, text), app.tri(text, text, text) from public, anon;
grant execute on function app.qu(numeric, text) to authenticated;
