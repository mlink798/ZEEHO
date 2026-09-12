/*
#!name=极核 ZEEHO 签到面板 LITE V2.13
#!desc=极核多账号签到面板增强版 V2.13 · 多账号手动排序 / Token失效标红 / 盲盒倒计时 / 一键导出Token / BarkKey配置。数据由代理后端签名获取，本地验证不依赖 Loon。
#!author=lucky

[Script]
# 面板（zeeho.box 本地拦截，浏览器/客户端访问 http://zeeho.box 打开面板）
http-request ^http:\/\/zeeho\.box(\/.*)?$ script-path=zeeho_box_enhanced_lite.js, requires-body=true, timeout=60, tag=极核面板V2.13

[MITM]
hostname = zeeho.box

====================================
⚠️【免责声明】
------------------------------------------
1、此脚本仅用于学习研究，请根据情况自行判断，不保证其合法性、准确性、有效性。
2、请勿将此脚本用于任何商业或非法目的。
3、涉及第三方应用与脚本作者无关。
 */

// ========== 版本信息（每次修改必须同步更新） ==========
const SCRIPT_VERSION = "v2.13.0";     // 脚本版本号
const SCRIPT_VERSION_TAG = "V2.13";   // 面板/接口/导出显示的版本标签
const SCRIPT_VERSION_DATE = "2026-09-12";

// ========== 配置 ==========
const $config = {
  delayMin: 600,        // 单账号请求最小延迟 ms
  delayMax: 1200,       // 单账号请求最大延迟 ms
  batchSize: 2,         // 每批并发账号数（防限流）
  timeout: 15000,       // 请求超时 ms
  apiDomain: "https://api-zeeho.example.com" // ← 改成你的代理后端，需提供 POST /get-userid 与 POST /get-account
};

// 账号列表存储键（[{token, barkKey}]，数组顺序 = 面板显示顺序，排序会持久化）
const KEY_DATA = "zeeho_data";

// ========== 存储抽象（Loon $persistentStore，浏览器回退 localStorage） ==========
const Storage = {
  read(key) {
    try { if (typeof $persistentStore !== "undefined") { const v = $persistentStore.read(key); if (v) return v; } } catch (e) {}
    try { if (typeof localStorage !== "undefined") return localStorage.getItem(key); } catch (e) {}
    return null;
  },
  write(key, val) {
    try { if (typeof $persistentStore !== "undefined") { $persistentStore.write(val, key); return true; } } catch (e) {}
    try { if (typeof localStorage !== "undefined") { localStorage.setItem(key, val); return true; } } catch (e) {}
    return false;
  }
};

// ========== HTTP 请求封装（优先 fetch，Loon 环境回退 $httpClient） ==========
async function httpRequest(method, url, headers, body) {
  if (typeof fetch === "function") {
    const res = await fetch(url, {
      method,
      headers: headers || {},
      body: (body !== null && body !== undefined) ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
    return { status: res.status, json, text };
  }
  if (typeof $httpClient !== "undefined") {
    return new Promise((resolve, reject) => {
      const opts = { url, method, headers: headers || {}, timeout: $config.timeout };
      if (body !== null && body !== undefined) opts.body = JSON.stringify(body);
      const fn = $httpClient[method.toLowerCase()] || $httpClient.get;
      fn.call($httpClient, opts, (err, resp, data) => {
        if (err) return reject(err);
        let json = {};
        try { json = JSON.parse(data || "{}"); } catch (e) { json = { raw: data }; }
        resolve({ status: (resp && resp.status) || 0, json, text: data });
      });
    });
  }
  throw new Error("无可用请求环境 (fetch/$httpClient)");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randDelay() { return Math.floor(Math.random() * ($config.delayMax - $config.delayMin)) + $config.delayMin; }

// Token 的稳定短哈希，作为面板排序/配置的标识 key（不暴露原始 Token）
function hashKey(str) {
  let h = 5381;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return "k" + (h >>> 0).toString(36);
}

// ========== base64 解码（兼容 Node/Browser/Loon） ==========
function b64ToBytes(b64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const map = {};
  for (let i = 0; i < 64; i++) map[chars[i]] = i;
  const clean = String(b64 || "").replace(/[^A-Za-z0-9+/]/g, "");
  const bytes = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = map[clean[i]], c1 = map[clean[i + 1]], c2 = map[clean[i + 2]], c3 = map[clean[i + 3]];
    bytes.push((c0 << 2) | (c1 >> 4));
    if (clean[i + 2] !== undefined) bytes.push(((c1 & 15) << 4) | ((c2 || 0) >> 2));
    if (clean[i + 3] !== undefined) bytes.push(((c2 & 3) << 6) | (c3 || 0));
  }
  return bytes;
}
function utf8Decode(bytes) {
  let out = "", i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    if (b < 0x80) out += String.fromCharCode(b);
    else if (b < 0xE0) out += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i++] & 0x3F));
    else if (b < 0xF0) out += String.fromCharCode(((b & 0x0F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F));
    else {
      const cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F);
      const u = cp - 0x10000;
      out += String.fromCharCode(0xD800 + (u >> 10), 0xDC00 + (u & 0x3FF));
    }
  }
  return out;
}
function decodeB64(b64) {
  try {
    if (typeof Buffer !== "undefined") return Buffer.from(b64, "base64").toString("utf-8");
    if (typeof atob === "function") { try { return decodeURIComponent(escape(atob(b64))); } catch (e) {} }
    return utf8Decode(b64ToBytes(b64));
  } catch (e) {
    console.error("[HTML解码失败]", e);
    return "<html><body><h3>解码失败</h3></body></html>";
  }
}

// ========== 账号数据获取 ==========
function isAuthError(json, status) {
  if (status === 401 || status === 403) return true;
  const code = json && json.code !== undefined ? String(json.code) : "";
  if (code === "40001" || code === "401" || code === "40100" || code === "403") return true;
  const msg = String((json && (json.msg || json.message)) || "");
  return /token|登录|失效|过期|未授权|鉴权/i.test(msg) && code !== "10000";
}

async function getUseridByToken(token) {
  const r = await httpRequest("POST", $config.apiDomain + "/get-userid", { "Content-Type": "application/json" }, { token });
  if (isAuthError(r.json, r.status)) throw { auth: true };
  const d = r.json || {};
  const data = d.data && typeof d.data === "object" ? d.data : d;
  return {
    uid: String(d.userId || d.uid || data.id || data.userId || ""),
    avatarUrl: String(d.headUrl || d.avatar || data.avatar || data.headUrl || "")
  };
}

function invalidAccount(token, errType) {
  const key = hashKey(token);
  return {
    token,
    uid: "", avatarUrl: "",
    name: "账号 " + key.slice(0, 6),
    score: 0, todayScore: 0, continueDays: 0,
    blindNow: 0, blindTotal: 30, blindRemain: 30,
    carCount: 0,
    tokenStatus: false, errType: errType || "auth",
    recent7: []
  };
}

async function fetchAccountData(token) {
  try {
    const uidObj = await getUseridByToken(token);
    if (!uidObj.uid) throw { auth: true };
    await sleep(randDelay());
    const r = await httpRequest("POST", $config.apiDomain + "/get-account", { "Content-Type": "application/json" }, { token, uid: uidObj.uid });
    if (isAuthError(r.json, r.status)) return invalidAccount(token, "auth");
    const d = r.json || {};
    const data = d.data && typeof d.data === "object" ? d.data : d;
    const blindTotal = Number(data.blindTotal || 30);
    const blindNow = Number(data.blindNow || 0);
    const blindRemain = data.blindRemain != null ? Number(data.blindRemain) : Math.max(0, blindTotal - blindNow);
    return {
      token,
      uid: uidObj.uid,
      avatarUrl: uidObj.avatarUrl,
      name: String(data.nickname || data.nickName || data.name || ("用户" + String(uidObj.uid).slice(-4))),
      score: Number(data.score || 0),
      todayScore: Number(data.todayScore || 0),
      continueDays: Number(data.continueDays || 0),
      blindNow, blindTotal, blindRemain,
      carCount: Number(data.carCount || 0),
      tokenStatus: true,
      recent7: Array.isArray(data.recent7) ? data.recent7 : []
    };
  } catch (e) {
    console.error("[账号拉取失败]", String(token).slice(0, 6) + "…", (e && e.message) || e);
    return invalidAccount(token, (e && e.auth) ? "auth" : "net");
  }
}

// 分批并发拉取，避免限流
async function fetchBatch(tokenList) {
  const result = [];
  for (let i = 0; i < tokenList.length; i += $config.batchSize) {
    const slice = tokenList.slice(i, i + $config.batchSize);
    const batch = await Promise.all(slice.map(t => fetchAccountData(t)));
    result.push(...batch);
  }
  return result;
}

// ========== 面板后端 ==========
const Backend = {
  get tokenList() { return this.getTokenList().map(x => x.token); },

  getTokenList() {
    try {
      const raw = Storage.read(KEY_DATA);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr.filter(x => x && x.token);
      }
    } catch (e) { console.error("[读取账号列表失败]", e); }
    return [];
  },

  saveTokenList(list) { Storage.write(KEY_DATA, JSON.stringify(list)); },

  // 面板数据：按存储顺序返回，去掉 token，附加 key / barkKey
  async getDashboard() {
    const list = this.getTokenList();
    const accounts = await fetchBatch(list.map(x => x.token));
    const barkMap = {};
    list.forEach(x => { barkMap[hashKey(x.token)] = x.barkKey || ""; });
    return accounts.map(a => {
      const key = hashKey(a.token);
      const out = Object.assign({}, a);
      delete out.token;
      out.key = key;
      out.barkKey = barkMap[key] || "";
      return out;
    });
  },

  // 多账号手动排序：按面板传来的 key 顺序重排存储（缺失的账号自动补到末尾）
  saveSort(keys) {
    const list = this.getTokenList();
    const map = {};
    list.forEach(x => { map[hashKey(x.token)] = x; });
    const seen = {};
    const ordered = (keys || [])
      .map(k => { const it = map[k]; if (it) { seen[hashKey(it.token)] = true; return it; } return null; })
      .filter(Boolean);
    list.forEach(x => { const k = hashKey(x.token); if (!seen[k]) ordered.push(x); });
    this.saveTokenList(ordered);
    return true;
  },

  // 保存单个账号的 BarkKey
  saveBark(key, barkKey) {
    const list = this.getTokenList();
    let hit = false;
    list.forEach(x => { if (hashKey(x.token) === key) { x.barkKey = barkKey || ""; hit = true; } });
    if (hit) this.saveTokenList(list);
    return hit;
  },

  // 一键导出全部账号 Token / BarkKey
  async exportTokens() {
    const accounts = await this.getDashboard();
    const list = this.getTokenList();
    const tokenMap = {};
    list.forEach(x => { tokenMap[hashKey(x.token)] = x.token; });
    const lines = [];
    lines.push("极核 ZEEHO 账号 Token 导出");
    lines.push("版本: " + SCRIPT_VERSION_TAG + " · 生成时间: " + new Date().toLocaleString("zh-CN"));
    lines.push("共 " + accounts.length + " 个账号");
    lines.push("----------------------------------------");
    accounts.forEach((a, i) => {
      lines.push((i + 1) + ". " + (a.name || "未知账号") + (a.uid ? " (UID: " + a.uid + ")" : "") + (a.tokenStatus ? "" : " [Token失效]"));
      lines.push("   Token: " + (tokenMap[a.key] || ""));
      if (a.barkKey) lines.push("   BarkKey: " + a.barkKey);
    });
    return lines.join("\n");
  },

  // 测试 BarkKey 推送
  async testBark(key) {
    const list = this.getTokenList();
    const item = list.find(x => hashKey(x.token) === key);
    if (!item) return { ok: false, msg: "账号不存在" };
    if (!item.barkKey) return { ok: false, msg: "未配置 BarkKey" };
    try {
      const url = "https://api.day.app/" + item.barkKey + "/" +
        encodeURIComponent("极核ZEEHO测试") + "/" +
        encodeURIComponent("面板推送测试成功 (" + SCRIPT_VERSION_TAG + ")") + "?group=zeeho_panel";
      const r = await httpRequest("GET", url, {}, null);
      const ok = r.status >= 200 && r.status < 300;
      return { ok, msg: ok ? "推送成功" : "推送失败 code=" + r.status };
    } catch (e) {
      return { ok: false, msg: "推送失败 " + String((e && e.message) || e) };
    }
  }
};

// ========== 内嵌面板 HTML（base64，构建时由 index.html 生成注入） ==========
const panelHtmlB64 = "PCFET0NUWVBFIGh0bWw+CjxodG1sIGxhbmc9InpoLUNOIj4KPGhlYWQ+CjxtZXRhIGNoYXJzZXQ9IlVURi04IiAvPgo8bWV0YSBuYW1lPSJ2aWV3cG9ydCIgY29udGVudD0id2lkdGg9ZGV2aWNlLXdpZHRoLCBpbml0aWFsLXNjYWxlPTEuMCIvPgo8dGl0bGU+5p6B5qC4IFpFRUhPIExJVEUg5aKe5by654mIIFYyLjEzPC90aXRsZT4KPHN0eWxlPgoqe2JveC1zaXppbmc6Ym9yZGVyLWJveDttYXJnaW46MDtwYWRkaW5nOjA7Zm9udC1mYW1pbHk6LWFwcGxlLXN5c3RlbSxCbGlua01hY1N5c3RlbUZvbnQsIlNlZ29lIFVJIiwiUGluZ0ZhbmcgU0MiLHNhbnMtc2VyaWZ9CmJvZHl7YmFja2dyb3VuZDojMGIxNDIyO2NvbG9yOiNlOGVkZjM7cGFkZGluZzoxNnB4O21pbi1oZWlnaHQ6MTAwdmg7cGFkZGluZy1ib3R0b206ODVweH0KLmhlYWRlcntkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMnB4O21hcmdpbi1ib3R0b206MjBweH0KLmxvZ297d2lkdGg6NTJweDtoZWlnaHQ6NTJweDtib3JkZXItcmFkaXVzOjE2cHg7YmFja2dyb3VuZDojMjNjNmRlO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmb250LXdlaWdodDpib2xkO2ZvbnQtc2l6ZToyNHB4O2NvbG9yOiMwYjE0MjI7ZmxleC1zaHJpbms6MH0KLnRpdGxlLWdyb3VwIGgxe2ZvbnQtc2l6ZToyMXB4O2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7ZmxleC13cmFwOndyYXA7Z2FwOjZweH0KLmJhZGdlLWxpdGV7YmFja2dyb3VuZDojMTQ0OTU3O2NvbG9yOiMzN2QwZTg7Zm9udC1zaXplOjEycHg7cGFkZGluZzoycHggOHB4O2JvcmRlci1yYWRpdXM6MTJweH0KLnN1YnRpdGxle2ZvbnQtc2l6ZToxM3B4O2NvbG9yOiM5OWE4Yjg7bWFyZ2luLXRvcDoycHh9Ci5yZWZyZXNoLWljb257bWFyZ2luLWxlZnQ6YXV0bzt3aWR0aDo0NHB4O2hlaWdodDo0NHB4O2JvcmRlci1yYWRpdXM6MTJweDtiYWNrZ3JvdW5kOiMxYzI5M2I7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2N1cnNvcjpwb2ludGVyO2ZvbnQtc2l6ZToyMHB4O2ZsZXgtc2hyaW5rOjB9Ci5wYW5lbC1kZXNje2JhY2tncm91bmQ6IzJjMmMyNDtjb2xvcjojZmZkZDc3O3BhZGRpbmc6MTBweCAxNHB4O2JvcmRlci1yYWRpdXM6MTBweDttYXJnaW4tYm90dG9tOjE4cHg7Zm9udC1zaXplOjE0cHh9Ci5iaWctY2FyZHtiYWNrZ3JvdW5kOiMxNzI0MzY7Ym9yZGVyLXJhZGl1czoxOHB4O3BhZGRpbmc6MjBweDttYXJnaW4tYm90dG9tOjE2cHg7Ym9yZGVyOjFweCBzb2xpZCB0cmFuc3BhcmVudH0KLmJpZy1jYXJkLmNhcmQtaW52YWxpZHtib3JkZXItY29sb3I6I2ZmNTQ3MH0KLnN0YXQtcm93e2Rpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6MWZyIDFmcjtnYXA6MTJweDttYXJnaW46MTZweCAwfQouc3RhdC1jYXJke2JhY2tncm91bmQ6IzE3MjQzNjtib3JkZXItcmFkaXVzOjE0cHg7cGFkZGluZzoxNnB4fQouc3RhdC1udW17Zm9udC1zaXplOjMycHg7Zm9udC13ZWlnaHQ6Ym9sZDtjb2xvcjojMzdkMGU4fQouc3RhdC1sYWJlbHtmb250LXNpemU6MTNweDtjb2xvcjojOTlhOGI4O21hcmdpbi10b3A6NHB4fQouYWNjb3VudC1oZWFkZXJ7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTJweDttYXJnaW4tYm90dG9tOjE0cHh9Ci5hdmF0YXItYm94e3dpZHRoOjQ4cHg7aGVpZ2h0OjQ4cHg7Ym9yZGVyLXJhZGl1czoxMnB4O2JhY2tncm91bmQ6IzIzYzZkZTtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7Zm9udC1zaXplOjIycHg7Zm9udC13ZWlnaHQ6Ym9sZDtjb2xvcjojMGIxNDIyO292ZXJmbG93OmhpZGRlbjtmbGV4LXNocmluazowfQouYXZhdGFyLWJveCBpbWd7d2lkdGg6MTAwJTtoZWlnaHQ6MTAwJTtvYmplY3QtZml0OmNvdmVyfQoubmFtZS1pZHttaW4td2lkdGg6MDtmbGV4OjF9Ci5uYW1lLWlkIGgze2ZvbnQtc2l6ZToxOHB4O292ZXJmbG93OmhpZGRlbjt0ZXh0LW92ZXJmbG93OmVsbGlwc2lzO3doaXRlLXNwYWNlOm5vd3JhcH0KLm5hbWUtaWQgLnVpZHtmb250LXNpemU6MTJweDtjb2xvcjojOTlhOGI4O21hcmdpbi10b3A6MnB4O292ZXJmbG93OmhpZGRlbjt0ZXh0LW92ZXJmbG93OmVsbGlwc2lzO3doaXRlLXNwYWNlOm5vd3JhcH0KLm5hbWUtaW52YWxpZCBoM3tjb2xvcjojZmY1NDcwfQoudGFnLWdyb3Vwe2Rpc3BsYXk6ZmxleDtnYXA6NnB4O2ZsZXgtd3JhcDp3cmFwO2p1c3RpZnktY29udGVudDpmbGV4LWVuZDtmbGV4LXNocmluazowfQoudGFne3BhZGRpbmc6NHB4IDEwcHg7Ym9yZGVyLXJhZGl1czoyMHB4O2ZvbnQtc2l6ZToxMnB4O3doaXRlLXNwYWNlOm5vd3JhcH0KLnRhZy1ncmVlbntiYWNrZ3JvdW5kOiMxOTRjNDc7Y29sb3I6IzQyZTI5OX0KLnRhZy1ibHVle2JhY2tncm91bmQ6IzE2NDQ1ODtjb2xvcjojMzdkMGU4fQoudGFnLXJlZHtiYWNrZ3JvdW5kOiM0ZDFkMjg7Y29sb3I6I2ZmNmI4Mn0KLnRhZy1vcmFuZ2V7YmFja2dyb3VuZDojNGQzYTFkO2NvbG9yOiNmZmI0NTR9Ci50YWctZ3JleXtiYWNrZ3JvdW5kOiMyYTMzNDI7Y29sb3I6IzhhOTlhYX0KLnNvcnQtYnRuc3tkaXNwbGF5OmZsZXg7Z2FwOjZweDtmbGV4LXNocmluazowfQouc29ydC1idG57d2lkdGg6MzRweDtoZWlnaHQ6MzRweDtib3JkZXItcmFkaXVzOjEwcHg7YmFja2dyb3VuZDojMWMyOTNiO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTZweDtjb2xvcjojYzVkMmUyO3VzZXItc2VsZWN0Om5vbmV9Ci5zb3J0LWJ0bjphY3RpdmV7YmFja2dyb3VuZDojMmEzYTUyfQouc29ydC1idG4uZGlzYWJsZWR7b3BhY2l0eTouMztwb2ludGVyLWV2ZW50czpub25lfQoubnVtLWdyaWR7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoNCwxZnIpO2dhcDoxMHB4O21hcmdpbi1ib3R0b206MTRweH0KLm51bS1pdGVte2JhY2tncm91bmQ6IzFmMmY0NDtwYWRkaW5nOjEycHggNnB4O2JvcmRlci1yYWRpdXM6MTJweDt0ZXh0LWFsaWduOmNlbnRlcn0KLm51bS12YWx7Zm9udC1zaXplOjIycHg7Zm9udC13ZWlnaHQ6Ym9sZH0KLm51bS1kZXNje2ZvbnQtc2l6ZToxMXB4O2NvbG9yOiM5OWE4Yjg7bWFyZ2luLXRvcDozcHh9Ci5wcm9ncmVzcy13cmFwe21hcmdpbi1ib3R0b206MTJweH0KLnByb2dyZXNzLXRpdGxle2ZvbnQtc2l6ZToxNHB4O21hcmdpbi1ib3R0b206NnB4O2Rpc3BsYXk6ZmxleDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjthbGlnbi1pdGVtczpjZW50ZXJ9Ci5wcm9ncmVzcy1iYXJ7d2lkdGg6MTAwJTtoZWlnaHQ6MTJweDtiYWNrZ3JvdW5kOiMyODM5NTA7Ym9yZGVyLXJhZGl1czo5OTlweDtvdmVyZmxvdzpoaWRkZW59Ci5wcm9ncmVzcy1maWxse2hlaWdodDoxMDAlO2JhY2tncm91bmQ6I2E4N2JmZjtib3JkZXItcmFkaXVzOjk5OXB4O3RyYW5zaXRpb246d2lkdGggLjNzfQouY291bnRkb3duLWxpbmV7Zm9udC1zaXplOjEzcHg7bWFyZ2luOjEwcHggMDtwYWRkaW5nOjhweCAxMnB4O2JvcmRlci1yYWRpdXM6MTBweDtiYWNrZ3JvdW5kOiMxZjJmNDQ7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OHB4fQouY291bnRkb3duLWxpbmUgLmNkLXZhbHtmb250LXdlaWdodDpib2xkO2NvbG9yOiNmZmQxNjY7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zfQouY291bnRkb3duLWxpbmUucmVhZHl7YmFja2dyb3VuZDojMTk0YzQ3O2NvbG9yOiM0MmUyOTl9Ci5jYWxlbmRhci1yb3d7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoNywxZnIpO2dhcDo4cHh9Ci5jLWRheXthc3BlY3QtcmF0aW86MS8xO2JhY2tncm91bmQ6IzFmMmY0NDtib3JkZXItcmFkaXVzOjEwcHg7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmb250LXNpemU6MTJweDtjb2xvcjojOGE5OWFhfQouYy1kYXkuY2hlY2tlZHtiYWNrZ3JvdW5kOiMxYzRiNTg7Y29sb3I6IzM3ZDBlODtmb250LXdlaWdodDpib2xkfQoudGFiLWJhcntwb3NpdGlvbjpmaXhlZDtsZWZ0OjA7cmlnaHQ6MDtib3R0b206MDtiYWNrZ3JvdW5kOiMxMzFlMmY7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczoxZnIgMWZyIDFmcjtwYWRkaW5nOjEwcHggMDt6LWluZGV4OjEwfQoudGFiLWl0ZW17dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjE0cHg7cGFkZGluZzo2cHggMDtjb2xvcjojODg5OWFhO2N1cnNvcjpwb2ludGVyfQoudGFiLWl0ZW0uYWN0aXZle2NvbG9yOiMzN2QwZTh9Ci5sb2ctaXRlbXtwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDojMTcyNDM2O2JvcmRlci1yYWRpdXM6MTBweDttYXJnaW4tYm90dG9tOjhweDtmb250LXNpemU6MTNweDtjb2xvcjojYzVkMmUyO3dvcmQtYnJlYWs6YnJlYWstYWxsfQouc2V0dGluZy1ibG9ja3tiYWNrZ3JvdW5kOiMxNzI0MzY7Ym9yZGVyLXJhZGl1czoxNHB4O3BhZGRpbmc6MTZweDttYXJnaW4tYm90dG9tOjE0cHh9Ci5zZXR0aW5nLXRpdGxle2ZvbnQtc2l6ZToxNnB4O21hcmdpbi1ib3R0b206MTJweDtmb250LXdlaWdodDpib2xkfQouYmFyay1yb3d7ZGlzcGxheTpmbGV4O2dhcDo4cHg7YWxpZ24taXRlbXM6Y2VudGVyO21hcmdpbi1ib3R0b206MTBweH0KLmJhcmstcm93IC5iYXJrLWlke3dpZHRoOjgwcHg7ZmxleC1zaHJpbms6MDttaW4td2lkdGg6MH0KLmJhcmstcm93IC5iYXJrLW5hbWV7Zm9udC1zaXplOjEzcHg7Zm9udC13ZWlnaHQ6Ym9sZDtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpczt3aGl0ZS1zcGFjZTpub3dyYXB9Ci5iYXJrLXJvdyAuYmFyay1zdWJ7Zm9udC1zaXplOjExcHg7Y29sb3I6IzhhOTlhYTtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpczt3aGl0ZS1zcGFjZTpub3dyYXB9Ci5iYXJrLXJvdyBpbnB1dHtmbGV4OjE7bWluLXdpZHRoOjA7YmFja2dyb3VuZDojMWYyZjQ0O2JvcmRlcjoxcHggc29saWQgIzJhM2E1Mjtib3JkZXItcmFkaXVzOjEwcHg7Y29sb3I6I2U4ZWRmMztwYWRkaW5nOjlweCAxMnB4O2ZvbnQtc2l6ZToxM3B4O291dGxpbmU6bm9uZX0KLmJhcmstcm93IGlucHV0OmZvY3Vze2JvcmRlci1jb2xvcjojMjNjNmRlfQouYnRue3BhZGRpbmc6OXB4IDE0cHg7Ym9yZGVyLXJhZGl1czoxMHB4O2JvcmRlcjpub25lO2N1cnNvcjpwb2ludGVyO2ZvbnQtc2l6ZToxM3B4O3doaXRlLXNwYWNlOm5vd3JhcH0KLmJ0bi1wcmltYXJ5e2JhY2tncm91bmQ6IzIzYzZkZTtjb2xvcjojMGIxNDIyO2ZvbnQtd2VpZ2h0OmJvbGR9Ci5idG4tZ2hvc3R7YmFja2dyb3VuZDojMWYyZjQ0O2NvbG9yOiNjNWQyZTJ9Ci5leHBvcnQtYXJlYXt3aWR0aDoxMDAlO2hlaWdodDoxODBweDtiYWNrZ3JvdW5kOiMwYjE0MjI7Ym9yZGVyOjFweCBzb2xpZCAjMmEzYTUyO2JvcmRlci1yYWRpdXM6MTBweDtjb2xvcjojN2VlMGEzO2ZvbnQtZmFtaWx5Ok1lbmxvLENvbnNvbGFzLG1vbm9zcGFjZTtmb250LXNpemU6MTJweDtwYWRkaW5nOjEwcHg7Ym94LXNpemluZzpib3JkZXItYm94O3Jlc2l6ZTp2ZXJ0aWNhbDttYXJnaW4tdG9wOjEwcHh9Ci50b2FzdHtwb3NpdGlvbjpmaXhlZDtsZWZ0OjUwJTtib3R0b206OTBweDt0cmFuc2Zvcm06dHJhbnNsYXRlWCgtNTAlKTtiYWNrZ3JvdW5kOiMxYzI5M2I7Y29sb3I6I2U4ZWRmMztwYWRkaW5nOjEwcHggMThweDtib3JkZXItcmFkaXVzOjEycHg7Zm9udC1zaXplOjEzcHg7ei1pbmRleDo5OTtvcGFjaXR5OjA7dHJhbnNpdGlvbjpvcGFjaXR5IC4yNXM7cG9pbnRlci1ldmVudHM6bm9uZTttYXgtd2lkdGg6ODAlO3RleHQtYWxpZ246Y2VudGVyfQoudG9hc3Quc2hvd3tvcGFjaXR5OjF9Ci5lbXB0eXtwYWRkaW5nOjMwcHggMDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjojOGE5OWFhfQoucm93LXRpdGxle2Rpc3BsYXk6ZmxleDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjthbGlnbi1pdGVtczpjZW50ZXI7bWFyZ2luOjIwcHggMCAxMnB4O2ZvbnQtc2l6ZToxNnB4fQo8L3N0eWxlPgo8L2hlYWQ+Cjxib2R5Pgo8ZGl2IGlkPSJhcHAiPjwvZGl2Pgo8ZGl2IGNsYXNzPSJ0YWItYmFyIj4KICA8ZGl2IGNsYXNzPSJ0YWItaXRlbSBhY3RpdmUiIGRhdGEtcGFnZT0iaG9tZSI+8J+PoCDpppbpobU8L2Rpdj4KICA8ZGl2IGNsYXNzPSJ0YWItaXRlbSIgZGF0YS1wYWdlPSJsb2ciPuKYsCDml6Xlv5c8L2Rpdj4KICA8ZGl2IGNsYXNzPSJ0YWItaXRlbSIgZGF0YS1wYWdlPSJzZXR0aW5nIj7impkg6K6+572uPC9kaXY+CjwvZGl2Pgo8ZGl2IGNsYXNzPSJ0b2FzdCIgaWQ9InRvYXN0Ij48L2Rpdj4KPHNjcmlwdD4KY29uc3QgQXBwID0gewogIHN0YXRlOiB7IHBhZ2U6ICJob21lIiwgYWNjb3VudExpc3Q6IFtdLCBub0FuaW06IGZhbHNlLCBsb2dMaXN0OiBbXSwgdmVyc2lvbjogIlYyLjEzIiB9LAogIHRvYXN0VGltZXI6IG51bGwsCiAgX2NkVGltZXI6IG51bGwsCgogIHRvYXN0KG1zZykgewogICAgY29uc3QgdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJ0b2FzdCIpOwogICAgaWYgKCF0KSByZXR1cm47CiAgICB0LnRleHRDb250ZW50ID0gbXNnOwogICAgdC5jbGFzc0xpc3QuYWRkKCJzaG93Iik7CiAgICBjbGVhclRpbWVvdXQodGhpcy50b2FzdFRpbWVyKTsKICAgIHRoaXMudG9hc3RUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4gdC5jbGFzc0xpc3QucmVtb3ZlKCJzaG93IiksIDE4MDApOwogIH0sCgogIGFzeW5jIHJlZnJlc2hBbGwoKSB7CiAgICB0aGlzLnN0YXRlLm5vQW5pbSA9IHRydWU7CiAgICBhd2FpdCB0aGlzLmZldGNoQWxsQWNjb3VudHMoKTsKICAgIHRoaXMucmVuZGVyKCk7CiAgfSwKCiAgYXN5bmMgZmV0Y2hBbGxBY2NvdW50cygpIHsKICAgIHRyeSB7CiAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKCIvYXBpL2RhdGEiKTsKICAgICAgY29uc3QganNvbiA9IGF3YWl0IHJlcy5qc29uKCk7CiAgICAgIGlmIChqc29uLm9rKSB7CiAgICAgICAgdGhpcy5zdGF0ZS5hY2NvdW50TGlzdCA9IGpzb24uYWNjb3VudHMgfHwgW107CiAgICAgICAgaWYgKGpzb24udmVyc2lvbikgdGhpcy5zdGF0ZS52ZXJzaW9uID0ganNvbi52ZXJzaW9uOwogICAgICB9IGVsc2UgewogICAgICAgIHRoaXMudG9hc3QoanNvbi5tc2cgfHwgIuaVsOaNruWKoOi9veWksei0pSIpOwogICAgICB9CiAgICB9IGNhdGNoIChlKSB7CiAgICAgIGNvbnNvbGUuZXJyb3IoIuiOt+WPlui0puWPt+aVsOaNruWksei0pSIsIGUpOwogICAgICB0aGlzLnRvYXN0KCLml6Dms5Xov57mjqXohJrmnKzlkI7nq6/vvIzor7fnoa7orqTlt7LlnKggTG9vbiDkuK3lkK/nlKjpnaLmnb/mi6bmiKoiKTsKICAgIH0KICB9LAoKICByZW5kZXIoKSB7CiAgICBjb25zdCBhcHAgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiYXBwIik7CiAgICBhcHAuY2xhc3NMaXN0LnRvZ2dsZSgibm8tYW5pbSIsIHRoaXMuc3RhdGUubm9BbmltKTsKICAgIHN3aXRjaCAodGhpcy5zdGF0ZS5wYWdlKSB7CiAgICAgIGNhc2UgImhvbWUiOiB0aGlzLnJlbmRlckhvbWUoKTsgYnJlYWs7CiAgICAgIGNhc2UgImxvZyI6IHRoaXMucmVuZGVyTG9nKCk7IGJyZWFrOwogICAgICBjYXNlICJzZXR0aW5nIjogdGhpcy5yZW5kZXJTZXR0aW5nKCk7IGJyZWFrOwogICAgfQogICAgaWYgKHRoaXMuc3RhdGUucGFnZSA9PT0gImhvbWUiKSB0aGlzLnN0YXJ0Q291bnRkb3duKCk7CiAgfSwKCiAgaXNTaWduZWRUb2RheShhY2MpIHsKICAgIGNvbnN0IHI3ID0gYWNjLnJlY2VudDcgfHwgW107CiAgICBpZiAocjcubGVuZ3RoKSB7CiAgICAgIGNvbnN0IGxhc3QgPSByN1tyNy5sZW5ndGggLSAxXTsKICAgICAgaWYgKGxhc3QgJiYgbGFzdC5vaykgcmV0dXJuIHRydWU7CiAgICB9CiAgICByZXR1cm4gTnVtYmVyKGFjYy50b2RheVNjb3JlIHx8IDApID4gMDsKICB9LAoKICBhc3luYyBtb3ZlQWNjb3VudChrZXksIGRlbHRhKSB7CiAgICBjb25zdCBsaXN0ID0gdGhpcy5zdGF0ZS5hY2NvdW50TGlzdDsKICAgIGNvbnN0IGkgPSBsaXN0LmZpbmRJbmRleChhID0+IGEua2V5ID09PSBrZXkpOwogICAgY29uc3QgaiA9IGkgKyBkZWx0YTsKICAgIGlmIChpIDwgMCB8fCBqIDwgMCB8fCBqID49IGxpc3QubGVuZ3RoKSByZXR1cm47CiAgICBjb25zdCBhcnIgPSBsaXN0LnNsaWNlKCk7CiAgICBjb25zdCB0bXAgPSBhcnJbaV07IGFycltpXSA9IGFycltqXTsgYXJyW2pdID0gdG1wOwogICAgdGhpcy5zdGF0ZS5hY2NvdW50TGlzdCA9IGFycjsKICAgIHRoaXMucmVuZGVySG9tZSgpOwogICAgdHJ5IHsKICAgICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goIi9hcGkvc29ydCIsIHsKICAgICAgICBtZXRob2Q6ICJQT1NUIiwKICAgICAgICBoZWFkZXJzOiB7ICJDb250ZW50LVR5cGUiOiAiYXBwbGljYXRpb24vanNvbiIgfSwKICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGtleXM6IGFyci5tYXAoYSA9PiBhLmtleSkgfSkKICAgICAgfSk7CiAgICAgIGNvbnN0IGpzb24gPSBhd2FpdCByZXMuanNvbigpOwogICAgICB0aGlzLnRvYXN0KGpzb24ub2sgPyAi5o6S5bqP5bey5L+d5a2YIiA6ICLmjpLluo/kv53lrZjlpLHotKUiKTsKICAgIH0gY2F0Y2ggKGUpIHsKICAgICAgdGhpcy50b2FzdCgi5o6S5bqP5L+d5a2Y5aSx6LSlIik7CiAgICB9CiAgfSwKCiAgcmVuZGVySG9tZSgpIHsKICAgIGNvbnN0IGFwcCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJhcHAiKTsKICAgIGNvbnN0IGxpc3QgPSB0aGlzLnN0YXRlLmFjY291bnRMaXN0OwogICAgbGV0IHRvdGFsU2NvcmUgPSAwLCBiaW5kQ2FyID0gMCwgdG9rZW5PayA9IDA7CiAgICBsaXN0LmZvckVhY2goYWNjID0+IHsKICAgICAgdG90YWxTY29yZSArPSBOdW1iZXIoYWNjLnNjb3JlIHx8IDApOwogICAgICBpZiAoYWNjLnRva2VuU3RhdHVzKSB0b2tlbk9rKys7CiAgICAgIGJpbmRDYXIgKz0gTnVtYmVyKGFjYy5jYXJDb3VudCB8fCAwKTsKICAgIH0pOwogICAgY29uc3Qgc2lnbmVkVG9kYXkgPSBsaXN0LmZpbHRlcihhID0+IHRoaXMuaXNTaWduZWRUb2RheShhKSkubGVuZ3RoOwogICAgbGV0IGNhcmRzID0gIiI7CiAgICBpZiAobGlzdC5sZW5ndGgpIHsKICAgICAgY2FyZHMgPSBsaXN0Lm1hcCgoYSwgaSkgPT4gdGhpcy5yZW5kZXJBY2NvdW50Q2FyZChhLCBpLCBsaXN0KSkuam9pbigiIik7CiAgICB9IGVsc2UgewogICAgICBjYXJkcyA9ICc8ZGl2IGNsYXNzPSJlbXB0eSI+5pqC5peg6LSm5Y+35pWw5o2uPGJyLz7or7flhYjlnKjlrqLmiLfnq6/kuIrkvKDphY3nva48YnIvPjxzcGFuIHN0eWxlPSJmb250LXNpemU6MTJweCI+emVlaG8uYm94L2FwaS9xdWljay1zYXZlP25hbWU9eHgmdG9rZW49eHgmYmFya0tleT14eDwvc3Bhbj48L2Rpdj4nOwogICAgfQogICAgbGV0IGh0bWwgPSBgCjxkaXYgY2xhc3M9ImhlYWRlciI+CiAgPGRpdiBjbGFzcz0ibG9nbyI+WjwvZGl2PgogIDxkaXYgY2xhc3M9InRpdGxlLWdyb3VwIj4KICAgIDxoMT7mnoHmoLggWkVFSE88c3BhbiBjbGFzcz0iYmFkZ2UtbGl0ZSI+TElURSAke3RoaXMuc3RhdGUudmVyc2lvbn08L3NwYW4+PC9oMT4KICAgIDxkaXYgY2xhc3M9InN1YnRpdGxlIj7nrb7liLAgwrcg6L2m6L6GIMK3IOaOp+i9pjwvZGl2PgogIDwvZGl2PgogIDxkaXYgY2xhc3M9InJlZnJlc2gtaWNvbiIgb25jbGljaz0iQXBwLnJlZnJlc2hBbGwoKSI+4p+zPC9kaXY+CjwvZGl2Pgo8ZGl2IGNsYXNzPSJiaWctY2FyZCI+CiAgPGRpdiBzdHlsZT0iZm9udC1zaXplOjE2cHg7Y29sb3I6Izk5YThiOCI+6LSm5Y+35oC756ev5YiGPC9kaXY+CiAgPGRpdiBzdHlsZT0iZm9udC1zaXplOjYwcHg7Zm9udC13ZWlnaHQ6Ym9sZDtjb2xvcjojMzdkMGU4O21hcmdpbjo2cHggMCI+JHt0b3RhbFNjb3JlLnRvTG9jYWxlU3RyaW5nKCl9PC9kaXY+CiAgPGRpdiBzdHlsZT0idGV4dC1hbGlnbjpyaWdodDtjb2xvcjojNDJlMjk5Ij7ku4rml6Xlt7Lnrb7liLAgJHtzaWduZWRUb2RheX0vJHtsaXN0Lmxlbmd0aH08L2Rpdj4KICA8ZGl2IGNsYXNzPSJzdGF0LXJvdyI+CiAgICA8ZGl2IGNsYXNzPSJzdGF0LWNhcmQiPjxkaXYgY2xhc3M9InN0YXQtbnVtIj4ke2JpbmRDYXJ9PC9kaXY+PGRpdiBjbGFzcz0ic3RhdC1sYWJlbCI+57uR5a6a6L2m6L6GPC9kaXY+PC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJzdGF0LWNhcmQiPjxkaXYgY2xhc3M9InN0YXQtbnVtIj4ke3Rva2VuT2t9PC9kaXY+PGRpdiBjbGFzcz0ic3RhdC1sYWJlbCI+VG9rZW4g5q2j5bi4PC9kaXY+PC9kaXY+CiAgPC9kaXY+CjwvZGl2Pgo8ZGl2IGNsYXNzPSJwYW5lbC1kZXNjIj7pnaLmnb/mqKHlvI/vvJrmlbDmja7nlLHmnKzmnLrohJrmnKzlkI7nq6/nrb7lkI3kuI7ojrflj5YgwrcgJHt0aGlzLnN0YXRlLnZlcnNpb259PC9kaXY+CjxkaXYgY2xhc3M9InJvdy10aXRsZSI+PHNwYW4+8J+alyDotKblj7fnirbmgIE8L3NwYW4+PHNwYW4gc3R5bGU9ImZvbnQtc2l6ZToxMnB4O2NvbG9yOiM4YTk5YWEiPuWFsSAke2xpc3QubGVuZ3RofSDkuKrotKblj7cgwrcg5Y2h54mH5Y+z5L6nIOKGkeKGkyDmiYvliqjmjpLluo88L3NwYW4+PC9kaXY+CiR7Y2FyZHN9YDsKICAgIGFwcC5pbm5lckhUTUwgPSBodG1sOwogIH0sCgogIHJlbmRlckFjY291bnRDYXJkKGEsIGksIGxpc3QpIHsKICAgIGNvbnN0IGludmFsaWQgPSAhYS50b2tlblN0YXR1czsKICAgIGNvbnN0IHNpZ25lZCA9IHRoaXMuaXNTaWduZWRUb2RheShhKTsKICAgIGNvbnN0IGF2YXRhciA9IGEuYXZhdGFyVXJsCiAgICAgID8gYDxpbWcgc3JjPSIke2EuYXZhdGFyVXJsfSIgYWx0PSIiIGxvYWRpbmc9ImxhenkiLz5gCiAgICAgIDogYDxzcGFuPiR7KGEubmFtZSB8fCAiTCIpWzBdLnRvVXBwZXJDYXNlKCl9PC9zcGFuPmA7CiAgICBjb25zdCBidCA9IE51bWJlcihhLmJsaW5kVG90YWwgfHwgMzApOwogICAgY29uc3QgYm4gPSBOdW1iZXIoYS5ibGluZE5vdyB8fCAwKTsKICAgIGNvbnN0IGJyID0gYS5ibGluZFJlbWFpbiAhPSBudWxsID8gTnVtYmVyKGEuYmxpbmRSZW1haW4pIDogTWF0aC5tYXgoMCwgYnQgLSBibik7CiAgICBjb25zdCBwY3QgPSBidCA/IE1hdGgubWluKDEwMCwgTWF0aC5yb3VuZChibiAvIGJ0ICogMTAwKSkgOiAwOwogICAgY29uc3QgY2FuRHJhdyA9IGJyIDw9IDA7CiAgICBsZXQgY2FsID0gIiI7CiAgICAoYS5yZWNlbnQ3IHx8IFtdKS5mb3JFYWNoKGQgPT4geyBjYWwgKz0gYDxkaXYgY2xhc3M9ImMtZGF5ICR7ZC5vayA/ICJjaGVja2VkIiA6ICIifSI+JHtkLmRheX08L2Rpdj5gOyB9KTsKICAgIGlmICghY2FsKSBjYWwgPSAnPGRpdiBjbGFzcz0iZW1wdHkiIHN0eWxlPSJncmlkLWNvbHVtbjoxLy0xO3BhZGRpbmc6MTJweCAwIj7mmoLml6Dnrb7liLDorrDlvZU8L2Rpdj4nOwogICAgY29uc3QgZmlyc3QgPSBpID09PSAwLCBsYXN0ID0gaSA9PT0gbGlzdC5sZW5ndGggLSAxOwogICAgY29uc3QgdGFnVG9rZW4gPSBpbnZhbGlkCiAgICAgID8gKGEuZXJyVHlwZSA9PT0gIm5ldCIgPyBgPHNwYW4gY2xhc3M9InRhZyB0YWctb3JhbmdlIj7ojrflj5blpLHotKU8L3NwYW4+YCA6IGA8c3BhbiBjbGFzcz0idGFnIHRhZy1yZWQiPlRva2VuIOWkseaViDwvc3Bhbj5gKQogICAgICA6IGA8c3BhbiBjbGFzcz0idGFnIHRhZy1ibHVlIj5Ub2tlbiDmraPluLg8L3NwYW4+YDsKICAgIGNvbnN0IHRhZ1NpZ24gPSBzaWduZWQgPyBgPHNwYW4gY2xhc3M9InRhZyB0YWctZ3JlZW4iPuW3suetvuWIsDwvc3Bhbj5gIDogYDxzcGFuIGNsYXNzPSJ0YWcgdGFnLWdyZXkiPuacquetvuWIsDwvc3Bhbj5gOwogICAgY29uc3QgY2RMaW5lID0gY2FuRHJhdwogICAgICA/IGA8ZGl2IGNsYXNzPSJjb3VudGRvd24tbGluZSByZWFkeSI+8J+OgSDnm7Lnm5Llt7LlsLHnu6ogwrcg5LuK5pel5Y+v5oq955uy55uSPC9kaXY+YAogICAgICA6IGA8ZGl2IGNsYXNzPSJjb3VudGRvd24tbGluZSI+8J+OgSA8c3Bhbj7ot53nm7Lnm5Lop6PplIE8L3NwYW4+PHNwYW4gc3R5bGU9Im1hcmdpbi1sZWZ0OmF1dG8iIGNsYXNzPSJjZC12YWwiIGRhdGEtcmVtPSIke2JyfSI+JHticn3lpKkgLS06LS06LS08L3NwYW4+PC9kaXY+YDsKICAgIHJldHVybiBgCjxkaXYgY2xhc3M9ImJpZy1jYXJkICR7aW52YWxpZCA/ICJjYXJkLWludmFsaWQiIDogIiJ9Ij4KICA8ZGl2IGNsYXNzPSJhY2NvdW50LWhlYWRlciI+CiAgICA8ZGl2IGNsYXNzPSJhdmF0YXItYm94Ij4ke2F2YXRhcn08L2Rpdj4KICAgIDxkaXYgY2xhc3M9Im5hbWUtaWQgJHtpbnZhbGlkID8gIm5hbWUtaW52YWxpZCIgOiAiIn0iPgogICAgICA8aDM+JHthLm5hbWUgfHwgIi0tIn08L2gzPgogICAgICA8ZGl2IGNsYXNzPSJ1aWQiPklEICR7YS51aWQgfHwgKGEua2V5ID8gYS5rZXkuc2xpY2UoMCwgOCkgOiAiLS0iKX08L2Rpdj4KICAgIDwvZGl2PgogICAgPGRpdiBjbGFzcz0idGFnLWdyb3VwIj4ke3RhZ1Rva2VufSR7dGFnU2lnbn08L2Rpdj4KICAgIDxkaXYgY2xhc3M9InNvcnQtYnRucyI+CiAgICAgIDxkaXYgY2xhc3M9InNvcnQtYnRuICR7Zmlyc3QgPyAiZGlzYWJsZWQiIDogIiJ9IiBvbmNsaWNrPSJBcHAubW92ZUFjY291bnQoJyR7YS5rZXl9JywtMSkiPuKGkTwvZGl2PgogICAgICA8ZGl2IGNsYXNzPSJzb3J0LWJ0biAke2xhc3QgPyAiZGlzYWJsZWQiIDogIiJ9IiBvbmNsaWNrPSJBcHAubW92ZUFjY291bnQoJyR7YS5rZXl9JywxKSI+4oaTPC9kaXY+CiAgICA8L2Rpdj4KICA8L2Rpdj4KICA8ZGl2IGNsYXNzPSJudW0tZ3JpZCI+CiAgICA8ZGl2IGNsYXNzPSJudW0taXRlbSI+PGRpdiBjbGFzcz0ibnVtLXZhbCI+JHthLnNjb3JlIHx8IDB9PC9kaXY+PGRpdiBjbGFzcz0ibnVtLWRlc2MiPuaAu+enr+WIhjwvZGl2PjwvZGl2PgogICAgPGRpdiBjbGFzcz0ibnVtLWl0ZW0iPjxkaXYgY2xhc3M9Im51bS12YWwiPiske2EudG9kYXlTY29yZSB8fCAwfTwvZGl2PjxkaXYgY2xhc3M9Im51bS1kZXNjIj7ku4rml6Xnp6/liIY8L2Rpdj48L2Rpdj4KICAgIDxkaXYgY2xhc3M9Im51bS1pdGVtIj48ZGl2IGNsYXNzPSJudW0tdmFsIj4ke2EuY29udGludWVEYXlzIHx8IDB9PC9kaXY+PGRpdiBjbGFzcz0ibnVtLWRlc2MiPui/nuetvuWkqeaVsDwvZGl2PjwvZGl2PgogICAgPGRpdiBjbGFzcz0ibnVtLWl0ZW0iPjxkaXYgY2xhc3M9Im51bS12YWwiPiR7YnJ9PC9kaXY+PGRpdiBjbGFzcz0ibnVtLWRlc2MiPui3neebsuebkijlpKkpPC9kaXY+PC9kaXY+CiAgPC9kaXY+CiAgPGRpdiBjbGFzcz0icHJvZ3Jlc3Mtd3JhcCI+CiAgICA8ZGl2IGNsYXNzPSJwcm9ncmVzcy10aXRsZSI+PHNwYW4+55uy55uS6L+b5bqmPC9zcGFuPjxzcGFuPiR7Ym59LyR7YnR9IMK3ICR7cGN0fSU8L3NwYW4+PC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJwcm9ncmVzcy1iYXIiPjxkaXYgY2xhc3M9InByb2dyZXNzLWZpbGwiIHN0eWxlPSJ3aWR0aDoke3BjdH0lIj48L2Rpdj48L2Rpdj4KICA8L2Rpdj4KICAke2NkTGluZX0KICA8ZGl2IGNsYXNzPSJjYWxlbmRhci1yb3ciPiR7Y2FsfTwvZGl2Pgo8L2Rpdj5gOwogIH0sCgogIHN0YXJ0Q291bnRkb3duKCkgewogICAgaWYgKHRoaXMuX2NkVGltZXIpIHJldHVybjsKICAgIGNvbnN0IHVwZGF0ZSA9ICgpID0+IHsKICAgICAgY29uc3QgZWxzID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgiW2RhdGEtcmVtXSIpOwogICAgICBpZiAoIWVscy5sZW5ndGgpIHJldHVybjsKICAgICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTsKICAgICAgY29uc3QgbWlkID0gbmV3IERhdGUobm93KTsKICAgICAgbWlkLnNldEhvdXJzKDI0LCAwLCAwLCAwKTsKICAgICAgbGV0IGRpZmYgPSBtaWQgLSBub3c7CiAgICAgIGlmIChkaWZmIDwgMCkgZGlmZiA9IDA7CiAgICAgIGNvbnN0IGggPSBTdHJpbmcoTWF0aC5mbG9vcihkaWZmIC8gMzYwMDAwMCkpLnBhZFN0YXJ0KDIsICIwIik7CiAgICAgIGNvbnN0IG0gPSBTdHJpbmcoTWF0aC5mbG9vcihkaWZmICUgMzYwMDAwMCAvIDYwMDAwKSkucGFkU3RhcnQoMiwgIjAiKTsKICAgICAgY29uc3QgcyA9IFN0cmluZyhNYXRoLmZsb29yKGRpZmYgJSA2MDAwMCAvIDEwMDApKS5wYWRTdGFydCgyLCAiMCIpOwogICAgICBlbHMuZm9yRWFjaChlbCA9PiB7IGVsLnRleHRDb250ZW50ID0gZWwuZGF0YXNldC5yZW0gKyAi5aSpICIgKyBoICsgIjoiICsgbSArICI6IiArIHM7IH0pOwogICAgfTsKICAgIHVwZGF0ZSgpOwogICAgdGhpcy5fY2RUaW1lciA9IHNldEludGVydmFsKHVwZGF0ZSwgMTAwMCk7CiAgfSwKCiAgcmVuZGVyTG9nKCkgewogICAgY29uc3QgYXBwID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImFwcCIpOwogICAgbGV0IGh0bWwgPSBgCjxkaXYgY2xhc3M9ImhlYWRlciI+CiAgPGRpdiBjbGFzcz0ibG9nbyI+WjwvZGl2PgogIDxkaXYgY2xhc3M9InRpdGxlLWdyb3VwIj4KICAgIDxoMT7mk43kvZzml6Xlv5c8c3BhbiBjbGFzcz0iYmFkZ2UtbGl0ZSI+TElURSAke3RoaXMuc3RhdGUudmVyc2lvbn08L3NwYW4+PC9oMT4KICAgIDxkaXYgY2xhc3M9InN1YnRpdGxlIj7nrb7liLDorrDlvZXjgIHmjqXlj6Pov5Tlm57ml6Xlv5c8L2Rpdj4KICA8L2Rpdj4KPC9kaXY+YDsKICAgIGlmICh0aGlzLnN0YXRlLmxvZ0xpc3QubGVuZ3RoKSB7CiAgICAgIGh0bWwgKz0gdGhpcy5zdGF0ZS5sb2dMaXN0Lm1hcCh4ID0+IGA8ZGl2IGNsYXNzPSJsb2ctaXRlbSI+JHt4fTwvZGl2PmApLmpvaW4oIiIpOwogICAgfSBlbHNlIHsKICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz0ic2V0dGluZy1ibG9jayI+5pqC5peg5pel5b+XPGJyLz48c3BhbiBzdHlsZT0iZm9udC1zaXplOjEycHg7Y29sb3I6IzhhOTlhYSI+5pel5b+X55Sx562+5Yiw6ISa5pys5YaZ5YWl77yIemVlaG9fbG9nc++8ie+8jOacrOmdouadv+aaguS4jeaPkOS+m+aXpeW/l+aOpeWPo+OAgjwvc3Bhbj48L2Rpdj4nOwogICAgfQogICAgYXBwLmlubmVySFRNTCA9IGh0bWw7CiAgfSwKCiAgcmVuZGVyU2V0dGluZygpIHsKICAgIGNvbnN0IGFwcCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJhcHAiKTsKICAgIGNvbnN0IGxpc3QgPSB0aGlzLnN0YXRlLmFjY291bnRMaXN0OwogICAgbGV0IHJvd3MgPSAiIjsKICAgIGlmIChsaXN0Lmxlbmd0aCkgewogICAgICByb3dzID0gbGlzdC5tYXAoYSA9PiB7CiAgICAgICAgY29uc3QgaW52YWxpZCA9ICFhLnRva2VuU3RhdHVzOwogICAgICAgIHJldHVybiBgCjxkaXYgY2xhc3M9ImJhcmstcm93Ij4KICA8ZGl2IGNsYXNzPSJiYXJrLWlkIj4KICAgIDxkaXYgY2xhc3M9ImJhcmstbmFtZSIgc3R5bGU9IiR7aW52YWxpZCA/ICJjb2xvcjojZmY1NDcwIiA6ICIifSI+JHthLm5hbWUgfHwgIi0tIn08L2Rpdj4KICAgIDxkaXYgY2xhc3M9ImJhcmstc3ViIj4ke2EudWlkIHx8IGEua2V5IHx8ICIifTwvZGl2PgogIDwvZGl2PgogIDxpbnB1dCBpZD0iYmFyay0ke2Eua2V5fSIgdHlwZT0idGV4dCIgcGxhY2Vob2xkZXI9IkJhcmtLZXnvvIjlj6/pgInvvIkiIHZhbHVlPSIke2EuYmFya0tleSB8fCAiIn0iLz4KICA8YnV0dG9uIGNsYXNzPSJidG4gYnRuLWdob3N0IiBvbmNsaWNrPSJBcHAuc2F2ZUJhcmsoJyR7YS5rZXl9JykiPuS/neWtmDwvYnV0dG9uPgogIDxidXR0b24gY2xhc3M9ImJ0biBidG4tcHJpbWFyeSIgb25jbGljaz0iQXBwLnRlc3RCYXJrKCcke2Eua2V5fScpIj7mtYvor5U8L2J1dHRvbj4KPC9kaXY+YDsKICAgICAgfSkuam9pbigiIik7CiAgICB9IGVsc2UgewogICAgICByb3dzID0gJzxkaXYgY2xhc3M9ImVtcHR5Ij7mmoLml6DotKblj7fmlbDmja7vvIzor7flhYjlnKjlrqLmiLfnq6/kuIrkvKDphY3nva48L2Rpdj4nOwogICAgfQogICAgYXBwLmlubmVySFRNTCA9IGAKPGRpdiBjbGFzcz0iaGVhZGVyIj4KICA8ZGl2IGNsYXNzPSJsb2dvIj5aPC9kaXY+CiAgPGRpdiBjbGFzcz0idGl0bGUtZ3JvdXAiPgogICAgPGgxPuiuvue9rjxzcGFuIGNsYXNzPSJiYWRnZS1saXRlIj5MSVRFICR7dGhpcy5zdGF0ZS52ZXJzaW9ufTwvc3Bhbj48L2gxPgogICAgPGRpdiBjbGFzcz0ic3VidGl0bGUiPui0puWPt+euoeeQhiDCtyBCYXJrS2V5IMK3IOWvvOWHuiBUb2tlbjwvZGl2PgogIDwvZGl2Pgo8L2Rpdj4KPGRpdiBjbGFzcz0ic2V0dGluZy1ibG9jayI+CiAgPGRpdiBjbGFzcz0ic2V0dGluZy10aXRsZSI+6LSm5Y+3566h55CG77yIJHtsaXN0Lmxlbmd0aH3vvIk8L2Rpdj4KICA8ZGl2IHN0eWxlPSJmb250LXNpemU6MTJweDtjb2xvcjojOGE5OWFhO21hcmdpbi1ib3R0b206MTJweCI+5q+P5Liq6LSm5Y+35Y+v5Y2V54us6YWN572uIEJhcmtLZXnvvIhpT1Mg5o6o6YCB77yJ77yM5L+d5a2Y5ZCO5Y+v5Y+R6YCB5rWL6K+V5o6o6YCB44CCPC9kaXY+CiAgJHtyb3dzfQo8L2Rpdj4KPGRpdiBjbGFzcz0ic2V0dGluZy1ibG9jayI+CiAgPGRpdiBjbGFzcz0ic2V0dGluZy10aXRsZSI+5LiA6ZSu5a+85Ye6IFRva2VuPC9kaXY+CiAgPGRpdiBzdHlsZT0iZm9udC1zaXplOjEycHg7Y29sb3I6IzhhOTlhYTttYXJnaW4tYm90dG9tOjEwcHgiPuWvvOWHuuWFqOmDqOi0puWPt+eahCBUb2tlbiAvIEJhcmtLZXnvvIzkvr/kuo7lpIfku73miJbov4Hnp7vliLDlhbbku5borr7lpIfjgII8L2Rpdj4KICA8YnV0dG9uIGNsYXNzPSJidG4gYnRuLXByaW1hcnkiIG9uY2xpY2s9IkFwcC5leHBvcnRUb2tlbnMoKSI+8J+TiyDkuIDplK7lr7zlh7o8L2J1dHRvbj4KICA8YnV0dG9uIGNsYXNzPSJidG4gYnRuLWdob3N0IiBvbmNsaWNrPSJBcHAuY29weUV4cG9ydCgpIiBzdHlsZT0ibWFyZ2luLWxlZnQ6OHB4Ij7lpI3liLY8L2J1dHRvbj4KICA8dGV4dGFyZWEgaWQ9ImV4cG9ydEFyZWEiIGNsYXNzPSJleHBvcnQtYXJlYSIgcGxhY2Vob2xkZXI9IueCueWHu+OAjOS4gOmUruWvvOWHuuOAjeeUn+aIkCBUb2tlbiDmuIXljZXigKYiIHJlYWRvbmx5PjwvdGV4dGFyZWE+CjwvZGl2Pgo8ZGl2IGNsYXNzPSJzZXR0aW5nLWJsb2NrIj4KICA8ZGl2IGNsYXNzPSJzZXR0aW5nLXRpdGxlIj7niYjmnKw8L2Rpdj4KICA8ZGl2PlpFRUhPLUxJVEUtRW5oYW5jZWQgJHt0aGlzLnN0YXRlLnZlcnNpb259PC9kaXY+CiAgPGRpdiBzdHlsZT0iZm9udC1zaXplOjEycHg7Y29sb3I6IzhhOTlhYTttYXJnaW4tdG9wOjRweCI+6ISa5pysIHYyLjEzLjAgwrcg5p6E5bu6IDIwMjYtMDktMTIgwrcg6aaW6aG1IOKGkeKGkyDmjpLluo/oh6rliqjkv53lrZg8L2Rpdj4KPC9kaXY+YDsKICB9LAoKICBhc3luYyBzYXZlQmFyayhrZXkpIHsKICAgIGNvbnN0IGlucHV0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImJhcmstIiArIGtleSk7CiAgICBjb25zdCBiYXJrS2V5ID0gKGlucHV0ICYmIGlucHV0LnZhbHVlIHx8ICIiKS50cmltKCk7CiAgICB0cnkgewogICAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCgiL2FwaS9iYXJrIiwgewogICAgICAgIG1ldGhvZDogIlBPU1QiLAogICAgICAgIGhlYWRlcnM6IHsgIkNvbnRlbnQtVHlwZSI6ICJhcHBsaWNhdGlvbi9qc29uIiB9LAogICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsga2V5LCBiYXJrS2V5IH0pCiAgICAgIH0pOwogICAgICBjb25zdCBqc29uID0gYXdhaXQgcmVzLmpzb24oKTsKICAgICAgdGhpcy50b2FzdChqc29uLm9rID8gIkJhcmtLZXkg5bey5L+d5a2YIiA6IChqc29uLm1zZyB8fCAi5L+d5a2Y5aSx6LSlIikpOwogICAgICBjb25zdCBhID0gdGhpcy5zdGF0ZS5hY2NvdW50TGlzdC5maW5kKHggPT4geC5rZXkgPT09IGtleSk7CiAgICAgIGlmIChhKSBhLmJhcmtLZXkgPSBiYXJrS2V5OwogICAgfSBjYXRjaCAoZSkgewogICAgICB0aGlzLnRvYXN0KCLkv53lrZjlpLHotKUiKTsKICAgIH0KICB9LAoKICBhc3luYyB0ZXN0QmFyayhrZXkpIHsKICAgIGNvbnN0IGEgPSB0aGlzLnN0YXRlLmFjY291bnRMaXN0LmZpbmQoeCA9PiB4LmtleSA9PT0ga2V5KTsKICAgIGlmICghYSB8fCAhYS5iYXJrS2V5KSB7IHRoaXMudG9hc3QoIuivt+WFiOS/neWtmCBCYXJrS2V5Iik7IHJldHVybjsgfQogICAgdGhpcy50b2FzdCgi5q2j5Zyo5Y+R6YCB5rWL6K+V5o6o6YCB4oCmIik7CiAgICB0cnkgewogICAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCgiL2FwaS90ZXN0LWJhcmsiLCB7CiAgICAgICAgbWV0aG9kOiAiUE9TVCIsCiAgICAgICAgaGVhZGVyczogeyAiQ29udGVudC1UeXBlIjogImFwcGxpY2F0aW9uL2pzb24iIH0sCiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBrZXkgfSkKICAgICAgfSk7CiAgICAgIGNvbnN0IGpzb24gPSBhd2FpdCByZXMuanNvbigpOwogICAgICB0aGlzLnRvYXN0KGpzb24ub2sgPyAoanNvbi5tc2cgfHwgIuaOqOmAgeaIkOWKnyIpIDogKCLmjqjpgIHlpLHotKXvvJoiICsgKGpzb24ubXNnIHx8ICIiKSkpOwogICAgfSBjYXRjaCAoZSkgewogICAgICB0aGlzLnRvYXN0KCLmjqjpgIHlpLHotKUiKTsKICAgIH0KICB9LAoKICBhc3luYyBleHBvcnRUb2tlbnMoKSB7CiAgICB0cnkgewogICAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCgiL2FwaS9leHBvcnQiKTsKICAgICAgY29uc3QganNvbiA9IGF3YWl0IHJlcy5qc29uKCk7CiAgICAgIGlmIChqc29uLm9rKSB7CiAgICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImV4cG9ydEFyZWEiKS52YWx1ZSA9IGpzb24udGV4dDsKICAgICAgICB0aGlzLnRvYXN0KCLlr7zlh7rmiJDlip/vvIzlj6/lpI3liLYiKTsKICAgICAgfSBlbHNlIHsKICAgICAgICB0aGlzLnRvYXN0KGpzb24ubXNnIHx8ICLlr7zlh7rlpLHotKUiKTsKICAgICAgfQogICAgfSBjYXRjaCAoZSkgewogICAgICB0aGlzLnRvYXN0KCLlr7zlh7rlpLHotKUiKTsKICAgIH0KICB9LAoKICBjb3B5RXhwb3J0KCkgewogICAgY29uc3QgdGEgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiZXhwb3J0QXJlYSIpOwogICAgaWYgKCF0YSB8fCAhdGEudmFsdWUpIHsgdGhpcy50b2FzdCgi6K+35YWI5LiA6ZSu5a+85Ye6Iik7IHJldHVybjsgfQogICAgdGEuc2VsZWN0KCk7CiAgICB0YS5zZXRTZWxlY3Rpb25SYW5nZSgwLCA5OTk5OTkpOwogICAgbGV0IGRvbmUgPSAoKSA9PiB0aGlzLnRvYXN0KCLlt7LlpI3liLbliLDliarotLTmnb8iKTsKICAgIGxldCBmYWlsID0gKCkgPT4geyB0cnkgeyBkb2N1bWVudC5leGVjQ29tbWFuZCgiY29weSIpOyBkb25lKCk7IH0gY2F0Y2ggKGUpIHsgdGhpcy50b2FzdCgi5aSN5Yi25aSx6LSl77yM6K+35omL5Yqo6ZW/5oyJ5aSN5Yi2Iik7IH0gfTsKICAgIGlmIChuYXZpZ2F0b3IuY2xpcGJvYXJkICYmIG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KSB7CiAgICAgIG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHRhLnZhbHVlKS50aGVuKGRvbmUsIGZhaWwpOwogICAgfSBlbHNlIHsKICAgICAgZmFpbCgpOwogICAgfQogIH0sCgogIGJpbmRUYWIoKSB7CiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCIudGFiLWl0ZW0iKS5mb3JFYWNoKGVsID0+IHsKICAgICAgZWwub25jbGljayA9ICgpID0+IHsKICAgICAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCIudGFiLWl0ZW0iKS5mb3JFYWNoKHQgPT4gdC5jbGFzc0xpc3QucmVtb3ZlKCJhY3RpdmUiKSk7CiAgICAgICAgZWwuY2xhc3NMaXN0LmFkZCgiYWN0aXZlIik7CiAgICAgICAgdGhpcy5zdGF0ZS5wYWdlID0gZWwuZGF0YXNldC5wYWdlOwogICAgICAgIHRoaXMucmVuZGVyKCk7CiAgICAgIH07CiAgICB9KTsKICB9LAoKICBpbml0KCkgewogICAgdGhpcy5iaW5kVGFiKCk7CiAgICB0aGlzLnJlZnJlc2hBbGwoKTsKICB9Cn07CndpbmRvdy5vbmxvYWQgPSAoKSA9PiBBcHAuaW5pdCgpOwo8L3NjcmlwdD4KPC9ib2R5Pgo8L2h0bWw+Cg==";

// ========== 主流程：Loon http-request 路由 ==========
function parsePath(url) {
  const m = String(url || "").match(/^[a-z]+:\/\/[^/]*(\/[^?#]*)?/i);
  return (m && m[1]) ? m[1] : "/";
}
function parseBody(raw) {
  try { return JSON.parse(raw || "{}"); } catch (e) { return {}; }
}

function respond(res) {
  if (typeof $done === "function") {
    $done({
      status: res.status,
      headers: { "Content-Type": res.contentType, "Cache-Control": "no-store" },
      body: res.body
    });
  } else {
    console.log("[响应]", res.status, res.contentType, String(res.body).slice(0, 200));
  }
}

async function main() {
  const req = (typeof $request !== "undefined") ? $request : null;
  const path = parsePath(req && req.url);
  const method = String((req && req.method) || "GET").toUpperCase();
  const body = parseBody(req && req.body);
  let status = 200, contentType = "text/html; charset=utf-8", out = "";
  try {
    if (path === "/" || path === "/index.html") {
      out = decodeB64(panelHtmlB64);
    } else if (path === "/api/data") {
      const accounts = await Backend.getDashboard();
      out = JSON.stringify({ ok: true, version: SCRIPT_VERSION_TAG, accounts });
      contentType = "application/json; charset=utf-8";
    } else if (path === "/api/sort" && method === "POST") {
      Backend.saveSort(body.keys || []);
      out = JSON.stringify({ ok: true, msg: "排序已保存" });
      contentType = "application/json; charset=utf-8";
    } else if (path === "/api/bark" && method === "POST") {
      const hit = Backend.saveBark(String(body.key || ""), String(body.barkKey || "").trim());
      out = JSON.stringify({ ok: hit, msg: hit ? "BarkKey 已保存" : "保存失败：账号不存在" });
      contentType = "application/json; charset=utf-8";
    } else if (path === "/api/export") {
      const text = await Backend.exportTokens();
      out = JSON.stringify({ ok: true, text });
      contentType = "application/json; charset=utf-8";
    } else if (path === "/api/test-bark" && method === "POST") {
      out = JSON.stringify(await Backend.testBark(String(body.key || "")));
      contentType = "application/json; charset=utf-8";
    } else {
      status = 404;
      out = "Not Found";
    }
  } catch (e) {
    console.error("[面板主流程异常]", e);
    status = 500;
    out = JSON.stringify({ ok: false, msg: String((e && e.message) || e) });
    contentType = "application/json; charset=utf-8";
  }
  respond({ status, contentType, body: out });
}

// 自动运行：Loon 环境直接跑；Node 环境导出供本地测试
if (typeof $request !== "undefined") {
  main().catch(e => {
    console.error(e);
    respond({ status: 500, contentType: "application/json; charset=utf-8", body: JSON.stringify({ ok: false, msg: String((e && e.message) || e) }) });
  });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { main, Backend, SCRIPT_VERSION, SCRIPT_VERSION_TAG, KEY_DATA };
}