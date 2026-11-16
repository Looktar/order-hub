-- 新状态：已取消（单独一个文件，新的状态值要先提交才能在别处使用）
alter type public.order_status add value if not exists 'cancelled';
