-- 第一个管理员：系统里还没有管理员时，已登录的用户可以把自己设为第一个管理员（公司角色）。
-- 之后再调用一律被拒绝。账号本身在 Supabase 控制台 Authentication → Users 里手动建。
create function public.needs_bootstrap() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and not exists (select 1 from public.profiles where is_admin and active)
$$;

create function public.bootstrap_admin(p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '请先登录' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(905001);
  if exists (select 1 from public.profiles where is_admin and active) then
    raise exception '系统已经有管理员了，请找管理员开通账号' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception '请填写姓名'; end if;
  insert into public.profiles (id, name, role, is_admin, login)
  values (auth.uid(), trim(p_name), 'company', true, (select email from auth.users where id = auth.uid()))
  on conflict (id) do update set role = 'company', is_admin = true, active = true, name = excluded.name;
end $$;

revoke execute on function public.needs_bootstrap(), public.bootstrap_admin(text) from public, anon;
grant execute on function public.needs_bootstrap(), public.bootstrap_admin(text) to authenticated;
