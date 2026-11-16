-- 订单协作系统：数据库结构、权限和写操作
-- 原则：前端和 Agent 对表只有读权限（并受行级权限限制），所有写操作都走下面的函数。

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- 类型
create type public.user_role     as enum ('sales', 'company', 'driver');
create type public.order_status  as enum ('pending', 'assigned', 'delivering', 'delivered');
create type public.item_category as enum ('oil', 'oil_filter', 'tire', 'rim');
create type public.photo_kind    as enum ('order', 'signoff');

-- ---------------------------------------------------------------- 表
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  role       public.user_role not null,
  is_admin   boolean not null default false,
  active     boolean not null default true,
  login      text,
  created_at timestamptz not null default now()
);

create table public.orders (
  id           bigint generated always as identity primary key,
  sales_id     uuid not null references public.profiles (id),
  customer     text not null check (length(trim(customer)) > 0),
  address      text not null default '',
  contact      text not null default '',
  due_date     date,
  note         text not null default '',
  status       public.order_status not null default 'pending',
  driver_id    uuid references public.profiles (id),
  has_issue    boolean not null default false,
  issue_note   text not null default '',
  modified_by  public.user_role,          -- 最近一次由公司或司机修改；null 表示未被修改
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  delivered_at timestamptz
);
create index on public.orders (sales_id);
create index on public.orders (driver_id);
create index on public.orders (status);

create table public.order_items (
  id           bigint generated always as identity primary key,
  order_id     bigint not null references public.orders (id) on delete cascade,
  category     public.item_category not null,
  spec         text not null default '',
  qty          numeric(12, 2) not null check (qty >= 0),
  unit         text not null default '',
  original_qty numeric(12, 2) not null,
  removed      boolean not null default false,
  position     int not null default 0
);
create index on public.order_items (order_id);

create table public.order_changes (
  id         bigint generated always as identity primary key,
  order_id   bigint not null references public.orders (id) on delete cascade,
  actor_id   uuid not null references public.profiles (id),
  actor_role public.user_role not null,
  via        text not null default '本人',
  item_id    bigint references public.order_items (id),
  field      text not null,
  old_value  text,
  new_value  text,
  reason     text not null,
  created_at timestamptz not null default now()
);
create index on public.order_changes (order_id);

create table public.order_photos (
  id          bigint generated always as identity primary key,
  order_id    bigint not null references public.orders (id) on delete cascade,
  kind        public.photo_kind not null,
  path        text not null unique,
  uploaded_by uuid not null references public.profiles (id),
  via         text not null default '本人',
  created_at  timestamptz not null default now()
);
create index on public.order_photos (order_id);

create table public.events (
  id         bigint generated always as identity primary key,
  order_id   bigint not null references public.orders (id) on delete cascade,
  type       text not null,
  actor_id   uuid references public.profiles (id),
  via        text not null default '本人',
  summary    text not null,
  created_at timestamptz not null default now()
);
create index on public.events (order_id);

create table public.event_recipients (
  event_id bigint not null references public.events (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  read_at  timestamptz,
  primary key (event_id, user_id)
);
create index on public.event_recipients (user_id) where read_at is null;

-- 只有接口（service_role）能访问
create table public.agent_tokens (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  token_hash   text not null unique,
  label        text not null default 'Agent',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

-- ---------------------------------------------------------------- 权限基础
alter table public.profiles         enable row level security;
alter table public.orders           enable row level security;
alter table public.order_items      enable row level security;
alter table public.order_changes    enable row level security;
alter table public.order_photos     enable row level security;
alter table public.events           enable row level security;
alter table public.event_recipients enable row level security;
alter table public.agent_tokens     enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on public.profiles, public.orders, public.order_items, public.order_changes,
                public.order_photos, public.events, public.event_recipients to authenticated;

-- ---------------------------------------------------------------- 内部工具函数
create schema if not exists app;
revoke all on schema app from public, anon;
grant usage on schema app to authenticated;

create function app.me() returns public.profiles
language sql stable security definer set search_path = public as $$
  select p.* from public.profiles p where p.id = auth.uid() and p.active
$$;

create function app.my_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create function app.can_see_order(p_order bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.orders o
    join public.profiles me on me.id = auth.uid() and me.active
    where o.id = p_order
      and (me.role = 'company'
           or (me.role = 'sales'  and o.sales_id  = me.id)
           or (me.role = 'driver' and o.driver_id = me.id))
  )
$$;

create function app.via(p_via text) returns text
language sql immutable as $$
  select coalesce(nullif(left(trim(p_via), 40), ''), '本人')
$$;

create function app.category_label(c public.item_category) returns text
language sql immutable as $$
  select case c when 'oil' then '机油' when 'oil_filter' then '机油滤芯'
                when 'tire' then '轮胎' when 'rim' then '轮毂' end
$$;

create function app.role_label(r public.user_role) returns text
language sql immutable as $$
  select case r when 'sales' then '销售' when 'company' then '公司' when 'driver' then '司机' end
$$;

create function app.fmt_qty(q numeric) returns text
language sql immutable as $$
  select case when q = trunc(q) then trunc(q)::text
              else trim(trailing '0' from q::text) end
$$;

-- 记录事件并写定接收人。recipients 里的 'company' 表示全体启用中的公司账号。
-- 操作人本人不会收到自己触发的通知。
create function app.emit(p_order bigint, p_type text, p_via text, p_summary text, p_to text[])
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_event bigint;
  v_o     public.orders;
begin
  select * into v_o from public.orders where id = p_order;
  insert into public.events (order_id, type, actor_id, via, summary)
  values (p_order, p_type, auth.uid(), app.via(p_via), p_summary)
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

create function app.require_me() returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare v public.profiles;
begin
  v := app.me();
  if v.id is null then raise exception '未登录或账号已停用' using errcode = '42501'; end if;
  return v;
end $$;

create function app.lock_order(p_order bigint) returns public.orders
language plpgsql security definer set search_path = public as $$
declare v public.orders;
begin
  select * into v from public.orders where id = p_order for update;
  if v.id is null or not app.can_see_order(p_order) then
    raise exception '订单 #% 不存在或无权访问', p_order using errcode = '42501';
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------- 行级权限：读
create policy profiles_read on public.profiles for select to authenticated
  using (app.my_role() is not null);
create policy orders_read on public.orders for select to authenticated
  using (app.can_see_order(id));
create policy items_read on public.order_items for select to authenticated
  using (app.can_see_order(order_id));
create policy changes_read on public.order_changes for select to authenticated
  using (app.can_see_order(order_id));
create policy photos_read on public.order_photos for select to authenticated
  using (app.can_see_order(order_id));
create policy events_read on public.events for select to authenticated
  using (app.can_see_order(order_id));
create policy recipients_read on public.event_recipients for select to authenticated
  using (user_id = auth.uid());
-- agent_tokens：没有任何策略 = 前端和 Agent 都读不到

-- ---------------------------------------------------------------- 写操作
-- 提交订单（销售）
-- p: {"customer","address","contact","due_date","note","items":[{"category","spec","qty","unit"}]}
create function public.submit_order(p jsonb, p_via text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := app.require_me();
  v_id bigint;
  it jsonb;
  i int := 0;
begin
  if me.role <> 'sales' then raise exception '只有销售可以提交订单' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then raise exception '订单至少要有一项货品'; end if;

  insert into public.orders (sales_id, customer, address, contact, due_date, note)
  values (me.id, p->>'customer', coalesce(p->>'address', ''), coalesce(p->>'contact', ''),
          nullif(p->>'due_date', '')::date, coalesce(p->>'note', ''))
  returning id into v_id;

  for it in select * from jsonb_array_elements(p->'items') loop
    i := i + 1;
    insert into public.order_items (order_id, category, spec, qty, unit, original_qty, position)
    values (v_id, (it->>'category')::public.item_category, coalesce(it->>'spec', ''),
            (it->>'qty')::numeric, coalesce(it->>'unit', ''), (it->>'qty')::numeric, i);
  end loop;

  perform app.emit(v_id, 'submitted', p_via,
    format('新订单 #%s：%s（销售 %s 提交）', v_id, p->>'customer', me.name), array['company']);
  return v_id;
end $$;

-- 修改订单内容
-- 销售：自己的订单，且公司还没处理（待公司处理）
-- 公司：送达前任何时候
-- 司机：派给自己的订单，已派单或送货中；只能改货品
-- p_changes: {"fields":{"customer","address","contact","due_date","note"},
--             "items":[{"id":1,"qty":10} | {"id":2,"remove":true} | {"add":{"category","spec","qty","unit"}}]}
create function public.modify_order(p_order bigint, p_changes jsonb, p_reason text, p_via text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := app.require_me();
  o  public.orders := app.lock_order(p_order);
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  f text; v_old text; v_new text;
  ch jsonb; it public.order_items;
  n int := 0;
  lines text[] := '{}';
  v_label text;
  v_pos int;
  v_new_id bigint;
begin
  -- 谁能改
  if me.role = 'sales' then
    if o.sales_id <> me.id or o.status <> 'pending' then
      raise exception '公司开始处理后，销售不能再改订单' using errcode = '42501';
    end if;
    v_reason := coalesce(v_reason, '销售更正');
  elsif me.role = 'company' then
    if o.status = 'delivered' then raise exception '已送达的订单不能修改'; end if;
  elsif me.role = 'driver' then
    if o.driver_id is distinct from me.id or o.status not in ('assigned', 'delivering') then
      raise exception '司机只能修改派给自己、尚未送达的订单' using errcode = '42501';
    end if;
    if p_changes ? 'fields' and p_changes->'fields' <> '{}'::jsonb then
      raise exception '司机只能修改货品，不能改客户和送货信息' using errcode = '42501';
    end if;
  end if;
  if me.role in ('company', 'driver') and v_reason is null then
    raise exception '修改订单必须填写原因';
  end if;

  -- 订单字段
  for f, v_new in select key, value #>> '{}' from jsonb_each(coalesce(p_changes->'fields', '{}')) loop
    if f not in ('customer', 'address', 'contact', 'due_date', 'note') then
      raise exception '不能修改字段 %', f;
    end if;
    execute format('select (%I)::text from public.orders where id = $1', f) into v_old using p_order;
    if v_old is distinct from v_new then
      execute format('update public.orders set %I = $1::%s where id = $2', f,
                     case f when 'due_date' then 'date' else 'text' end)
        using nullif(v_new, ''), p_order;
      v_label := case f when 'customer' then '客户' when 'address' then '送货地址'
                        when 'contact' then '收货人' when 'due_date' then '要求送达' else '备注' end;
      insert into public.order_changes (order_id, actor_id, actor_role, via, field, old_value, new_value, reason)
      values (p_order, me.id, me.role, app.via(p_via), v_label, v_old, v_new, v_reason);
      lines := lines || format('%s：%s → %s', v_label, coalesce(v_old, '空'), coalesce(v_new, '空'));
      n := n + 1;
    end if;
  end loop;

  -- 货品
  for ch in select * from jsonb_array_elements(coalesce(p_changes->'items', '[]')) loop
    if ch ? 'add' then
      select coalesce(max(position), 0) + 1 into v_pos from public.order_items where order_id = p_order;
      insert into public.order_items (order_id, category, spec, qty, unit, original_qty, position)
      values (p_order, (ch->'add'->>'category')::public.item_category, coalesce(ch->'add'->>'spec', ''),
              (ch->'add'->>'qty')::numeric, coalesce(ch->'add'->>'unit', ''), 0, v_pos)
      returning id into v_new_id;
      v_label := trim(app.category_label((ch->'add'->>'category')::public.item_category) || ' ' || coalesce(ch->'add'->>'spec', ''));
      insert into public.order_changes (order_id, actor_id, actor_role, via, item_id, field, old_value, new_value, reason)
      values (p_order, me.id, me.role, app.via(p_via), v_new_id, v_label || ' 数量', '0',
              app.fmt_qty((ch->'add'->>'qty')::numeric) || coalesce(ch->'add'->>'unit', ''), v_reason);
      lines := lines || format('新增 %s × %s%s', v_label, app.fmt_qty((ch->'add'->>'qty')::numeric), coalesce(ch->'add'->>'unit', ''));
      n := n + 1;
      continue;
    end if;

    select * into it from public.order_items where id = (ch->>'id')::bigint and order_id = p_order and not removed;
    if it.id is null then raise exception '订单 #% 没有货品 %', p_order, ch->>'id'; end if;
    v_label := trim(app.category_label(it.category) || ' ' || it.spec);

    if coalesce((ch->>'remove')::boolean, false) then
      update public.order_items set removed = true, qty = 0 where id = it.id;
      insert into public.order_changes (order_id, actor_id, actor_role, via, item_id, field, old_value, new_value, reason)
      values (p_order, me.id, me.role, app.via(p_via), it.id, v_label || ' 数量', app.fmt_qty(it.qty) || it.unit, '删除', v_reason);
      lines := lines || format('删除 %s', v_label);
      n := n + 1;
    elsif ch ? 'qty' and (ch->>'qty')::numeric is distinct from it.qty then
      if (ch->>'qty')::numeric < 0 then raise exception '数量不能小于 0'; end if;
      update public.order_items set qty = (ch->>'qty')::numeric where id = it.id;
      insert into public.order_changes (order_id, actor_id, actor_role, via, item_id, field, old_value, new_value, reason)
      values (p_order, me.id, me.role, app.via(p_via), it.id, v_label || ' 数量',
              app.fmt_qty(it.qty) || it.unit, app.fmt_qty((ch->>'qty')::numeric) || it.unit, v_reason);
      lines := lines || format('%s：%s → %s%s', v_label, app.fmt_qty(it.qty), app.fmt_qty((ch->>'qty')::numeric), it.unit);
      n := n + 1;
    end if;
  end loop;

  if n = 0 then raise exception '没有需要修改的内容'; end if;
  if not exists (select 1 from public.order_items where order_id = p_order and not removed) then
    raise exception '订单至少要保留一项货品';
  end if;

  update public.orders
     set updated_at = now(),
         modified_by = case when me.role in ('company', 'driver') then me.role else modified_by end
   where id = p_order;

  -- 通知：只发给公司和这张订单的销售
  perform app.emit(p_order, 'modified', p_via,
    format('订单 #%s 被%s %s修改：%s（原因：%s）', p_order, app.role_label(me.role), me.name,
           array_to_string(lines, '；'), v_reason),
    array['company', 'sales']);
  return n;
end $$;

-- 派给司机（公司）。改派时原司机会收到"已改派"通知。
create function public.assign_driver(p_order bigint, p_driver uuid, p_via text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := app.require_me();
  o  public.orders := app.lock_order(p_order);
  d  public.profiles;
begin
  if me.role <> 'company' then raise exception '只有公司可以派单' using errcode = '42501'; end if;
  if o.status not in ('pending', 'assigned') then raise exception '订单已经开始送货，不能再派单'; end if;
  select * into d from public.profiles where id = p_driver and role = 'driver' and active;
  if d.id is null then raise exception '找不到这位司机'; end if;
  if o.driver_id = d.id then return; end if;

  if o.driver_id is not null then
    perform app.emit(p_order, 'unassigned', p_via,
      format('订单 #%s 已改派给其他司机，不用再送', p_order), array['driver']);
  end if;
  update public.orders set driver_id = d.id, status = 'assigned', updated_at = now() where id = p_order;
  perform app.emit(p_order, 'assigned', p_via,
    format('订单 #%s（%s）已派给司机 %s', p_order, o.customer, d.name), array['sales', 'driver']);
end $$;

-- 司机：开始送货
create function public.start_delivery(p_order bigint, p_via text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := app.require_me();
  o  public.orders := app.lock_order(p_order);
begin
  if me.role <> 'driver' or o.driver_id is distinct from me.id then
    raise exception '只有被派单的司机可以开始送货' using errcode = '42501';
  end if;
  if o.status <> 'assigned' then raise exception '订单当前状态不能开始送货'; end if;
  update public.orders set status = 'delivering', updated_at = now() where id = p_order;
  perform app.emit(p_order, 'delivering', p_via,
    format('订单 #%s（%s）司机 %s 已出发送货', p_order, o.customer, me.name), array['sales']);
end $$;

-- 司机：确认送达（必须先上传签收照片）
create function public.confirm_delivered(p_order bigint, p_via text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := app.require_me();
  o  public.orders := app.lock_order(p_order);
begin
  if me.role <> 'driver' or o.driver_id is distinct from me.id then
    raise exception '只有被派单的司机可以确认送达' using errcode = '42501';
  end if;
  if o.status not in ('assigned', 'delivering') then raise exception '订单当前状态不能确认送达'; end if;
  if not exists (select 1 from public.order_photos where order_id = p_order and kind = 'signoff') then
    raise exception '请先上传签收照片';
  end if;
  update public.orders set status = 'delivered', delivered_at = now(), updated_at = now() where id = p_order;
  perform app.emit(p_order, 'delivered', p_via,
    format('订单 #%s（%s）已送达，司机 %s 已上传签收照片', p_order, o.customer, me.name),
    array['company', 'sales']);
end $$;

-- 司机：报告送货问题；公司：标记已解决
create function public.report_issue(p_order bigint, p_note text, p_via text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := app.require_me();
  o  public.orders := app.lock_order(p_order);
begin
  if me.role <> 'driver' or o.driver_id is distinct from me.id then
    raise exception '只有被派单的司机可以报告送货问题' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_note, '')), '') is null then raise exception '请写明是什么问题'; end if;
  update public.orders set has_issue = true, issue_note = trim(p_note), updated_at = now() where id = p_order;
  perform app.emit(p_order, 'issue', p_via,
    format('订单 #%s（%s）送货有问题：%s', p_order, o.customer, trim(p_note)), array['company', 'sales']);
end $$;

create function public.resolve_issue(p_order bigint, p_note text default null, p_via text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := app.require_me();
  o  public.orders := app.lock_order(p_order);
begin
  if me.role <> 'company' then raise exception '只有公司可以处理送货问题' using errcode = '42501'; end if;
  if not o.has_issue then return; end if;
  update public.orders set has_issue = false, updated_at = now() where id = p_order;
  perform app.emit(p_order, 'issue_resolved', p_via,
    format('订单 #%s 的送货问题已处理%s', p_order, coalesce('：' || nullif(trim(p_note), ''), '')),
    array['sales', 'driver']);
end $$;

-- 照片：先上传到存储桶 photos，路径 {订单号}/{order|signoff}/{文件名}，再调用本函数登记
create function app.can_upload_photo(p_order bigint, p_kind public.photo_kind) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.orders o join public.profiles me on me.id = auth.uid() and me.active
    where o.id = p_order and case
      when p_kind = 'order'   then (me.role = 'sales' and o.sales_id = me.id and o.status = 'pending')
                                 or (me.role = 'company' and o.status <> 'delivered')
      when p_kind = 'signoff' then me.role = 'driver' and o.driver_id = me.id
                                 and o.status in ('assigned', 'delivering')
    end
  )
$$;

create function public.add_photo(p_order bigint, p_kind public.photo_kind, p_path text, p_via text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := app.require_me();
  v_id bigint;
begin
  perform app.lock_order(p_order);
  if not app.can_upload_photo(p_order, p_kind) then
    raise exception '无权为订单 #% 上传这类照片', p_order using errcode = '42501';
  end if;
  if p_path not like p_order || '/' || p_kind || '/%' or p_path like '%..%' then
    raise exception '照片路径必须是 %/%/文件名', p_order, p_kind;
  end if;
  insert into public.order_photos (order_id, kind, path, uploaded_by, via)
  values (p_order, p_kind, p_path, me.id, app.via(p_via)) returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- 读取（给网页和 Agent 用）
-- 我的通知
create function public.my_notifications(p_unread_only boolean default true, p_limit int default 50)
returns table (event_id bigint, order_id bigint, type text, summary text, via text,
               actor_name text, created_at timestamptz, read_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, e.order_id, e.type, e.summary, e.via, p.name, e.created_at, r.read_at
  from public.event_recipients r
  join public.events e on e.id = r.event_id
  left join public.profiles p on p.id = e.actor_id
  where r.user_id = auth.uid() and app.my_role() is not null
    and (not p_unread_only or r.read_at is null)
  order by e.created_at desc
  limit least(greatest(p_limit, 1), 200)
$$;

create function public.mark_read(p_event_ids bigint[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform app.require_me();
  update public.event_recipients set read_at = now()
   where user_id = auth.uid() and read_at is null
     and (p_event_ids is null or event_id = any(p_event_ids));
  get diagnostics n = row_count;
  return n;
end $$;

-- 一张订单的全部内容（受读取权限限制）
create function public.order_detail(p_order bigint) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'id', o.id, 'status', o.status, 'customer', o.customer, 'address', o.address,
    'contact', o.contact, 'due_date', o.due_date, 'note', o.note,
    'has_issue', o.has_issue, 'issue_note', o.issue_note, 'modified_by', o.modified_by,
    'created_at', o.created_at, 'updated_at', o.updated_at, 'delivered_at', o.delivered_at,
    'sales', (select jsonb_build_object('id', id, 'name', name) from public.profiles where id = o.sales_id),
    'driver', (select jsonb_build_object('id', id, 'name', name) from public.profiles where id = o.driver_id),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'category', i.category, 'category_label', app.category_label(i.category),
        'spec', i.spec, 'qty', i.qty, 'unit', i.unit, 'original_qty', i.original_qty, 'removed', i.removed)
        order by i.position) from public.order_items i where i.order_id = o.id), '[]'),
    'changes', coalesce((select jsonb_agg(jsonb_build_object(
        'at', c.created_at, 'by', p.name, 'role', c.actor_role, 'via', c.via, 'field', c.field,
        'old', c.old_value, 'new', c.new_value, 'reason', c.reason) order by c.id)
        from public.order_changes c join public.profiles p on p.id = c.actor_id where c.order_id = o.id), '[]'),
    'photos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', ph.id, 'kind', ph.kind, 'path', ph.path, 'at', ph.created_at) order by ph.id)
        from public.order_photos ph where ph.order_id = o.id), '[]'),
    'timeline', coalesce((select jsonb_agg(jsonb_build_object(
        'at', e.created_at, 'type', e.type, 'summary', e.summary, 'via', e.via, 'by', p.name) order by e.id)
        from public.events e left join public.profiles p on p.id = e.actor_id where e.order_id = o.id), '[]')
  )
  from public.orders o where o.id = p_order
$$;

-- ---------------------------------------------------------------- 函数执行权限
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app    from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function app.me(), app.my_role(), app.can_see_order(bigint),
                         app.category_label(public.item_category), app.can_upload_photo(bigint, public.photo_kind)
  to authenticated;
-- app.emit / app.lock_order / app.require_me 只在上面的函数内部使用
revoke execute on function app.emit(bigint, text, text, text, text[]) from authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

-- ---------------------------------------------------------------- 照片存储（私有）
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
on conflict (id) do nothing;

create policy photos_select on storage.objects for select to authenticated
  using (bucket_id = 'photos'
         and split_part(name, '/', 1) ~ '^[0-9]+$'
         and app.can_see_order(split_part(name, '/', 1)::bigint));

create policy photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos'
              and split_part(name, '/', 1) ~ '^[0-9]+$'
              and split_part(name, '/', 2) in ('order', 'signoff')
              and app.can_upload_photo(split_part(name, '/', 1)::bigint,
                                       split_part(name, '/', 2)::public.photo_kind));
