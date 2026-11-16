-- 公司取消订单：必须写原因；通知该单销售和已派的司机；订单保留，标为已取消，之后不能再做任何改动。

alter table public.orders add column cancelled_at timestamptz;
alter table public.orders add column cancel_reason text not null default '';

-- 时间戳触发器加上"取消时间"
create or replace function app.stamp_order() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'assigned' then new.assigned_at := now(); end if;
    if new.status = 'delivering' then new.started_at := now(); end if;
    if new.status = 'delivered' and new.delivered_at is null then new.delivered_at := now(); end if;
    if new.status = 'cancelled' then new.cancelled_at := now(); end if;
  end if;
  if new.status = 'assigned' and new.driver_id is distinct from old.driver_id then new.assigned_at := now(); end if;
  new.created_at := old.created_at;
  if old.delivered_at is not null then new.delivered_at := old.delivered_at; end if;
  return new;
end $$;

-- 已取消的订单不能再改：订单本身、货品、照片都拦住
create or replace function app.block_cancelled_order() returns trigger
language plpgsql as $$
begin
  if old.status = 'cancelled' then
    perform app.fail('order_cancelled', format('订单 #%s 已取消，不能再操作', old.id), jsonb_build_object('id', old.id));
  end if;
  return new;
end $$;
create trigger orders_block_cancelled before update on public.orders
  for each row execute function app.block_cancelled_order();

create or replace function app.block_cancelled_child() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from public.orders where id = new.order_id and status = 'cancelled') then
    perform app.fail('order_cancelled', format('订单 #%s 已取消，不能再操作', new.order_id), jsonb_build_object('id', new.order_id));
  end if;
  return new;
end $$;
create trigger order_items_block_cancelled before insert or update on public.order_items
  for each row execute function app.block_cancelled_child();
create trigger order_photos_block_cancelled before insert on public.order_photos
  for each row execute function app.block_cancelled_child();

-- 所有写操作都先锁订单；已取消的订单在这里直接给出明确的提示
create or replace function app.lock_order(p_order bigint) returns public.orders
language plpgsql security definer set search_path = public as $$
declare v public.orders;
begin
  select * into v from public.orders where id = p_order for update;
  if v.id is null or not app.can_see_order(p_order) then
    perform app.fail('order_not_found', format('订单 #%s 不存在或无权访问', p_order), jsonb_build_object('id', p_order), '42501');
  end if;
  if v.status = 'cancelled' then
    perform app.fail('order_cancelled', format('订单 #%s 已取消，不能再操作', p_order), jsonb_build_object('id', p_order));
  end if;
  return v;
end $$;

create function public.cancel_order(p_order bigint, p_reason text, p_via text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles := app.require_me();
  o  public.orders := app.lock_order(p_order);
  v  text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if me.role <> 'company' then perform app.fail('company_only_cancel', '只有公司可以取消订单', '{}', '42501'); end if;
  if o.status = 'cancelled' then perform app.fail('order_cancelled', format('订单 #%s 已取消，不能再操作', p_order), jsonb_build_object('id', p_order)); end if;
  if o.status = 'delivered' then perform app.fail('cannot_cancel_delivered', '已送达的订单不能取消'); end if;
  if v is null then perform app.fail('cancel_reason_required', '取消订单必须填写原因'); end if;
  update public.orders set status = 'cancelled', cancel_reason = v, updated_at = now() where id = p_order;
  perform app.emit(p_order, 'cancelled', p_via, app.tri(
    format('订单 #%s（%s）已被公司 %s 取消（原因：%s）', p_order, o.customer, me.name, v),
    format('Order #%s (%s) was cancelled by %s (company). Reason: %s', p_order, o.customer, me.name, v),
    format('El pedido #%s (%s) fue cancelado por %s (empresa). Motivo: %s', p_order, o.customer, me.name, v)),
    array['sales', 'driver']);
end $$;
revoke execute on function public.cancel_order(bigint, text, text) from public, anon;
grant execute on function public.cancel_order(bigint, text, text) to authenticated;

create or replace function public.order_detail(p_order bigint, p_lang text default null) returns jsonb
language sql stable security invoker set search_path = public as $$
  with l as (select coalesce(p_lang, (select lang from public.profiles where id = auth.uid()), 'zh') as lang)
  select jsonb_build_object(
    'id', o.id, 'status', o.status, 'customer', o.customer, 'address', o.address,
    'contact', o.contact, 'due_date', o.due_date, 'note', o.note,
    'has_issue', o.has_issue, 'issue_note', o.issue_note, 'modified_by', o.modified_by,
    'created_at', o.created_at, 'updated_at', o.updated_at, 'assigned_at', o.assigned_at,
    'started_at', o.started_at, 'delivered_at', o.delivered_at,
    'cancelled_at', o.cancelled_at, 'cancel_reason', o.cancel_reason,
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
