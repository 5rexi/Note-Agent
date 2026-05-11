const puppeteer = require('puppeteer');
const fs = require('fs');

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; }
  .app { width: 1400px; height: 900px; display: flex; background: #FAFAFA; overflow: hidden; }
  .sidebar { width: 252px; background: #F5F5F5; display: flex; flex-direction: column; border-right: 1px solid #EEEEEE; }
  .sidebar-top { height: 42px; display: flex; align-items: center; justify-content: space-between; padding: 0 8px; border-bottom: 1px solid #EEEEEE; }
  .sidebar-content { flex: 1; overflow: auto; padding: 8px; }
  .folder-item { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
  .folder-item:hover { background: #EBEBEB; }
  .task-item { display: flex; align-items: center; gap: 6px; padding: 5px 8px 5px 24px; border-radius: 6px; cursor: pointer; font-size: 12px; color: #525252; }
  .task-item:hover { background: #EBEBEB; }
  .status-dot { width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid #E5E5E5; }
  .status-dot.done { border-color: #059669; background: #059669; }
  .status-dot.progress { border-color: #2563EB; }
  .sep { width: 4px; background: #EEEEEE; cursor: col-resize; }
  .sep:hover { background: #1A1A1A; }
  .editor { flex: 1; display: flex; flex-direction: column; background: #FFFFFF; }
  .editor-tabs { height: 42px; display: flex; align-items: center; padding: 0 8px; gap: 4px; border-bottom: 1px solid #EEEEEE; background: #F5F5F5; }
  .tab { display: flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 6px; font-size: 11px; background: #FFFFFF; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
  .tab-tools { margin-left: auto; display: flex; gap: 2px; }
  .tool-btn { padding: 4px; border-radius: 6px; color: #737373; }
  .tool-btn:hover { background: #EBEBEB; }
  .editor-body { flex: 1; display: flex; }
  .editor-main { flex: 1; display: flex; align-items: center; justify-content: center; color: #737373; font-size: 14px; }
  .editor-preview { width: 45%; border-left: 1px solid #EEEEEE; background: #FFFFFF; padding: 24px; }
  .status-bar { height: 22px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; border-top: 1px solid #EEEEEE; background: #F5F5F5; font-size: 11px; color: #737373; font-family: "JetBrains Mono", monospace; }
  .chat { width: 378px; background: #F5F5F5; display: flex; flex-direction: column; border-left: 1px solid #EEEEEE; }
  .chat-header { height: 42px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; border-bottom: 1px solid #EEEEEE; }
  .chat-body { flex: 1; padding: 12px; }
  .chat-msg { max-width: 90%; padding: 8px 12px; border-radius: 8px; margin-bottom: 8px; font-size: 13px; line-height: 1.5; }
  .chat-msg.user { margin-left: auto; background: #1A1A1A; color: #fff; border-radius: 8px 8px 2px 8px; }
  .chat-msg.assistant { background: #F0F0F0; color: #1A1A1A; border-radius: 8px 8px 8px 2px; }
  .chat-bottom { border-top: 1px solid #EEEEEE; padding: 8px 12px; }
  .chat-input { display: flex; align-items: end; gap: 8px; padding: 8px; border-radius: 12px; border: 1px solid #E5E5E5; background: #FFFFFF; }
  .chat-input textarea { flex: 1; border: none; outline: none; resize: none; font-size: 13px; font-family: inherit; background: transparent; height: 20px; }
  .chat-toolbar { display: flex; justify-content: space-between; margin-top: 6px; padding: 0 4px; }
  .mode-badge { display: flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 6px; font-size: 10px; color: #2563EB; background: rgba(37,99,235,0.08); }
  .section-title { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #737373; padding: 4px 8px; }
  .workspace-item { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 6px; font-size: 11px; cursor: pointer; }
  .workspace-item:hover { background: #EBEBEB; }
  .btn-icon { padding: 4px; border-radius: 6px; color: #737373; background: transparent; border: none; cursor: pointer; }
  .btn-icon:hover { background: #EBEBEB; }
  .attachments { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
  .att-tag { display: flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 6px; font-size: 10px; background: #EBEBEB; color: #525252; border: 1px solid #EEEEEE; }
</style>
</head>
<body>
<div class="app">
  <!-- Sidebar -->
  <div class="sidebar">
    <div class="sidebar-top">
      <div style="display:flex;align-items:center;gap:6px;">
        <div style="width:20px;height:20px;border-radius:6px;background:#1A1A1A;display:flex;align-items:center;justify-content:center;"><span style="font-size:10px;font-weight:bold;color:#fff;">N</span></div>
        <span style="font-size:12px;font-weight:600;color:#1A1A1A;">Note Agent</span>
      </div>
      <div style="display:flex;gap:2px;">
        <button class="btn-icon" title="新建任务">+</button>
        <button class="btn-icon" title="新建任务夹">📁</button>
        <button class="btn-icon">◀</button>
      </div>
    </div>
    <div style="display:flex;padding:8px;gap:4px;">
      <div style="flex:1;text-align:center;padding:6px 0;font-size:11px;font-weight:500;border-radius:8px;background:#EBEBEB;color:#1A1A1A;">任务</div>
      <div style="flex:1;text-align:center;padding:6px 0;font-size:11px;font-weight:500;border-radius:8px;color:#737373;">文件</div>
    </div>
    <div class="sidebar-content">
      <div class="folder-item">
        <span style="font-size:12px;color:#737373;">▼</span>
        <span style="font-size:12px;color:#D97706;">📁</span>
        <span style="font-size:12px;font-weight:500;color:#1A1A1A;flex:1;">项目开发</span>
        <span style="font-size:10px;color:#737373;background:#EBEBEB;padding:1px 5px;border-radius:4px;">3</span>
        <button class="btn-icon" style="opacity:0;">+</button>
      </div>
      <div class="task-item">
        <div class="status-dot progress"></div>
        <span>实现用户认证模块</span>
      </div>
      <div class="task-item">
        <div class="status-dot"></div>
        <span>设计数据库 Schema</span>
      </div>
      <div class="task-item">
        <div class="status-dot done"></div>
        <span style="text-decoration:line-through;opacity:0.6;">搭建项目骨架</span>
      </div>

      <div class="folder-item" style="margin-top:4px;">
        <span style="font-size:12px;color:#737373;">▶</span>
        <span style="font-size:12px;color:#D97706;">📁</span>
        <span style="font-size:12px;font-weight:500;color:#1A1A1A;flex:1;">文档整理</span>
        <span style="font-size:10px;color:#737373;background:#EBEBEB;padding:1px 5px;border-radius:4px;">1</span>
      </div>

      <div style="margin-top:16px;">
        <div class="section-title" style="display:flex;justify-content:space-between;align-items:center;">
          <span>工作区</span>
          <button class="btn-icon">+</button>
        </div>
        <div class="workspace-item" style="background:#EBEBEB;color:#1A1A1A;">
          <span style="font-size:12px;color:#1A1A1A;">📁</span>
          <span>note-agent</span>
        </div>
        <div class="workspace-item">
          <span style="font-size:12px;color:#737373;">📁</span>
          <span style="color:#737373;">reference</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Sep -->
  <div class="sep"></div>

  <!-- Editor -->
  <div class="editor">
    <div class="editor-tabs">
      <div class="tab">📄 README.md</div>
      <div class="tab" style="background:transparent;box-shadow:none;color:#737373;">🐍 main.py <span style="margin-left:4px;opacity:0;">×</span></div>
      <div class="tab-tools">
        <button class="tool-btn" title="预览">👁</button>
        <button class="tool-btn" title="仅预览">📄</button>
      </div>
    </div>
    <div class="editor-body">
      <div class="editor-main">
        <div style="text-align:center;">
          <div style="font-size:48px;margin-bottom:16px;opacity:0.15;">📝</div>
          <div>从文件树选择一个文件开始编辑</div>
          <div style="font-size:12px;margin-top:8px;opacity:0.5;">支持 Markdown、Python、JavaScript 等</div>
        </div>
      </div>
      <div class="editor-preview">
        <h1 style="font-size:1.5em;font-weight:700;margin-bottom:12px;">README</h1>
        <p style="line-height:1.65;color:#525252;">This is a preview of the markdown file.</p>
      </div>
    </div>
    <div class="status-bar">
      <div style="display:flex;gap:12px;">
        <span>Markdown</span>
        <span>UTF-8</span>
        <span style="color:#525252;">行 1, 列 1</span>
      </div>
      <div style="display:flex;gap:12px;align-items:center;">
        <span>· 已自动保存</span>
        <button class="btn-icon" style="padding:2px;" title="终端">⌨</button>
      </div>
    </div>
  </div>

  <!-- Sep -->
  <div class="sep"></div>

  <!-- Chat -->
  <div class="chat">
    <div class="chat-header">
      <span style="font-size:12px;font-weight:600;color:#1A1A1A;">实现用户认证模块</span>
      <span style="font-size:10px;padding:2px 8px;border-radius:4px;background:#EBEBEB;color:#737373;">note-agent</span>
    </div>
    <div class="chat-body">
      <div class="chat-msg assistant">
        我来帮你分析用户认证模块的实现方案。首先我们需要确定技术栈...
      </div>
      <div class="chat-msg user">
        使用 JWT + bcrypt，需要支持刷新令牌
      </div>
      <div class="chat-msg assistant" style="border-left:3px solid #2563EB;">
        好的，JWT + bcrypt 是经典组合。我建议以下目录结构：<br><br>
        <code style="background:#EBEBEB;padding:2px 6px;border-radius:4px;font-size:12px;">auth/<br>  ├─ jwt.ts<br>  ├─ password.ts<br>  └─ middleware.ts</code>
      </div>
    </div>
    <div class="chat-bottom">
      <div class="attachments">
        <div class="att-tag">🖼 screenshot.png <span style="cursor:pointer;">×</span></div>
        <div class="att-tag">📄 config.json <span style="cursor:pointer;">×</span></div>
      </div>
      <div class="chat-input">
        <textarea placeholder="输入消息..."></textarea>
        <button style="padding:6px;border-radius:8px;background:#1A1A1A;color:#fff;border:none;cursor:pointer;">➤</button>
      </div>
      <div class="chat-toolbar">
        <div style="display:flex;gap:8px;align-items:center;">
          <div class="mode-badge">⚡ 探索</div>
          <button class="btn-icon" style="font-size:10px;color:#737373;">📎 附件</button>
        </div>
        <button class="btn-icon" style="font-size:10px;color:#737373;">✨ gpt-4o-mini</button>
      </div>
    </div>
  </div>
</div>
</body></html>`;

fs.writeFileSync('/tmp/layout-test.html', html);

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto('file:///tmp/layout-test.html', { waitUntil: 'networkidle0' });
  await page.screenshot({ path: '/home/hanasaku/Projects/note_agent/layout-screenshot.png', fullPage: false });
  console.log('✅ Screenshot saved: layout-screenshot.png');
  await browser.close();
})();
