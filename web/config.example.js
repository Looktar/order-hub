// 部署时由 GitHub Actions 根据仓库变量自动生成 config.js，这个文件只是格式示例。
// anon key 是 Supabase 设计为可以公开的"前端钥匙"，数据由数据库行级权限保护。
window.ORDER_HUB_CONFIG = {
  supabaseUrl: "https://你的项目.supabase.co",
  supabaseAnonKey: "你的 anon / publishable key",
  loginDomain: "users.order-hub.app",
};
