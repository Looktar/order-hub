-- 销售在公司处理前改数量，属于更正自己的订单：把"原数量"也一起改掉。
-- 这样之后公司或司机再改时，划线显示的是销售最终提交的数量，而不是更正前的数量。
create or replace function app.sales_original_qty() returns trigger
language plpgsql as $$
begin
  if app.my_role() = 'sales' and not new.removed then
    new.original_qty := new.qty;
  end if;
  return new;
end $$;

create trigger order_items_sales_original before insert or update of qty on public.order_items
  for each row execute function app.sales_original_qty();
