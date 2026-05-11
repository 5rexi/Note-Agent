const puppeteer = require('puppeteer');
const fs = require('fs');

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; }
  .app { width: 1400px; height: 900px; display: flex; background: #FAFAFA; overflow: hidden; }
  .sidebar { width: 260px; background: #F5F5F5; display: flex; flex-direction: column; border-right: 1px solid #EEEEEE; }
  .sidebar-top { height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; border-bottom: 1px solid #EEEEEE; }
  .section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #737373; padding: 6px 12px; }
  .folder-item { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 8px; cursor: pointer; }
  .folder-item:hover { background: #EBEBEB; }
  .status-group { display: flex; align-items: center; gap: 6px; padding: 5px 10px 5px 28px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .status-group:hover { background: #EBEBEB; }
  .task-item { display: flex; align-items: center; gap: 6px; padding: 5px 10px 5px 44px; border-radius: 6px; cursor: pointer; font-size: 13px; color: #525252; }
  .task-item:hover { background: #EBEBEB; }
  .nav-item { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 8px; cursor: pointer; font-size: 13px; color: #525252; }
  .nav-item:hover { background: #EBEBEB; }
  .sep { width: 4px; background: #EEEEEE; }
  .editor { flex: 1; display: flex; flex-direction: column; background: #FFFFFF; }
  .editor-tabs { height: 48px; display: flex; align-items: center; padding: 0 12px; gap: 4px; border-bottom: 1px solid #EEEEEE; background: #F5F5F5; }
  .tab { display: flex; align-items: center; gap: 4px; padding: 5px 12px; border-radius: 8px; font-size: 12px; background: #FFFFFF; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
  .tab-tools { margin-left: auto; display: flex; gap: 4px; }
  .tool-btn { padding: 5px 10px; border-radius: 6px; font-size: 11px; color: #737373; background: transparent; border: none; cursor: pointer; }
  .editor-body { flex: 1; display: flex; }
  .editor-main { flex: 1; display: flex; align-items: center; justify-content: center; color: #737373; font-size: 14px; }
  .status-bar { height: 24px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; border-top: 1px solid #EEEEEE; background: #F5F5F5; font-size: 11px; color: #737373; font-family: "JetBrains Mono", monospace; }
  .chat { width: 360px; background: #F5F5F5; display: flex; flex-direction: column; border-left: 1px solid #EEEEEE; }
  .chat-header { height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; border-bottom: 1px solid #EEEEEE; }
  .chat-body { flex: 1; padding: 12px; }
  .chat-msg { max-width: 90%; padding: 10px 14px; border-radius: 12px; margin-bottom: 10px; font-size: 13px; line-height: 1.6; }
  .chat-msg.user { margin-left: auto; background: #1A1A1A; color: #fff; border-radius: 12px 12px 4px 12px; }
  .chat-msg.assistant { background: #F0F0F0; color: #1A1A1A; border-radius: 12px 12px 12px 4px; }
  .chat-bottom { border-top: 1px solid #EEEEEE; padding: 12px; background: #F5F5F5; }
  .chat-input { width: 100%; padding: 10px 14px; border-radius: 12px; border: 1px solid #E5E5E5; background: #FFFFFF; font-size: 14px; outline: none; resize: none; min-height: 56px; font-family: inherit; }
  .chat-toolbar { display: flex; justify-content: space-between; margin-top: 10px; }
  .mode-badge { display: flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 8px; font-size: 11px; }
  .badge-blue { color: #2563EB; background: rgba(37,99,235,0.08); }
  .badge-gray { color: #737373; background: #EBEBEB; }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .section-divider { height: 1px; background: #EEEEEE; margin: 6px 12px; }
</style>
</head>
<body>
<div class="app">
  <!-- Sidebar -->
  <div class="sidebar">
    <div class="sidebar-top">
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="width:24px;height:24px;border-radius:8px;background:#1A1A1A;display:flex;align-items:center;justify-content:center;"><span style="font-size:11px;font-weight:bold;color:#fff;">N</span></div>
        <span style="font-size:13px;font-weight:600;color:#1A1A1A;">Note Agent</span>
      </div>
      <div style="display:flex;gap:2px;">
        <span style="padding:6px;cursor:pointer;color:#737373;">+</span>
        <span style="padding:6px;cursor:pointer;color:#737373;">📁</span>
        <span style="padding:6px;cursor:pointer;color:#737373;">◀</span>
      </div>
    </div>

    <!-- Tasks Section -->
    <div style="flex:1;overflow:auto;padding:8px 0;">
      <div class="section-title">任务</div>
      <div class="folder-item">
        <span style="font-size:12px;color:#737373;">▼</span>
        <span style="font-size:13px;color:#2563EB;">📥</span>
        <span style="font-size:13px;font-weight:500;color:#1A1A1A;flex:1;">默认</span>
        <span style="font-size:11px;color:#737373;background:#EBEBEB;padding:1px 6px;border-radius:4px;">3</span>
      </div>
      <div class="status-group">
        <span style="color:#737373">○</span>
        <span style="color:#737373;font-size:12px;">待办</span>
        <span style="color:#737373;font-size:11px;margin-left:auto;">2</span>
      </div>
      <div class="task-item"><div style="width:12px;height:12px;border-radius:50%;border:1.5px solid #E5E5E5;"></div> 实现用户认证模块</div>
      <div class="task-item"><div style="width:12px;height:12px;border-radius:50%;border:1.5px solid #E5E5E5;"></div> 设计数据库 Schema</div>
      <div class="status-group">
        <span style="color:#059669">✓</span>
        <span style="color:#059669;font-size:12px;">已完成</span>
        <span style="color:#737373;font-size:11px;margin-left:auto;">1</span>
      </div>
      <div class="task-item"><div style="width:12px;height:12px;border-radius:50%;background:#059669;border:1.5px solid #059669;"></div> <span style="text-decoration:line-through;opacity:0.6;">搭建项目骨架</span></div>
      <div class="status-group">
        <span style="color:#737373">○</span>
        <span style="color:#737373;font-size:12px;">进行中</span>
        <span style="color:#737373;font-size:11px;margin-left:auto;">0</span>
      </div>

      <div class="folder-item" style="margin-top:4px;">
        <span style="font-size:12px;color:#737373;">▶</span>
        <span style="font-size:13px;color:#D97706;">📁</span>
        <span style="font-size:13px;font-weight:500;color:#1A1A1A;flex:1;">文档整理</span>
        <span style="font-size:11px;color:#737373;background:#EBEBEB;padding:1px 6px;border-radius:4px;">1</span>
      </div>

      <div class="section-divider"></div>

      <!-- Workspaces -->
      <div class="section-title">工作区</div>
      <div class="nav-item" style="background:#EBEBEB;color:#1A1A1A;">
        <span style="font-size:13px;">📁</span>
        <span>note-agent</span>
      </div>
      <div class="nav-item">
        <span style="font-size:13px;color:#737373;">📁</span>
        <span style="color:#737373;">reference</span>
      </div>

      <div class="section-divider"></div>

      <!-- Data Sources -->
      <div class="section-title">数据源</div>
      <div class="nav-item">
        <span style="font-size:13px;color:#737373;">🌐</span>
        <span>API</span>
      </div>
      <div class="nav-item">
        <span style="font-size:13px;color:#737373;">🔌</span>
        <span>MCP</span>
      </div>
      <div class="nav-item">
        <span style="font-size:13px;color:#737373;">💾</span>
        <span>本地文件夹</span>
      </div>

      <div class="section-divider"></div>

      <!-- Skills -->
      <div class="section-title">技能</div>
      <div class="nav-item">
        <span style="font-size:13px;color:#737373;">🔧</span>
        <span>工作区技能</span>
      </div>

      <div class="section-divider"></div>

      <!-- Automation -->
      <div class="section-title">自动化</div>
      <div class="nav-item">
        <span style="font-size:13px;color:#737373;">⏰</span>
        <span>定时任务</span>
      </div>
      <div class="nav-item">
        <span style="font-size:13px;color:#737373;">⚡</span>
        <span>事件触发</span>
      </div>
      <div class="nav-item">
        <span style="font-size:13px;color:#737373;">🤖</span>
        <span>智能体</span>
      </div>
    </div>

    <!-- Bottom -->
    <div style="padding:8px 12px;border-top:1px solid #EEEEEE;">
      <div style="display:flex;gap:8px;">
        <div style="flex:1;text-align:center;padding:6px 0;font-size:12px;font-weight:500;border-radius:8px;background:#EBEBEB;color:#1A1A1A;">任务</div>
        <div style="flex:1;text-align:center;padding:6px 0;font-size:12px;font-weight:500;border-radius:8px;color:#737373;">文件</div>
      </div>
    </div>
  </div>

  <div class="sep"></div>

  <!-- Editor -->
  <div class="editor">
    <div class="editor-tabs">
      <div class="tab">📄 README.md</div>
      <div class="tab" style="background:transparent;box-shadow:none;color:#737373;">🐍 main.py</div>
      <div class="tab-tools">
        <button class="tool-btn" style="background:rgba(26,26,26,0.08);color:#1A1A1A;">👁 编辑</button>
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
    </div>
    <div class="status-bar">
      <div style="display:flex;gap:12px;">
        <span>Markdown</span>
        <span>UTF-8</span>
        <span style="color:#525252;">行 1, 列 1</span>
      </div>
      <div>· 已自动保存</div>
    </div>
  </div>

  <div class="sep"></div>

  <!-- Chat -->
  <div class="chat">
    <div class="chat-header">
      <span style="font-size:13px;font-weight:600;color:#1A1A1A;">实现用户认证模块</span>
      <span style="font-size:10px;padding:3px 8px;border-radius:4px;background:#EBEBEB;color:#737373;">note-agent</span>
    </div>
    <div class="chat-body">
      <div class="chat-msg assistant">
        我来帮你分析用户认证模块的实现方案。首先我们需要确定技术栈...
      </div>
      <div class="chat-msg user">
        使用 JWT + bcrypt，需要支持刷新令牌
      </div>
      <div class="chat-msg assistant" style="border-left:3px solid #2563EB;">
        好的，JWT + bcrypt 是经典组合。我建议以下目录结构：auth/ ├─ jwt.ts ├─ password.ts └─ middleware.ts
      </div>
    </div>
    <div class="chat-bottom">
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <div class="mode-badge badge-blue">⚡ 探索</div>
        <div class="mode-badge badge-gray">○ 待办</div>
      </div>
      <textarea class="chat-input" placeholder="输入消息..."></textarea>
      <div class="chat-toolbar">
        <div style="display:flex;gap:12px;align-items:center;">
          <span style="font-size:11px;color:#737373;cursor:pointer;">📎 附件</span>
          <span style="font-size:11px;color:#737373;cursor:pointer;">🔌 选择数据源</span>
          <span style="font-size:11px;color:#737373;">📁 note-agent</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <span style="font-size:11px;color:#737373;cursor:pointer;">✨ gpt-4o-mini</span>
          <button style="width:28px;height:28px;border-radius:8px;background:#1A1A1A;color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;">➤</button>
        </div>
      </div>
    </div>
  </div>
</div>
</body></html>`;

fs.writeFileSync('/tmp/final-test.html', html);

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto('file:///tmp/final-test.html', { waitUntil: 'networkidle0' });
  await page.screenshot({ path: '/home/hanasaku/Projects/note_agent/final-screenshot.png', fullPage: false });
  console.log('✅ Final screenshot saved: final-screenshot.png');
  await browser.close();
})();
