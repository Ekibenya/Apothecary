/* ============================================================================
   罗马纪 · 酒馆前端垫片
   ----------------------------------------------------------------------------
   目标是「一模一样」，所以这里不改应用的任何一行：主文档、引擎、棋子模块、
   three 全都照原样从 CDN 取，跑的是与线上同一份文件。整份移植的改动量就是这个
   文件——它只做三件事，全部落在 window.fetch 这一个拦截点上：

     1) 神谕请求  发往 <API.base>/chat/completions 的那一发，转给酒馆的
        TavernHelper.generateRaw，再把回复重新封装成 OpenAI 的 SSE 流交回去。
        应用那边 oracleCall 里的续写、空闲看门狗、中断、去重一整套原样生效——
        它根本不知道换了后端。
     2) 资材请求  整包 29.3MB 换成取五个压缩块，当场拼回与原档逐字节相同的字节。
        引擎拿到手的东西跟以前完全一致，所以引擎不用动。
     3) 接线状态  预填 API 三件套，让 apiReady() 为真，走的还是原来的流程。

   跑在酒馆助手的角色脚本里：脚本 content 是 JS，注入进一个带 jQuery 与
   TavernHelper 桥的常驻隐藏 iframe。本文件由那个脚本注入进游戏 iframe。
   ============================================================================ */
(function () {
  'use strict';

  var CFG = window.__ROMA_ST__ || {};
  var BASE = CFG.base || '';                       /* CDN 根，末尾带斜杠 */
  /* 桥不靠注入，自己沿父链往上找：本文档是 srcdoc，与酒馆同源，
     而脚本 iframe 与游戏 iframe 谁先跑不好保证，注入式会有竞态。
     层级是 游戏iframe → 脚本iframe → 酒馆主窗，最多走三层。 */
  function upfind(pick) {
    var w = window;
    for (var i = 0; i < 6; i++) {
      try { var v = pick(w); if (v) return v; } catch (_) { }
      if (w.parent === w) break;
      w = w.parent;
    }
    return null;
  }
  function helper() { return CFG.helper || upfind(function (w) { return w.TavernHelper; }); }
  function events() {
    if (CFG.events) return CFG.events;
    var w = upfind(function (w) { return w.eventOn ? w : null; });
    return w ? { on: w.eventOn.bind(w), off: (w.eventRemoveListener || w.eventOff || function () { }).bind(w) } : null;
  }
  function ievents() {
    return CFG.iframe_events || upfind(function (w) { return w.iframe_events; }) || {
      STREAM_TOKEN_RECEIVED_INCREMENTALLY: 'js_stream_token_received_incrementally',
      STREAM_TOKEN_RECEIVED_FULLY: 'js_stream_token_received_fully',
      GENERATION_ENDED: 'js_generation_ended',
      GENERATION_STARTED: 'js_generation_started',
    };
  }
  var PACKS = CFG.packs || null;                   /* 压缩块清单，没有就走原档 */
  var KEY = CFG.key || '';                         /* 资材异或密钥 */
  /* CDN 上只发布了罗马仓。罗马线兜底取到的与卡配套同版，放行；其他线（埃及等）
     从那里拿到的是同名旧文件——旧引擎配新正文，选开局就炸、沙盘必 404。
     宁可干净地降级纯文字，也绝不放行走这条毒路。 */
  var NET = (CFG.line || 'roma') === 'roma';

  /* ------------------------------------------------- 卡内嵌入资材（自包含） ---
     资材与三维引擎以 base64 存在角色卡 data.extensions.roma_assets 里
     （ST 对不认识的 extensions 字段原样保留、也不入提示词）。
     取数路径：先嵌入、后网络——墙内玩家没有 jsDelivr 也能出三维。 */
  /* 一台酒馆里往往同时装着本系列的好几张卡（罗马、埃及、新旧版本各一张）。
     原先「取第一张带 roma_assets 的」认得不准，认错了就去别家的头像里找资材块——
     本线独有的那几块（desert、modern）在别家卡里当然没有，于是一路跌到 CDN 兜底，
     而 CDN 上只发布了罗马仓，埃及仓压根没有，兜底必 404。
     认卡顺序改为：线号精确匹配 → 当前对话的角色 → 首张带资材的。 */
  function stCtx() {
    var t = window, i = 0;
    for (; i < 8 && t.parent && t.parent !== t; i++) t = t.parent;
    try {
      var ctx = t.SillyTavern && t.SillyTavern.getContext && t.SillyTavern.getContext();
      return (ctx && ctx.characters) ? { top: t, ctx: ctx } : null;
    } catch (_) { return null; }
  }
  var MYC;                                         /* undefined=还没认过 */
  function myChar() {
    if (MYC !== undefined) return MYC;
    MYC = null;
    var s = stCtx();
    if (!s) return MYC;
    var cs = [].slice.call(s.ctx.characters);
    function has(c) { var d = c && c.data; return !!(d && d.extensions && d.extensions.roma_assets); }
    function line(c) { try { return c.data.extensions.roma.line; } catch (_) { return null; } }
    /* 正在对话的这张就是本卡，先认它——同一条线的新旧两版同时装着时，
       只按线号挑会挑到列表里靠前的那张旧卡，资材便从旧卡的头像里取。
       characterId 取不到（酒馆还没落定）时才退回线号，最后才是「随便一张带资材的」。 */
    var pick = null, j;
    if (s.ctx.characterId != null && has(cs[s.ctx.characterId])) pick = cs[s.ctx.characterId];
    if (!pick && CFG.line)
      for (j = 0; j < cs.length; j++) if (has(cs[j]) && line(cs[j]) === CFG.line) { pick = cs[j]; break; }
    if (!pick) for (j = 0; j < cs.length; j++) if (has(cs[j])) { pick = cs[j]; break; }
    MYC = pick;
    if (pick) log('认卡', pick.name, '·', pick.avatar);
    else log('认卡失败：酒馆里没找到带资材的本卡');
    return MYC;
  }
  var EMB = null;
  function embed() {
    if (EMB !== null) return EMB;
    EMB = false;
    try {
      var c = myChar();
      if (c) EMB = c.data.extensions.roma_assets;
    } catch (_) { }
    if (EMB) log('卡内嵌入资材已接上', Object.keys(EMB.packs || {}).length + ' 包 / '
                 + Object.keys(EMB.engines || {}).length + ' 引擎');
    return EMB;
  }
  function b64bytes(b64) {
    return fetch('data:application/octet-stream;base64,' + b64)
      .then(function (r) { return r.arrayBuffer(); });
  }
  var log = function () { try { console.log.apply(console, ['[roma·st]'].concat([].slice.call(arguments))); } catch (_) { } };

  /* --------------------------------------------- PNG 数据块直供（v0.0.8） ---
     二进制资材塞进 JSON 要连过两层 base64，白付 78% 的编码税。改为把它们作为
     roMa 私有 ancillary 块附在角色卡 PNG 本体里（PNG 阅览器一律无视私有块，
     封面显示不受影响），运行时把这张卡自己的头像文件取回来按块拆开。
     块载荷：'RMA1' + uint16 名长 + 名(utf8) + 数据。
     遇到会剥私有块的酒馆分叉：取不到就静默落回 CDN——行为等同标准版，不黑屏。 */
  var PNGA = null;                     /* false=不可用；Promise/对象={名:Uint8Array} */
  function avatarUrls() {
    var s = stCtx(), c = myChar();
    if (!s || !c || !c.avatar) return [];
    var enc = String(c.avatar).split('/').map(encodeURIComponent).join('/');
    var href = '', org = '', out = [];
    try { href = s.top.location.href || ''; } catch (_) { }
    try { org = s.top.location.origin || ''; } catch (_) { }
    /* 文档头上有 <base href=CDN>，根相对路径会被解析到 CDN 去，必须拼绝对地址。
       又：反向代理常把酒馆挂在子路径下（…/tavern/），只拼 origin 会指到站点根、
       必然 404。所以先按主窗当前地址解析一次相对路径，再退回 origin 的老拼法。
       再又：Tauri 壳（TauriTavern 等）的页面挂在 tauri://localhost 这类自定义
       协议上——不是 http 也可能照常吐文件，凡解析得出的候选都排上，
       全都取不到再落「资材恢复」面板，不亏。 */
    try { if (href) out.push(new URL('characters/' + enc, href).href); } catch (_) { }
    try { if (href) out.push(new URL('/characters/' + enc, href).href); } catch (_) { }
    if (/^http/.test(org)) out.push(org + '/characters/' + enc);
    var seen = {}, uniq = [];
    out.forEach(function (u) { if (!seen[u]) { seen[u] = 1; uniq.push(u); } });
    return uniq;
  }
  function parsePngChunks(ab) {
    var u = new Uint8Array(ab), dv = new DataView(ab);
    if (u.length < 8 || u[0] !== 0x89 || u[1] !== 0x50) return null;   /* 非 PNG */
    var off = 8, map = {}, dec = new TextDecoder(), hit = 0;
    while (off + 12 <= u.length) {
      var len = dv.getUint32(off), typ = dec.decode(u.subarray(off + 4, off + 8));
      if (off + 12 + len > u.length) break;          /* 尾块被截断：宁缺毋滥，不收残数据 */
      var data = u.subarray(off + 8, off + 8 + len);
      if (typ === 'roMa' && len > 10 &&
          data[0] === 82 && data[1] === 77 && data[2] === 65 && data[3] === 49) { /* RMA1 */
        var nl = data[4] | (data[5] << 8);
        var name = dec.decode(data.subarray(6, 6 + nl));
        map[name] = data.subarray(6 + nl);
        hit++;
      }
      off += 12 + len;
      if (typ === 'IEND') break;
    }
    return hit ? map : null;
  }
  /* --------------------------------------------- 资材自恢复（v0.0.9） ---
     官方酒馆导入 PNG 卡时会把头像整图解码重编码（Jimp），roMa 私有块无一幸存、
     且无配置可关——「转 CDN 兜底」在私有仓上等于判死。于是给玩家留一条自救路：
     头像上取不到块时先查 IndexedDB，再不行就弹一次面板，让玩家把手里那张
     原版卡 PNG 重选一次，就地解出 roMa 块入库。一次恢复、永久离线，卡体积不变。 */
  /* 一份块表「够不够本卡用」的唯一标准——头像取到的、本地库存的、玩家选的，
     三条路进来的表都过同一道闸：引擎齐、清单资材齐（中原包只随完全版，豁免）、
     线号造牌对得上（老卡没有 meta 牌，宽免）。不齐宁可不用——半套表会让
     个别引擎漏去 CDN 拉同名旧文件，正是闸门要防的事故。 */
  function mapOk(m) {
    if (!m) return false;
    try {
      if (m['meta/card']) {
        var meta = JSON.parse(new TextDecoder().decode(m['meta/card']));
        if (meta.line && CFG.line && meta.line !== CFG.line) return false;
      }
    } catch (_) { }
    if (CFG.engs && !CFG.engs.every(function (n) { return m['eng/' + n + '.gz']; })) return false;
    if (PACKS && PACKS.chunks && !Object.keys(PACKS.chunks).every(function (k) {
      return k === 'zhou' || m['pack/' + PACKS.chunks[k].file]; })) return false;
    return true;
  }
  function cardKey() {
    var c = myChar();
    return (c && c.avatar) ? String(c.avatar) : 'roma-line';
  }
  function idbOpen() {
    return new Promise(function (res, rej) {
      var rq = indexedDB.open('roma-assets-db', 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore('cards'); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function idbLoad(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (res) {
        var rq = db.transaction('cards').objectStore('cards').get(key);
        rq.onsuccess = function () {
          var v = rq.result;
          if (!v) return res(null);
          var m = {};
          Object.keys(v).forEach(function (n) { m[n] = new Uint8Array(v[n]); });
          res(m);
        };
        rq.onerror = function () { res(null); };
      });
    }).catch(function () { return null; });
  }
  function idbSave(key, map) {
    return idbOpen().then(function (db) {
      return new Promise(function (res) {
        var v = {};
        /* 存拷贝：map 里的视图都指向同一块整卡大缓冲，直接存会把 17MB 全克隆进去 */
        Object.keys(map).forEach(function (n) { v[n] = map[n].slice().buffer; });
        var tx = db.transaction('cards', 'readwrite');
        tx.objectStore('cards').put(v, key);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { res(false); };
      });
    }).catch(function () { return false; });
  }
  function waitBody() {
    return new Promise(function (res) {
      (function poll() { if (document.body) res(); else setTimeout(poll, 60); })();
    });
  }
  /* 面板：与游戏同一副深色等宽脸。跳过后本会话不再纠缠。 */
  function pickOverlay() {
    return waitBody().then(function () {
      return new Promise(function (res) {
        var ov = document.createElement('div');
        ov.id = 'romaPick';
        ov.style.cssText = 'position:fixed;inset:0;z-index:2147483005;background:rgba(6,6,6,.93);'
          + 'display:flex;align-items:center;justify-content:center;padding:20px';
        var bx = document.createElement('div');
        bx.style.cssText = 'max-width:360px;border:1px solid #26262b;background:#0b0b0c;'
          + 'padding:20px 22px;font:12px/1.9 ui-monospace,Menlo,monospace;color:#8b8b93';
        bx.innerHTML =
          '<div style="letter-spacing:.26em;color:#c99b3f;margin-bottom:10px">ARCA · 资材恢复</div>'
          + '<div>导入端在保存这张卡时重编码了 PNG，随卡携带的三维资材块被剥掉了。'
          + '选择你手里的<b style="color:#ececec">原版卡 PNG 文件</b>即可一次性恢复：'
          + '资材会存入浏览器本地库，此后离线可用。跳过则本次以纯文字模式进行。</div>'
          + '<div id="romaPickMsg" style="color:#c0553c;margin-top:8px"></div>'
          + '<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">'
          + '<label style="border:1px solid rgba(201,155,63,.55);color:#c99b3f;padding:8px 14px;'
          + 'cursor:pointer;letter-spacing:.12em">选择卡 PNG'
          + '<input id="romaPickFile" type="file" accept=".png,image/png" style="display:none"></label>'
          + '<button id="romaPickSkip" style="border:1px solid #26262b;background:none;color:#8b8b93;'
          + 'padding:8px 14px;cursor:pointer;font:inherit;letter-spacing:.12em">跳过</button></div>';
        ov.appendChild(bx);
        document.body.appendChild(ov);
        function bye(v) { try { ov.remove(); } catch (_) { } res(v); }
        bx.querySelector('#romaPickSkip').onclick = function () { bye(false); };
        bx.querySelector('#romaPickFile').onchange = function () {
          var f = this.files && this.files[0];
          if (!f) return;
          var say = bx.querySelector('#romaPickMsg');
          say.textContent = '解析中…'; say.style.color = '#8b8b93';
          f.arrayBuffer().then(function (ab) {
            var m = parsePngChunks(ab);
            /* 引擎文件名两条线相同——只验引擎会把罗马卡认成埃及资材，旧引擎照样
               混进来（选开局就炸）。mapOk 连清单资材与线号造牌一起验。 */
            if (!m || !mapOk(m)) {
              say.style.color = '#c0553c';
              say.textContent = m ? '这张 PNG 不带「本卡」的全套资材块——两条线的卡不通用，请选本卡的标准版或完全版原文件。'
                                  : '这张 PNG 里没有资材块（可能是超低配卡或普通图片）。';
              return;
            }
            /* map 的视图指向 ab；ab 是本函数私有的完整拷贝，可长期持有 */
            bye(m);
          }).catch(function (e) { say.style.color = '#c0553c'; say.textContent = '读文件失败：' + e; });
        };
      });
    });
  }
  function pickFlow() {
    var skip = false;
    try { skip = sessionStorage.getItem('roma_pick_skip') === '1'; } catch (_) { }
    if (skip) { PNGA = false; return Promise.resolve(false); }
    return pickOverlay().then(function (m) {
      if (m) {
        idbSave(cardKey(), m).then(function (ok) { log(ok ? '资材已入本地库，下次直接取用' : '本地库写入失败（本次仍可用）'); });
        log('资材已从玩家所选 PNG 恢复：' + Object.keys(m).length + ' 项');
        PNGA = m; return m;
      }
      try { sessionStorage.setItem('roma_pick_skip', '1'); } catch (_) { }
      log('玩家跳过资材恢复，本次纯文字');
      PNGA = false; return false;
    });
  }
  var PNGERR = '';                     /* 最后一次取块失败的实话，报错时带出去 */
  function pngAssets() {
    if (PNGA === false) return Promise.resolve(false);
    if (PNGA) return PNGA.then ? PNGA : Promise.resolve(PNGA);
    if (!CFG.pngAssets) { PNGA = false; return Promise.resolve(false); }
    var urls = avatarUrls();
    /* 本文档是 srcdoc，它的 location.origin 报的是 null；从这里发往酒馆的请求
       浏览器按跨源处理，cookie 不带、CORS 也可能拦——带密码的酒馆会把
       /characters/ 挡在 401 外面，块就取不到了。改用主窗自己的 fetch：
       那边是货真价实的同源，凭据照常带上。主窗够不着时退回本窗。 */
    var s = stCtx(), F = fetch;
    try { if (s && s.top.fetch) F = s.top.fetch.bind(s.top); } catch (_) { }
    var errs = urls.length ? [] : ['认不出本卡在酒馆里的头像文件'];
    function step(i) {
      if (i >= urls.length) {
        PNGERR = errs.join('；');
        log('PNG 数据块取数失败：' + PNGERR);
        /* 头像上拿不到（官方酒馆导入必然重编码剥块）：先查本地库，再请玩家自救 */
        return idbLoad(cardKey()).then(function (saved) {
          if (saved && mapOk(saved)) {
            log('资材已从本地库接上：' + Object.keys(saved).length + ' 项');
            PNGA = saved; return saved;
          }
          if (saved) log('本地库存的块表与本卡对不上（旧版/残缺），重新请玩家恢复');
          return pickFlow();
        });
      }
      return F(urls[i], { credentials: 'include' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      }).then(function (ab) {
        var m = parsePngChunks(ab);
        if (!m) throw new Error('里面没有 roMa 私有块（导入端可能把它剥了）');
        if (!mapOk(m)) throw new Error('roMa 块不全（部分被剥或截断），弃用');
        PNGA = m;
        log('PNG 数据块已接上：' + Object.keys(m).length + ' 项', urls[i]);
        return m;
      }).catch(function (e) {
        errs.push(urls[i] + ' → ' + String(e && e.message || e));
        return step(i + 1);
      });
    }
    PNGA = Promise.resolve().then(function () { return step(0); });
    return PNGA;
  }
  function gunzipBytes(u8) {
    return new Response(new Blob([u8]).stream()
      .pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }

  /* ---------------------------------------------------------------- 资材 --- */
  function xor(u8) {
    var kl = KEY.length;
    for (var i = 0; i < u8.length; i++) u8[i] ^= (KEY.charCodeAt(i % kl) + ((i * 7) & 0xff)) & 0xff;
    return u8;
  }
  function unpack(u) {
    var dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    var n = dv.getUint32(4, true), off = 8, metas = [], dec = new TextDecoder();
    for (var j = 0; j < n; j++) {
      var nl = dv.getUint16(off, true); off += 2;
      var name = dec.decode(u.subarray(off, off + nl)); off += nl;
      var len = dv.getUint32(off, true); off += 4;
      metas.push([name, len]);
    }
    var out = [];
    metas.forEach(function (m) { out.push([m[0], u.subarray(off, off + m[1])]); off += m[1]; });
    return out;
  }
  function repack(pairs) {
    var enc = new TextEncoder(), heads = [], hl = 8, bl = 0;
    pairs.forEach(function (p) {
      var nb = enc.encode(p[0]); heads.push(nb); hl += 2 + nb.length + 4; bl += p[1].length;
    });
    var out = new Uint8Array(hl + bl), dv = new DataView(out.buffer);
    out[0] = 90; out[1] = 74; out[2] = 80; out[3] = 49;          /* 'ZJP1' */
    dv.setUint32(4, pairs.length, true);
    var o = 8;
    pairs.forEach(function (p, i) {
      dv.setUint16(o, heads[i].length, true); o += 2;
      out.set(heads[i], o); o += heads[i].length;
      dv.setUint32(o, p[1].length, true); o += 4;
    });
    pairs.forEach(function (p) { out.set(p[1], o); o += p[1].length; });
    return out;
  }
  /* 网络兜底要限时：墙内对 jsDelivr 常常是「连上了不回包」，
     不设超时就永远转圈，玩家只看到三维加载不动。15 秒放弃并报清楚。 */
  function netChunk(name, file) {
    if (!NET) {
      /* 中原包只随完全版卡走：标准卡缺它是设计使然，不是导入事故，
         也没有任何「恢复」能把它变出来——照实说，别指错路。 */
      if (name === 'zhou' || file === 'zhou.dat')
        return Promise.reject(new Error('中原城池包只随完全版角色卡走，本卡未携带，'
          + '相关三维在本卡中不可用（不影响本线玩法）。'));
      return Promise.reject(new Error('资材 ' + file + ' 只随角色卡走（本线未发布 CDN，网上同名文件是旧版罗马货），'
        + '这次没能从卡里读出来。'
        + (CFG.pngAssets ? '关闭并重开酒馆页签（或重启酒馆应用）后进入游戏，会再次弹出'
          + '「资材恢复」面板——把原版卡 PNG 文件选一次即可恢复，无需重新导卡。'
          : '请重新导入完整的原版角色卡 PNG 文件本体。')));
    }
    var ac = window.AbortController ? new AbortController() : null;
    var tm = ac ? setTimeout(function () { ac.abort(); }, 15000) : null;
    return fetch(BASE + PACKS.dir + file, ac ? { signal: ac.signal } : {})
      .then(function (r) {
        if (tm) clearTimeout(tm);
        if (!r.ok) throw new Error('chunk ' + name + ' HTTP ' + r.status);
        return r.arrayBuffer();
      }, function (err) {
        if (tm) clearTimeout(tm);
        throw new Error('资材 ' + file + ' 网络取数失败（' +
          (err && err.name === 'AbortError' ? '15 秒超时，可能被墙' : String(err && err.message || err)) +
          '）。此部分三维需要能访问 cdn.jsdelivr.net，或改用完全版角色卡。');
      });
  }
  /* 一块压缩包 → 明文条目。去异或 → gunzip → unpack */
  function takeChunk(name) {
    var file = PACKS.chunks[name].file;
    var e = embed();
    var got;
    if (e && e.packs && e.packs[file]) {
      got = b64bytes(e.packs[file]);
    } else if (CFG.pngAssets) {
      /* PNG 块优先；块被剥了再走下面的 CDN 路（把自己重新调一遍，此时 PNGA=false） */
      got = pngAssets().then(function (m) {
        if (m && m['pack/' + file]) { var u = m['pack/' + file]; return u.slice().buffer; }
        return netChunk(name, file);
      });
    } else {
      got = netChunk(name, file);
    }
    return got.then(function (ab) {
      var plain = xor(new Uint8Array(ab));
      return new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }).then(function (buf) { return unpack(new Uint8Array(buf)); });
  }
  /* 把若干块拼回「原档那一份」：条目顺序照原档，再异或回去，引擎照旧解 */
  function assemble(groups, order) {
    return Promise.all(groups.map(takeChunk)).then(function (lists) {
      var by = {};
      lists.forEach(function (l) { l.forEach(function (p) { by[p[0]] = p[1]; }); });
      var pairs = order.filter(function (n) { return by[n]; }).map(function (n) { return [n, by[n]]; });
      Object.keys(by).forEach(function (n) {
        if (order.indexOf(n) < 0) pairs.push([n, by[n]]);
      });
      return xor(repack(pairs));
    });
  }

  /* ------------------------------------------------- 引擎脚本 · 卡内直供 ---
     游戏用 <script src> 动态加载 three 与两个三维引擎，标签一插入就开始网络请求，
     fetch 拦截够不着。做法：包一层 appendChild/insertBefore——命中清单的脚本先扣下，
     等嵌入内容 gunzip 成 blob URL 再放行（按扣下顺序放行，加载次序不变）。
     嵌入缺席时原样放行走 CDN，两条路都通。 */
  (function () {
    var MAP = {};        /* basename -> blob URL（就绪后填入） */
    var READY = false, QUEUE = [], NOENG = false;   /* NOENG=资材没到手且本线无网可兜 */
    function base(u) { return String(u || '').split('?')[0].split('/').pop(); }
    function engNames() {
      var e = embed();
      if (e && e.engines && Object.keys(e.engines).length) return Object.keys(e.engines);
      if (CFG.pngAssets && CFG.engs) return CFG.engs.slice();
      return [];
    }
    function toBlobUrl(ab) {
      return new Response(new Blob([ab]).stream()
        .pipeThrough(new DecompressionStream('gzip'))).blob().then(function (bl) {
          return URL.createObjectURL(new Blob([bl], { type: 'text/javascript' }));
        });
    }
    function prep() {
      var e = embed();
      if (e && e.engines && Object.keys(e.engines).length) {
        var names = Object.keys(e.engines);
        Promise.all(names.map(function (n) {
          return b64bytes(e.engines[n]).then(toBlobUrl).then(function (u) { MAP[n] = u; });
        })).then(function () { READY = true; log('引擎已从卡内就位', names); flush(); })
          .catch(function (err) {
            if (!NET) { NOENG = true; log('嵌入引擎解压失败，本线无网可兜，纯文字降级', String(err)); }
            else log('嵌入引擎解压失败，回退 CDN', String(err));
            READY = true; flush();
          });
        return;
      }
      if (CFG.pngAssets && CFG.engs) {
        pngAssets().then(function (m) {
          if (!m) {
            /* 块没到手（玩家跳过了恢复，或压根认不出卡）。罗马线放行走 CDN；
               其他线的 CDN 是同名旧引擎——换成空脚本，干净地按纯文字跑。 */
            if (!NET) { NOENG = true; log('资材未恢复：引擎以空脚本放行，本次纯文字（三维不加载旧引擎）'); }
            READY = true; flush(); return;
          }
          return Promise.all(CFG.engs.map(function (n) {
            var d = m['eng/' + n + '.gz'];
            if (!d) return null;
            return toBlobUrl(d.slice().buffer).then(function (u) { MAP[n] = u; });
          })).then(function () { READY = true; log('引擎已从 PNG 块就位', CFG.engs); flush(); });
        }).catch(function (err) {
          if (!NET) { NOENG = true; log('PNG 块引擎解压失败，本线无网可兜，纯文字降级', String(err)); }
          else log('PNG 块引擎解压失败，回退 CDN', String(err));
          READY = true; flush();
        });
        return;
      }
      READY = true; flush();
    }
    function flush() {
      while (QUEUE.length) {
        var q = QUEUE.shift();
        var b = base(q.node.src);
        if (MAP[b]) q.node.src = MAP[b];
        else if ((NOENG || !NET) && CFG.engs && CFG.engs.indexOf(b) >= 0) q.node.src = emptyJs();
        q.insert();
      }
    }
    /* 超低配：引擎脚本一律换成空脚本——不联网、不解压、不初始化。
       MED3D/ZJ3D 从未定义，游戏各处的判空分支自会把三维整层跳过。 */
    var EMPTY_JS = null;
    function emptyJs() {
      if (!EMPTY_JS) EMPTY_JS = URL.createObjectURL(new Blob([''], { type: 'text/javascript' }));
      return EMPTY_JS;
    }
    function wrap(proto, fn) {
      var orig = proto[fn];
      proto[fn] = function (node) {
        var args = arguments;
        try {
          if (node && node.tagName === 'SCRIPT' && node.src) {
            var b = base(node.src);
            if (CFG.no3d && CFG.engs && CFG.engs.indexOf(b) >= 0) {
              node.src = emptyJs();
              return orig.apply(this, args);
            }
            if (engNames().indexOf(b) >= 0) {
              if (!READY) {
                var self = this;
                QUEUE.push({ node: node, insert: function () { orig.apply(self, args); } });
                return node;
              }
              if (MAP[b]) node.src = MAP[b];
              else if (NOENG || !NET) node.src = emptyJs();
            }
          }
        } catch (_) { }
        return orig.apply(this, args);
      };
    }
    wrap(Node.prototype, 'appendChild');
    wrap(Node.prototype, 'insertBefore');
    prep();
  })();

  /* ---------------------------------------------------------------- 神谕 --- */
  var seq = 0;
  function sse(obj) { return 'data: ' + JSON.stringify(obj) + '\n\n'; }

  function oracle(body, signal) {
    var TH = helper();
    if (!TH || !TH.generateRaw) throw new Error('酒馆助手未就位');
    var gid = 'roma-' + (Date.now().toString(36)) + '-' + (++seq);
    var prompts = (body.messages || []).map(function (m) {
      return { role: (m.role === 'assistant' ? 'assistant' : (m.role === 'system' ? 'system' : 'user')), content: String(m.content == null ? '' : m.content) };
    });
    var cfg = {
      generation_id: gid,
      should_stream: !!body.stream,
      should_silence: true,
      /* 只给 ordered_prompts、不带任何占位符：酒馆一个字都不会往里加，
         发出去的就是应用自己拼好的那份提示词。换了后端而提示词不变，
         「一模一样」才谈得上。 */
      ordered_prompts: prompts,
    };
    /* 只把「怎么发起」交出去，不在这里发。监听器必须先挂上：
       generateRaw 一调用就可能同步吐出第一个增量，那时若还没挂监听，
       开头几个字直接丢掉——正文会莫名其妙缺一小截。 */
    return { gid: gid, cfg: cfg, signal: signal, th: TH,
             start: function () { return TH.generateRaw(cfg); } };
  }

  function streamResponse(job) {
    var enc = new TextEncoder(), closed = false, offs = [], gotAny = false;
    var EV = events(), IEV = ievents();
    var stream = new ReadableStream({
      start: function (ctl) {
        function push(s) { if (!closed) try { ctl.enqueue(enc.encode(s)); } catch (_) { } }
        function done() {
          if (closed) return;
          push('data: [DONE]\n\n'); closed = true;
          offs.forEach(function (f) { try { f(); } catch (_) { } });
          try { ctl.close(); } catch (_) { }
        }
        function onInc(text, gid) {
          if (gid !== job.gid) return;                 /* 并发的辅助请求各认各的 */
          gotAny = true;
          push(sse({ choices: [{ delta: { content: text }, index: 0 }] }));
        }
        function onEnd(_text, gid) { if (gid === job.gid) done(); }
        if (EV && EV.on) {
          EV.on(IEV.STREAM_TOKEN_RECEIVED_INCREMENTALLY, onInc);
          EV.on(IEV.GENERATION_ENDED, onEnd);
          offs.push(function () {
            EV.off(IEV.STREAM_TOKEN_RECEIVED_INCREMENTALLY, onInc);
            EV.off(IEV.GENERATION_ENDED, onEnd);
          });
        }
        if (job.signal) job.signal.addEventListener('abort', function () {
          try { job.th.stopGeneration && job.th.stopGeneration(); } catch (_) { }
          if (!closed) { closed = true; offs.forEach(function (f) { try { f(); } catch (_) { } }); try { ctl.error(new DOMException('Aborted', 'AbortError')); } catch (_) { } }
        });
        /* 监听挂好了，现在才发起 */
        var run;
        try { run = job.start(); } catch (e) { try { ctl.error(e); } catch (_) { } return; }
        run.then(function (full) {
          /* 一个增量都没收到（没有事件系统，或后端根本不流式）时兜底：
             把整段当一个 delta 发出去。不能省——应用的空闲看门狗只认「有没有出字」。 */
          if (!closed && !gotAny) push(sse({ choices: [{ delta: { content: String(full || '') }, index: 0 }] }));
          done();
        }, function (e) {
          if (closed) return; closed = true;
          offs.forEach(function (f) { try { f(); } catch (_) { } });
          try { ctl.error(e instanceof Error ? e : new Error(String(e))); } catch (_) { }
        });
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }

  function wholeResponse(job) {
    return job.start().then(function (full) {
      return new Response(JSON.stringify({
        id: job.gid, object: 'chat.completion', created: Math.floor(Date.now() / 1000),
        choices: [{ index: 0, message: { role: 'assistant', content: String(full || '') }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
  }

  /* ------------------------------------------------------------ 拦截点 --- */
  var _fetch = window.fetch.bind(window);
  window.__ROMA_RAWFETCH__ = _fetch;      /* 未经拦截的原样取——自检用 */
  window.fetch = function (input, init) {
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    init = init || {};

    /* 1) 神谕 */
    if (/\/chat\/completions(\?|$)/.test(url)) {
      var body = {};
      try { body = JSON.parse((typeof input !== 'string' && input.body) ? input.body : init.body); } catch (_) { }
      var signal = init.signal || (typeof input !== 'string' && input.signal) || null;
      var job;
      try { job = oracle(body, signal); } catch (e) { return Promise.reject(e); }
      try { return body.stream ? Promise.resolve(streamResponse(job)) : wholeResponse(job); }
      catch (e) { return Promise.reject(e); }
    }

    /* 1.5) BGM：卡版不带音乐。47 首 138MB 既进不了卡，墙内取 CDN 又必挂——
       bgmSrc 走的就是这里的 fetch，凡 idx/v1 下不属于三维资材映射的 .dat
       一律就地 404，一个字节也不上网。中原城池包（东征幕用）不在映射里，放行走网络。 */
    var mBgm = url.match(/core\/res\/data\/idx\/v1\/([0-9a-f]+\.dat)/);
    /* 超低配：三维资材（连同 BGM）一律就地 404——引擎本就没装，这里只是把
       任何漏网的 .dat 请求也拦死，保证一个字节不上网、一毫秒不空等。 */
    if (mBgm && CFG.no3d) {
      return Promise.resolve(new Response(null, { status: 404, statusText: 'no3d build' }));
    }
    /* 映射键带 idx/v1/ 前缀，这里拿到的是裸文件名——必须两种形态都查。
       之前只查裸名，查不到就把三维资材包也当 BGM 给 404 了：三维全灭。 */
    if (mBgm && PACKS && !PACKS.map[mBgm[1]] && !PACKS.map['idx/v1/' + mBgm[1]]) {
      return Promise.resolve(new Response(null, { status: 404, statusText: 'bgm absent in card' }));
    }

    /* 1.6) 现代城市粒子沙盘（modern.dat，明 gzip 无异或）：嵌入 → PNG 块 → 网络。
       超低配连三维面板都没有，这里直接 404 断网。 */
    if (url.indexOf('core/res/data/st/v1/modern.dat') >= 0) {
      if (CFG.no3d)
        return Promise.resolve(new Response(null, { status: 404, statusText: 'no3d build' }));
      var eM = embed();
      if (eM && eM.packs && eM.packs['modern.dat'])
        return b64bytes(eM.packs['modern.dat']).then(function (ab) { return new Response(ab); });
      if (CFG.pngAssets)
        return pngAssets().then(function (m) {
          if (m && m['pack/modern.dat'])
            return new Response(m['pack/modern.dat'].slice().buffer,
              { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
          /* 块没取到就只剩网络，而任何线的 CDN 上都没有这份资材（它只随卡走）。
             与其让沙盘那边收到一个光秃秃的 404，不如把真正的原因和自救路交出去：
             艳后线进场第一眼就是现代城沙盘，这里一哑，开局看着就是卡死。 */
          if (!NET) {
            throw new Error('粒子沙盘资材（modern.dat）只随角色卡走，这次没能从卡里读出来（'
              + (PNGERR || '卡内资材块缺席') + '）。'
              + (CFG.pngAssets ? '关闭并重开酒馆页签（或重启酒馆应用）后进入游戏，会再次弹出'
                + '「资材恢复」面板——把原版卡 PNG 文件选一次即可恢复；'
                : '请重新导入完整的原版角色卡 PNG 文件本体；')
              + '经过压缩、转存或改过格式的图片会丢掉卡内资材。');
          }
          return _fetch(input, init).then(function (r) {
            if (r.ok) return r;
            throw new Error('粒子沙盘资材（modern.dat）只存在角色卡里，这次没能从卡里读出来（'
              + (PNGERR || 'HTTP ' + r.status) + '）。请重新导入完整的角色卡 PNG 文件本体——'
              + '经过压缩、转存或改过格式的图片会丢掉卡内资材。');
          }, function () {
            throw new Error('粒子沙盘资材（modern.dat）只存在角色卡里，这次没能从卡里读出来（'
              + (PNGERR || '网络也取不到') + '）。请重新导入完整的角色卡 PNG 文件本体。');
          });
        });
    }

    /* 2) 资材整包 → 压缩块拼回 */
    if (PACKS) {
      var hit = null;
      Object.keys(PACKS.map).forEach(function (frag) { if (url.indexOf(frag) >= 0) hit = PACKS.map[frag]; });
      if (hit) {
        return assemble(hit.chunks, hit.order).then(function (u8) {
          return new Response(u8, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
        });
      }
    }

    return _fetch(input, init);
  };

  /* ------------------------------------------------------------ 接线 --- */
  /* 应用启动时从 localStorage['rome_api'] 读接口配置，apiReady() 只看三项非空。
     所以不必去够 IIFE 里的 API 对象——本文件跑在应用脚本之前，先把值写进存储即可，
     应用一行都不用改。base 里那个 /chat/completions 正好是上面拦截的那条路径。
     真正的地址、密钥、模型由酒馆那边的设置决定，这三个占位值永远不会被发出去。 */
  try {
    var cur = {};
    try { cur = JSON.parse(localStorage.getItem('rome_api') || '{}'); } catch (_) { }
    cur.base = 'https://tavern.helper.local/v1';
    cur.key = 'tavern-helper';
    cur.model = (CFG.model || 'tavern-helper');
    localStorage.setItem('rome_api', JSON.stringify(cur));
  } catch (e) { log('接线失败', e && e.message); }

  log('垫片就位', { base: BASE, helper: !!helper(), packs: !!PACKS });
})();
