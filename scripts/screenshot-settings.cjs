const puppeteer = require('puppeteer');
const fs = require('fs');

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; }
  .app { width: 1400px; height: 900px; display: flex; background: #FAFAFA; overflow: hidden; position: relative; }
  .sidebar { width: 252px; background: #F5F5F5; display: flex; flex-direction: column; border-right: 1px solid #EEEEEE; z-index: 2; }
  .sidebar-top { height: 42px; display: flex; align-items: center; justify-content: space-between; padding: 0 8px; border-bottom: 1px solid #EEEEEE; }
  .folder-item { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
  .folder-item:hover { background: #EBEBEB; }
  .task-item { display: flex; align-items: center; gap: 6px; padding: 5px 8px 5px 24px; border-radius: 6px; cursor: pointer; font-size: 12px; color: #525252; }
  .sep { width: 4px; background: #EEEEEE; }
  .settings-overlay { position: absolute; top: 0; left: 256px; right: 0; bottom: 0; background: #FAFAFA; display: flex; flex-direction: column; z-index: 100; }
  .settings-header { height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; border-bottom: 1px solid #EEEEEE; }
  .settings-body { flex: 1; display: flex; overflow: hidden; }
  .settings-nav { width: 192px; background: #F5F5F5; border-right: 1px solid #EEEEEE; padding: 16px 12px; }
  .nav-item { width: 100%; text-align: left; padding: 8px 10px; border-radius: 8px; font-size: 12px; margin-bottom: 2px; cursor: pointer; border: none; background: transparent; }
  .nav-item.active { background: #EBEBEB; color: #1A1A1A; font-weight: 500; }
  .nav-item:not(.active) { color: #525252; }
  .settings-content { flex: 1; overflow: auto; padding: 32px; }
  .card { padding: 16px; border-radius: 12px; background: #FFFFFF; border: 1px solid #EEEEEE; margin-bottom: 16px; }
  .provider-card { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 10px; background: #FFFFFF; border: 1px solid #EEEEEE; margin-bottom: 8px; cursor: pointer; }
  .provider-card:hover { border-color: #1A1A1A; background: #F5F5F5; }
  .btn-primary { padding: 6px 16px; border-radius: 8px; background: #1A1A1A; color: #fff; border: none; font-size: 12px; cursor: pointer; }
  .btn-ghost { padding: 6px 16px; border-radius: 8px; background: transparent; color: #525252; border: none; font-size: 12px; cursor: pointer; }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .dot.green { background: #059669; }
  .dot.gray { background: #E5E5E5; }
  .badge { font-size: 10px; padding: 2px 8px; border-radius: 4px; background: rgba(26,26,26,0.08); color: #1A1A1A; }
  select, input[type="text"] { width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid #E5E5E5; background: #FFFFFF; font-size: 12px; outline: none; }
  .footer { height: 52px; display: flex; align-items: center; justify-content: flex-end; padding: 0 24px; gap: 12px; border-top: 1px solid #EEEEEE; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
</style>
</head>
<body>
<div class="app">
  <!-- Sidebar (visible underneath) -->
  <div class="sidebar">
    <div class="sidebar-top">
      <div style="display:flex;align-items:center;gap:6px;">
        <div style="width:20px;height:20px;border-radius:6px;background:#1A1A1A;display:flex;align-items:center;justify-content:center;"><span style="font-size:10px;font-weight:bold;color:#fff;">N</span></div>
        <span style="font-size:12px;font-weight:600;color:#1A1A1A;">Note Agent</span>
      </div>
      <div style="display:flex;gap:2px;opacity:0.5;">
        <span style="padding:4px;">+</span>
        <span style="padding:4px;">📁</span>
        <span style="padding:4px;">◀</span>
      </div>
    </div>
    <div style="display:flex;padding:8px;gap:4px;">
      <div style="flex:1;text-align:center;padding:6px 0;font-size:11px;font-weight:500;border-radius:8px;background:#EBEBEB;color:#1A1A1A;">任务</div>
      <div style="flex:1;text-align:center;padding:6px 0;font-size:11px;font-weight:500;border-radius:8px;color:#737373;">文件</div>
    </div>
    <div style="padding:8px;">
      <div class="folder-item">
        <span style="font-size:12px;color:#737373;">▼</span>
        <span style="font-size:12px;color:#2563EB;">📥</span>
        <span style="font-size:12px;font-weight:500;color:#1A1A1A;flex:1;">默认</span>
        <span style="font-size:10px;color:#737373;background:#EBEBEB;padding:1px 5px;border-radius:4px;">3</span>
      </div>
      <div class="task-item"><span style="color:#2563EB">○</span> 实现用户认证模块</div>
      <div class="task-item"><span style="color:#737373">○</span> 设计数据库 Schema</div>
      <div class="task-item"><span style="color:#059669">✓</span> <span style="text-decoration:line-through;opacity:0.6">搭建项目骨架</span></div>
      <div class="folder-item" style="margin-top:4px;">
        <span style="font-size:12px;color:#737373;">▶</span>
        <span style="font-size:12px;color:#D97706;">📁</span>
        <span style="font-size:12px;font-weight:500;color:#1A1A1A;flex:1;">文档整理</span>
        <span style="font-size:10px;color:#737373;background:#EBEBEB;padding:1px 5px;border-radius:4px;">1</span>
      </div>
    </div>
  </div>
  <div class="sep"></div>

  <!-- Settings Overlay -->
  <div class="settings-overlay">
    <div class="settings-header">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="padding:4px;border-radius:6px;color:#525252;cursor:pointer;">←</span>
        <span style="font-size:13px;font-weight:600;color:#1A1A1A;">AI 连接</span>
      </div>
      <span style="padding:4px;border-radius:6px;color:#737373;cursor:pointer;font-size:16px;">×</span>
    </div>
    <div class="settings-body">
      <div class="settings-nav">
        <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#737373;margin-bottom:8px;padding:0 10px;">设置</div>
        <button class="nav-item active">连接</button>
        <button class="nav-item">外观</button>
      </div>
      <div class="settings-content">
        <div style="max-width:600px;">
          <div style="margin-bottom:24px;">
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#525252;margin-bottom:12px;">默认配置</div>
            <div class="card" style="display:flex;flex-direction:column;gap:16px;">
              <div>
                <label style="font-size:11px;font-weight:500;color:#525252;display:block;margin-bottom:6px;">默认连接</label>
                <select><option>OpenAI</option></select>
              </div>
              <div>
                <label style="font-size:11px;font-weight:500;color:#525252;display:block;margin-bottom:6px;">默认模型</label>
                <select><option>gpt-4o-mini</option></select>
              </div>
              <div>
                <label style="font-size:11px;font-weight:500;color:#525252;display:block;margin-bottom:6px;">思考程度</label>
                <div style="display:flex;gap:8px;">
                  <button style="flex:1;padding:6px 0;border-radius:8px;border:1px solid #E5E5E5;font-size:11px;background:transparent;color:#525252;">快速</button>
                  <button style="flex:1;padding:6px 0;border-radius:8px;border:1px solid #1A1A1A;font-size:11px;background:#EBEBEB;color:#1A1A1A;">平衡</button>
                  <button style="flex:1;padding:6px 0;border-radius:8px;border:1px solid #E5E5E5;font-size:11px;background:transparent;color:#525252;">深度</button>
                </div>
              </div>
            </div>
          </div>

          <div style="margin-bottom:24px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#525252;">已配置连接</div>
              <button class="btn-primary">+ 添加</button>
            </div>
            <div class="provider-card">
              <div class="dot green"></div>
              <div style="flex:1;">
                <div style="font-size:12px;font-weight:500;color:#1A1A1A;">OpenAI</div>
                <div style="font-size:10px;color:#737373;">https://api.openai.com/v1</div>
              </div>
              <span class="badge">默认</span>
              <span style="color:#737373;">›</span>
            </div>
            <div class="provider-card">
              <div class="dot gray"></div>
              <div style="flex:1;">
                <div style="font-size:12px;font-weight:500;color:#1A1A1A;">DeepSeek</div>
                <div style="font-size:10px;color:#737373;">https://api.deepseek.com/v1</div>
              </div>
              <span style="color:#737373;">›</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="footer">
      <button class="btn-ghost">取消</button>
      <button class="btn-primary">保存</button>
    </div>
  </div>
</div>
</body></html>`;

fs.writeFileSync('/tmp/settings-test.html', html);

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto('file:///tmp/settings-test.html', { waitUntil: 'networkidle0' });
  await page.screenshot({ path: '/home/hanasaku/Projects/note_agent/settings-screenshot.png', fullPage: false });
  console.log('✅ Settings screenshot saved: settings-screenshot.png');
  await browser.close();
})();
