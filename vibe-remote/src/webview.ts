/**
 * 状態ビューアのWebView HTMLを生成する。
 * ローカルWebSocketサーバに接続し、承認ブローカーやデバイス状態を表示する。
 */
export function getStatusViewerHtml(host: string, port: number, token: string): string {
  const wsUrl = `ws://${host}:${port}`;
  return /* html */ `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Vibe Remote</title>
<style>
  :root {
    --bg:#0e1116; --panel:#161b22; --panel2:#1c2330; --line:#2a3340; --txt:#e6edf3; --muted:#9aa7b4;
    --green:#3fb950; --red:#f85149; --yellow:#e3b341; --blue:#58a6ff; --purple:#bc8cff;
    --radius:14px; --shadow:0 10px 24px -12px rgba(0,0,0,.6);
  }
  * { box-sizing:border-box; }
  body {
    margin:0; font-family:"Segoe UI","Yu Gothic UI",sans-serif; color:var(--txt); padding:18px;
    background:radial-gradient(900px 460px at 78% -12%, #1b2740 0%, var(--bg) 55%);
    min-height:100vh;
  }
  h2 {
    font-size:15px; margin:0 0 14px; display:flex; align-items:center; gap:8px;
    letter-spacing:.02em; color:var(--txt);
  }
  h2::before {
    content:""; display:inline-block; width:8px; height:8px; border-radius:50%;
    background:var(--blue); box-shadow:0 0 10px var(--blue);
  }
  .status { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
  .chip {
    font-size:12px; padding:5px 12px; border:1px solid var(--line); border-radius:999px; color:var(--muted);
    background:rgba(255,255,255,.03); backdrop-filter:blur(2px);
  }
  .dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:6px; vertical-align:middle; box-shadow:0 0 8px currentColor; background:var(--muted); color:var(--muted); }
  .dot.working { background:var(--blue); color:var(--blue); }
  .dot.maybeWaiting { background:var(--yellow); color:var(--yellow); animation:blink 1s infinite; }
  .dot.idle { background:#555; color:#555; }
  .dot.on { background:var(--green); color:var(--green); }
  @keyframes blink { 50% { opacity:.25; } }
  .lcd {
    background:linear-gradient(180deg,var(--panel),var(--panel2));
    border:1px solid var(--line); border-radius:var(--radius); padding:14px 16px;
    font-family:"Cascadia Code","Consolas",monospace; font-size:13px; line-height:1.65;
    margin-bottom:16px; min-height:96px; box-shadow:var(--shadow);
  }
  .lcd .needed { color:var(--yellow); font-weight:700; }
  .lcd .ok { color:var(--green); }
  .lcd .bad { color:var(--red); }
  .lcd .agent { color:var(--purple); font-weight:700; }
  .lcd .muted { color:var(--muted); }
  button {
    border:1px solid var(--line); background:linear-gradient(180deg,var(--panel),var(--panel2)); color:var(--txt);
    border-radius:12px; padding:14px; font-size:15px; font-weight:700; cursor:pointer;
    transition:transform .05s, filter .15s, border-color .15s; box-shadow:var(--shadow);
  }
  button:hover { border-color:var(--blue); }
  button:active { transform:scale(.96); filter:brightness(1.08); }
  button .sub { display:block; font-size:11px; font-weight:400; color:var(--muted); margin-top:3px; }
  .row { display:grid; grid-template-columns:1fr; gap:10px; margin-top:10px; }
  .decision-actions { display:grid; grid-template-columns:1fr; gap:8px; margin-top:12px; }
  .decision-actions button { border-radius:8px; padding:10px 12px; font-size:13px; text-align:left; box-shadow:none; }
  .decision-actions button.selected { border-color:var(--yellow); color:var(--yellow); }
  .decision-actions button:disabled { opacity:.55; cursor:default; transform:none; }
  .small { padding:10px; font-size:13px; }
  .log { margin-top:14px; font-size:11px; color:var(--muted); max-height:120px; overflow:auto; border-top:1px solid var(--line); padding-top:8px; }
  .conn { font-size:11px; color:var(--muted); margin-bottom:10px; }
</style>
</head>
<body>
  <h2>Vibe Remote — 状態ビューア</h2>
  <div class="conn" id="conn">接続中… ${wsUrl}</div>

  <div class="status">
    <span class="chip"><span class="dot" id="chatDot"></span><span id="chatTxt">chat: ?</span></span>
    <span class="chip"><span class="dot" id="agentDot"></span><span id="agentTxt">agent: ?</span></span>
  </div>

  <div class="lcd" id="lcd"><span class="muted">状態を待っています…</span></div>

  <div class="row">
    <button class="small" data-action="ping">状態取得</button>
  </div>

  <div class="log" id="log"></div>

<script>
  const WS_URL = ${JSON.stringify(wsUrl)};
  const TOKEN = ${JSON.stringify(token)};
  let ws;
  let reconnectTimer;

  const logEl = document.getElementById('log');
  function log(msg) {
    const t = new Date().toLocaleTimeString();
    logEl.innerHTML = '[' + t + '] ' + msg + '<br>' + logEl.innerHTML;
  }

  function setConn(text, ok) {
    const el = document.getElementById('conn');
    el.textContent = text;
    el.style.color = ok ? 'var(--green)' : 'var(--muted)';
  }

  function connect() {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      setConn('接続済み ' + WS_URL, true);
      log('接続しました');
      ws.send(JSON.stringify({ type:'hello', token:TOKEN }));
    };
    ws.onclose = () => {
      setConn('切断 — 再接続します…', false);
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 1500);
    };
    ws.onerror = () => log('WebSocketエラー');
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'state') { renderState(msg); }
      else if (msg.type === 'ack') {
        log('ack: ' + (msg.ok ? 'OK' : 'NG') + (msg.error ? ' (' + msg.error + ')' : ''));
      }
    };
  }

  function send(action) {
    if (!ws || ws.readyState !== WebSocket.OPEN) { log('未接続のため送信できません'); return; }
    if (action === 'ping') { ws.send(JSON.stringify({ type:'ping', token:TOKEN })); return; }
    log('未対応の操作です: ' + action);
  }

  function sendUiAction(uiId, actionId) {
    if (!ws || ws.readyState !== WebSocket.OPEN) { log('未接続のため送信できません'); return; }
    if (!uiId || !actionId) { return; }
    ws.send(JSON.stringify({
      type:'uiAction',
      token:TOKEN,
      uiId,
      actionId,
      button:'chat',
      source:'chat-button'
    }));
    log('選択を送信しました: ' + actionId);
  }

  function setDot(id, cls, on) {
    const dot = document.getElementById(id);
    dot.className = 'dot ' + (on ? cls : '');
  }

  function renderState(s) {
    const chatLabel = s.chat === 'idle' ? 'quiet?' : s.chat;
    document.getElementById('chatTxt').textContent = 'chat: ' + chatLabel;
    document.getElementById('chatDot').className = 'dot ' + s.chat;

    const a = s.activity || {};
    const agent = s.agent;
    document.getElementById('agentTxt').textContent = agent ? 'agent: ' + agent.status : 'agent: no signal';
    setDot('agentDot', 'on', !!agent && (agent.status === 'running' || agent.status === 'waiting'));
    const header = s.chat === 'maybeWaiting'
      ? '<span class="needed">WAITING (agent reported)</span>'
      : (s.chat === 'working' ? '<span class="ok">WORKING</span>' : '<span class="muted">quiet / unknown</span>');
    const agentLine = agent
      ? '<span class="agent">agent ' + escapeHtml(agent.source || 'agent') + ': ' + escapeHtml(agent.status) + '</span>' +
        (agent.message ? ' <span class="muted">' + escapeHtml(agent.message) + '</span>' : '')
      : '<span class="muted">agent: no signal</span>';
    let cmdLine = '';
    if (a.command) {
      const running = (a.exitCode === undefined || a.exitCode === null);
      const mark = running ? '<span class="muted">▶</span>' : (a.exitCode === 0 ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>');
      const code = running ? 'running' : ('exit ' + a.exitCode);
      cmdLine = mark + ' ' + escapeHtml(a.command) + '  <span class="muted">' + code + '</span>';
    }
    const errLine = (a.errors || a.warnings)
      ? '<span class="bad">⚠ ' + (a.errors||0) + ' errors</span>  <span class="muted">' + (a.warnings||0) + ' warn</span>'
      : '<span class="muted">no diagnostics</span>';
    const fileLine = a.file ? '📄 ' + escapeHtml(a.file) : '<span class="muted">no file</span>';
    const extra = [];
    if (a.debugging) extra.push('debug');
    if (a.taskRunning) extra.push('task');
    if (a.focused === false) extra.push('unfocused');

    if (s.ui) {
      const ui = s.ui;
      const selected = Number.isFinite(ui.selected) ? ui.selected : 0;
      const actions = Array.isArray(ui.actions) ? ui.actions : [];
      const answered = ui.state === 'done';
      const lines = [];
      lines.push(
        '<span class="' + (answered ? 'ok' : 'needed') + '">' +
        escapeHtml(ui.title || 'Device UI') +
        '</span>'
      );
      if (ui.message) lines.push(escapeHtml(ui.message));
      if (Array.isArray(ui.fields)) {
        for (const f of ui.fields.slice(0, 3)) {
          lines.push('<span class="muted">' + escapeHtml(f.label || '') + '</span> ' + escapeHtml(f.value || ''));
        }
      }
      for (let i = 0; i < actions.length; i++) {
        const mark = i === selected ? '> ' : '  ';
        const cls = i === selected ? 'ok' : 'muted';
        lines.push('<span class="' + cls + '">' + mark + escapeHtml(actions[i].label || actions[i].id || '?') + '</span>');
      }
      lines.push(
        '<span class="muted">' +
        (answered ? 'Answered. Waiting for agent.' : 'A Select / B Next / P Back') +
        '</span>'
      );
      const buttons = actions.map((action, i) => {
        const label = escapeHtml(action.label || action.id || '?');
        const selectedClass = i === selected ? ' selected' : '';
        const disabled = answered ? ' disabled' : '';
        return '<button class="decision-choice' + selectedClass + '" data-ui-id="' +
          escapeAttr(ui.id) + '" data-action-id="' + escapeAttr(action.id || '') + '"' + disabled + '>' +
          label + '</button>';
      }).join('');
      document.getElementById('lcd').innerHTML =
        lines.join('<br>') +
        (buttons ? '<div class="decision-actions">' + buttons + '</div>' : '');
      return;
    }

    document.getElementById('lcd').innerHTML =
      header + '<br>' + agentLine + '<br>' + (cmdLine || '<span class="muted">no command</span>') + '<br>' + errLine + '<br>' + fileLine +
      (extra.length ? '<br><span class="muted">' + extra.join('  ') + '</span>' : '');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  document.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => send(btn.getAttribute('data-action')));
  });
  document.getElementById('lcd').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button.decision-choice');
    if (!btn || btn.disabled) { return; }
    sendUiAction(btn.getAttribute('data-ui-id'), btn.getAttribute('data-action-id'));
  });

  connect();
</script>
</body>
</html>`;
}
