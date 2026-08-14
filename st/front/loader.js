/* ============================================================================
   罗马纪 · 酒馆前端加载器
   ----------------------------------------------------------------------------
   本段由角色卡里的显示层正则注入：正则把开场白里的舞台标记换成一个代码块，
   酒馆助手（JS-Slash-Runner）据 isFrontend 判定把它渲染成消息 iframe，本段在
   那个 iframe 里执行，然后往酒馆主窗上盖一个全屏容器承载游戏。

   设计上刻意做成「先给一个可见的面板，再由玩家点进去」：
   · 面板是纯 HTML，只要 iframe 渲出来了就一定看得见——万一后面哪一步失败，
     玩家看到的是一句写明原因的话，而不是一片空白。
   · 不自动全屏。每条 AI 消息都会重新触发本段，自动全屏会一直往玩家脸上糊。
   ============================================================================ */
(function () {
  'use strict';

  var CDN = '__CDN__';
  var ENTRY = CDN + 'st/front/index.html';
  var STAGE = 'roma-stage';

  var box = document.getElementById('romaBox');
  var msg = document.getElementById('romaMsg');
  var btn = document.getElementById('romaGo');
  function say(t, bad) {
    if (!msg) return;
    msg.textContent = t;
    msg.style.color = bad ? '#c0553c' : '#8b8b93';
  }

  /* 走到最顶层的酒馆主窗。层级是 游戏iframe → 消息iframe → 酒馆主窗 */
  var top = window, hops = 0;
  try {
    for (; hops < 8 && top.parent && top.parent !== top; hops++) top = top.parent;
  } catch (_) { top = window; }

  var doc = null, sameOrigin = false;
  try { doc = top.document; sameOrigin = !!(doc && doc.body !== undefined); } catch (_) { sameOrigin = false; }

  if (!sameOrigin) {
    say('够不到酒馆主窗（跨域）。请确认酒馆助手的「渲染」是开着的。', true);
    return;
  }

  function close() {
    var el = doc.getElementById(STAGE);
    if (el) el.remove();
    try { doc.documentElement.style.overflow = ''; } catch (_) { }
    top.__ROMA_STAGE_MOUNTED__ = false;
    say('已退出。可再次点「进入罗马」。');
  }

  function mount() {
    if (top.__ROMA_STAGE_MOUNTED__ || doc.getElementById(STAGE)) { say('已经在运行了。'); return; }
    top.__ROMA_STAGE_MOUNTED__ = true;
    say('正在取游戏本体…');

    var wrap = doc.createElement('div');
    wrap.id = STAGE;
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#060606;margin:0;padding:0;border:0';

    var fr = doc.createElement('iframe');
    fr.id = STAGE + '-frame';
    fr.setAttribute('allow', 'autoplay; fullscreen; xr-spatial-tracking; accelerometer; gyroscope');
    fr.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;display:block;background:#060606';

    var bar = doc.createElement('div');
    bar.textContent = 'EXIRE ✕';
    bar.style.cssText = 'position:absolute;right:12px;top:12px;z-index:2;'
      + 'font:11px/1 ui-monospace,Menlo,monospace;letter-spacing:.2em;color:#8b8b93;'
      + 'border:1px solid rgba(236,236,232,.3);padding:8px 13px;cursor:pointer;'
      + 'background:rgba(6,6,6,.85);user-select:none';
    bar.onclick = close;

    wrap.appendChild(fr);
    wrap.appendChild(bar);
    doc.body.appendChild(wrap);
    try { doc.documentElement.style.overflow = 'hidden'; } catch (_) { }

    /* 取整份文档再以 srcdoc 挂：直接 src= 会跨域，游戏里的垫片就够不到 TavernHelper。
       文档 <head> 里已有 <base href> 指向 CDN，里面所有相对路径照常解析。
       用主窗的 fetch（.call 绑定，否则 Illegal invocation），它不受本 iframe 的
       文档状态影响。 */
    var F = (top.fetch ? top.fetch.bind(top) : window.fetch.bind(window));
    F(ENTRY).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (html) {
      fr.srcdoc = html;
      say('已进入。右上角 EXIRE ✕ 退出。');
    }).catch(function (e) {
      close();
      say('取不到游戏本体：' + (e && e.message || e) + '（地址：' + ENTRY + '）', true);
    });
  }

  /* 本段能跑到这里，就证明酒馆助手把块渲染成 iframe 了、富路径是活的。
     于是把块外那份「保底告示」收起来——它只为「iframe 压根没渲出来」而存在，
     两份同时占屏反而吵。它在酒馆主窗的消息里，本 iframe 与之同源，够得到。 */
  try {
    var fb = doc.querySelectorAll('.roma-fallback');
    for (var i = 0; i < fb.length; i++) fb[i].style.display = 'none';
  } catch (_) { }

  if (btn) btn.onclick = mount;
  say('就绪。点上面的按钮进入。');

  /* 也挂到主窗，方便控制台手动调用 */
  try { top.__romaOpen = mount; top.__romaClose = close; } catch (_) { }
})();
