/**
 * 状態ビューアのWebView HTMLを生成する。
 * ローカルWebSocketサーバに接続し、MCP/外部エージェントから届いた状態を表示する。
 */
export function getStatusViewerHtml(
  host: string,
  port: number,
  token: string
): string {
  const wsUrl = `ws://${host}:${port}`;
  return /* html */ `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Vibe Remote</title>
<style>
  :root {
    --bg:#0e1116; --panel:#161b22; --line:#2a3340; --txt:#e6edf3; --muted:#9aa7b4;
    --green:#3fb950; --red:#f85149; --yellow:#e3b341; --blue:#58a6ff; --purple:#bc8cff;
  }
  * { box-sizing:border-box; }
  body { margin:0; font-family:"Segoe UI","Yu Gothic UI",sans-serif; background:var(--bg); color:var(--txt); padding:16px; }
  h2 { font-size:16px; margin:0 0 12px; }
  .status { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; }
  .chip { font-size:12px; padding:4px 10px; border:1px solid var(--line); border-radius:999px; color:var(--muted); }
  .dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:6px; vertical-align:middle; box-shadow:0 0 8px currentColor; background:var(--muted); color:var(--muted); }
  .dot.working { background:var(--blue); color:var(--blue); }
  .dot.maybeWaiting { background:var(--yellow); color:var(--yellow); animation:blink 1s infinite; }
  .dot.idle { background:#555; color:#555; }
  .dot.on { background:var(--green); color:var(--green); }
  @keyframes blink { 50% { opacity:.25; } }
  .lcd {
    background:#06090d; border:1px solid var(--line); border-radius:10px; padding:12px 14px;
    font-family:"Cascadia Code","Consolas",monospace; font-size:13px; line-height:1.6; margin-bottom:16px; min-height:96px;
  }
  .lcd .needed { color:var(--yellow); font-weight:700; }
  .lcd .ok { color:var(--green); }
  .lcd .bad { color:var(--red); }
  .lcd .agent { color:var(--purple); font-weight:700; }
  .lcd .muted { color:var(--muted); }
  button {
    border:2px solid var(--line); background:var(--panel); color:var(--txt);
    border-radius:12px; padding:14px; font-size:15px; font-weight:700; cursor:pointer;
    transition:transform .05s, background .15s;
  }
  button:active { transform:scale(.96); }
  button .sub { display:block; font-size:11px; font-weight:400; color:var(--muted); margin-top:3px; }
  .row { display:grid; grid-template-columns:1fr; gap:10px; margin-top:10px; }
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

    document.getElementById('lcd').innerHTML =
      header + '<br>' + agentLine + '<br>' + (cmdLine || '<span class="muted">no command</span>') + '<br>' + errLine + '<br>' + fileLine +
      (extra.length ? '<br><span class="muted">' + extra.join('  ') + '</span>' : '');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  document.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => send(btn.getAttribute('data-action')));
  });

  connect();
</script>
</body>
</html>`;
}
