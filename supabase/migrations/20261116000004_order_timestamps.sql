-- 订单时间戳：下单（created_at，已有）、派单（assigned_at）、出发（started_at）、送达（delivered_at，已有）
-- 由触发器在状态变化时自动记录，所有写操作函数不用改。

alter table public.orders add column assigned_at timestamptz;
alter table public.orders add column started_at timestamptz;

-- 已有订单从事件记录里补上
update public.orders o set
  assigned_at = (select max(e.created_at) from public.events e where e.order_id = o.id and e.type = 'assigned'),
  started_at  = (select max(e.created_at) from public.events e where e.order_id = o.id and e.type = 'delivering');

create or replace function app.stamp_order() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'assigned' then new.assigned_at := now(); end if;
    if new.status = 'delivering' then new.started_at := now(); end if;
    if new.status = 'delivered' and new.delivered_at is null then new.delivered_at := now(); end if;
  end if;
  -- 改派司机（状态不变）也更新派单时间
  if new.status = 'assigned' and new.driver_id is distinct from old.driver_id then new.assigned_at := now(); end if;
  -- 下单时间、送达时间不能被改
  new.created_at := old.created_at;
  if old.delivered_at is not null then new.delivered_at := old.delivered_at; end if;
  return new;
end $$;

create trigger orders_stamp before update on public.orders
  for each row execute function app.stamp_order();

create or replace function public.order_detail(p_order bigint, p_lang text default null) returns jsonb
language sql stable security invoker set search_path = public as $$
  with l as (select coalesce(p_lang, (select lang from public.profiles where id = auth.uid()), 'zh') as lang)
  select jsonb_build_object(
    'id', o.id, 'status', o.status, 'customer', o.customer, 'address', o.address,
    'contact', o.contact, 'due_date', o.due_date, 'note', o.note,
    'has_issue', o.has_issue, 'issue_note', o.issue_note, 'modified_by', o.modified_by,
    'created_at', o.created_at, 'updated_at', o.updated_at, 'assigned_at', o.assigned_at,
    'started_at', o.started_at, 'delivered_at', o.delivered_at,
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


revoke execute on function public.order_detail(bigint, text) from public, anon;
grant execute on function public.order_detail(bigint, text) to authenticated;
