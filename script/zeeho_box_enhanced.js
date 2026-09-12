/*
#!name=极核 ZEEHO 签到面板 V2.14
#!desc=极核多账号签到面板增强版 V2.14 · 面板(HTTP-REQUEST) + 定时签到(CRON) 一体：多账号手动排序 / Token失效标红 / 盲盒倒计时 / 一键导出Token / BarkKey配置 / 面板管理签到配置(zeeho_config)。数据由代理后端签名获取，本地验证不依赖 Loon。
#!author=lucky

[Script]
# 面板（浏览器/客户端访问 http://zeeho.box 打开面板）
http-request ^http:\/\/zeeho\.box(\/.*)?$ script-path=zeeho_box_enhanced_lite.js, requires-body=true, timeout=60, tag=极核面板V2.14
# 定时签到（cron，与面板同一脚本，自动签到 + 盲盒 + Bark推送）
cron "30 8 * * *" script-path=zeeho_box_enhanced_lite.js, tag=极核签到V2.14

[MITM]
hostname = zeeho.box

====================================
⚠️【免责声明】
------------------------------------------
1、此脚本仅用于学习研究，请根据情况自行判断，不保证其合法性、准确性、有效性。
2、请勿将此脚本用于任何商业或非法目的。
3、涉及第三方应用与脚本作者无关。

代理后端需提供（POST，JSON）：
  /get-userid   {token} -> {userId, headUrl/avatar}
  /get-account  {token, uid} -> {nickname, score, todayScore, continueDays, blindNow, blindTotal, blindRemain, carCount, recent7}
  /signin       {token} -> {code:0|10000, data:{todayScore, continueDays, blindNow, blindRemain, nickname}}
  /blindbox     {token} -> {code:0|10000, data:{reward/prizesName/integral}}
 */

// ========== 版本信息（每次修改必须同步更新） ==========
const SCRIPT_VERSION = "v2.14.0";     // 脚本版本号
const SCRIPT_VERSION_TAG = "V2.14";   // 面板/接口/导出显示的版本标签
const SCRIPT_VERSION_DATE = "2026-09-12";

// ========== 默认配置 ==========
const $config = {
  delayMin: 600,        // 单账号请求最小延迟 ms
  delayMax: 1200,       // 单账号请求最大延迟 ms
  batchSize: 2,         // 每批并发账号数（防限流）
  timeout: 15000,       // 请求超时 ms
  apiDomain: "https://api-zeeho.example.com" // 默认代理后端，可在面板「签到配置」中修改并持久化
};

// 存储键
const KEY_DATA = "zeeho_data";      // 账号列表 [{token, barkKey}]，数组顺序=面板显示顺序
const KEY_CONFIG = "zeeho_config";  // 签到配置（面板读写）
const KEY_LOGS = "zeeho_logs";      // 运行日志（最近50条）

const DEFAULT_CONFIG = {
  signinEnabled: true,   // 自动签到开关
  blindBoxAuto: true,    // 盲盒自动抽取
  barkNotify: true,      // Bark 通知
  signinTime: "08:30",   // 签到时间（参考，Loon cron 需同步）
  apiDomain: $config.apiDomain // 代理后端地址
};

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
function pad2(n) { return n < 10 ? "0" + n : "" + n; }
function fmtTime() { const d = new Date(); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()); }
function fmtDate() { const d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }

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

// ========== 配置读写（面板负责读取/保存脚本配置） ==========
function getConfig() {
  try {
    const raw = Storage.read(KEY_CONFIG);
    if (raw) return Object.assign({}, DEFAULT_CONFIG, JSON.parse(raw));
  } catch (e) { console.error("[读取配置失败]", e); }
  return Object.assign({}, DEFAULT_CONFIG);
}
function saveConfig(cfg) {
  const merged = Object.assign({}, DEFAULT_CONFIG, cfg || {});
  Storage.write(KEY_CONFIG, JSON.stringify(merged));
  return merged;
}
function effectiveApiDomain() {
  const cfg = getConfig();
  return (cfg.apiDomain && String(cfg.apiDomain).trim()) || $config.apiDomain;
}

// ========== 运行日志 ==========
function getLogs() {
  try {
    const raw = Storage.read(KEY_LOGS);
    if (raw) { const a = JSON.parse(raw); if (Array.isArray(a)) return a; }
  } catch (e) {}
  return [];
}
function addLog(text) {
  const logs = getLogs();
  logs.push("[" + fmtDate() + " " + fmtTime() + "] " + text);
  while (logs.length > 50) logs.shift();
  Storage.write(KEY_LOGS, JSON.stringify(logs));
}

// ========== 通知（Loon 系统通知） ==========
function notify(title, subtitle, body) {
  try {
    if (typeof $notification !== "undefined" && $notification.post) $notification.post(title, subtitle, body || "");
    else if (typeof $notify === "function") $notify(title, subtitle, body || "");
  } catch (e) {}
}

// ========== 账号数据获取 ==========
function isAuthError(json, status) {
  if (status === 401 || status === 403) return true;
  const code = json && json.code !== undefined ? String(json.code) : "";
  if (code === "40001" || code === "401" || code === "40100" || code === "403") return true;
  const msg = String((json && (json.msg || json.message)) || "");
  return /token|登录|失效|过期|未授权|鉴权/i.test(msg) && code !== "10000" && code !== "0";
}
function isSuccess(json) {
  const code = json && json.code !== undefined ? String(json.code) : "";
  return code === "10000" || code === "0" || (json && json.success === true);
}

async function getUseridByToken(token) {
  const r = await httpRequest("POST", effectiveApiDomain() + "/get-userid", { "Content-Type": "application/json" }, { token });
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
    const r = await httpRequest("POST", effectiveApiDomain() + "/get-account", { "Content-Type": "application/json" }, { token, uid: uidObj.uid });
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

// ========== Bark 推送 ==========
async function barkPush(barkKey, title, body) {
  if (!barkKey || !String(barkKey).trim()) return { ok: false, msg: "无BarkKey" };
  try {
    const url = "https://api.day.app/" + encodeURIComponent(String(barkKey).trim()) + "/" +
      encodeURIComponent(title) + "/" + encodeURIComponent(body) + "?group=zeeho_signin";
    const r = await httpRequest("GET", url, {}, null);
    return { ok: r.status >= 200 && r.status < 300 };
  } catch (e) {
    return { ok: false, msg: String((e && e.message) || e) };
  }
}

// ========== 定时签到（CRON 模式） ==========
// 单账号签到：签到 -> 盲盒（可选）-> Bark 推送 -> 返回更新后的账号 + 日志
async function runSignInForAccount(acc, cfg) {
  const token = acc.token;
  const logs = [];
  const tag = "账号 " + String(token).slice(0, 6) + "…";
  logs.push("【" + tag + "】开始签到");
  try {
    const r = await httpRequest("POST", effectiveApiDomain() + "/signin", { "Content-Type": "application/json" }, { token });
    if (isAuthError(r.json, r.status)) {
      acc.tokenStatus = false;
      acc.errType = "auth";
      logs.push("❌ Token 失效，请在面板重新上传");
      if (cfg.barkNotify) await barkPush(acc.barkKey, "极核签到【Token失效】", tag + " Token已失效，请更新");
      return { acc, logs, ok: false };
    }
    const d = r.json || {};
    const data = d.data && typeof d.data === "object" ? d.data : d;
    if (isSuccess(d)) {
      const name = data.nickname || data.nickName || tag;
      const todayScore = Number(data.todayScore || 0);
      const continueDays = Number(data.continueDays || 0);
      const blindTotal = Number(data.blindTotal || 30);
      const blindNow = Number(data.blindNow || 0);
      const blindRemain = data.blindRemain != null ? Number(data.blindRemain) : Math.max(0, blindTotal - blindNow);
      logs.push("✅ " + name + " 签到成功，今日 +" + todayScore + "，连签 " + continueDays + " 天");
      acc.tokenStatus = true;
      acc.errType = "";
      if (blindRemain <= 0 && cfg.blindBoxAuto) {
        try {
          const b = await httpRequest("POST", effectiveApiDomain() + "/blindbox", { "Content-Type": "application/json" }, { token });
          const bd = b.json || {};
          const bdata = bd.data && typeof bd.data === "object" ? bd.data : bd;
          if (isSuccess(bd)) {
            const reward = bdata.reward || bdata.prizesName || (bdata.integral != null ? bdata.integral + " 积分" : "奖励");
            logs.push("🎁 盲盒抽取成功，获得 " + reward);
          } else {
            logs.push("⚠️ 盲盒抽取失败：" + (bdata.msg || bd.msg || "未知错误"));
          }
        } catch (be) {
          logs.push("⚠️ 盲盒抽取异常：" + String((be && be.message) || be));
        }
      }
      if (cfg.barkNotify) await barkPush(acc.barkKey, "极核签到", "✅ " + name + " 今日 +" + todayScore + "，连签 " + continueDays + " 天");
      return { acc, logs, ok: true };
    }
    logs.push("⚠️ 签到返回异常 code=" + d.code + " msg=" + (d.msg || ""));
    return { acc, logs, ok: false };
  } catch (e) {
    logs.push("❌ 网络异常：" + String((e && e.message) || e));
    acc.tokenStatus = false;
    acc.errType = "net";
    return { acc, logs, ok: false };
  }
}

// CRON 主流程：遍历账号签到 -> 回写 tokenStatus -> 写日志 -> 通知汇总
async function runSignAll() {
  const cfg = getConfig();
  if (!cfg.signinEnabled) {
    const msg = "自动签到已关闭（面板「设置→签到配置」可开启）";
    console.log(msg);
    addLog("⏸ " + msg);
    if (cfg.barkNotify) notify("极核定时签到", "已跳过", msg);
    return { skipped: true, ok: 0, fail: 0 };
  }
  const accounts = Backend.getTokenList();
  if (!accounts.length) {
    const msg = "没有读取到账号，请在面板 zeeho.box 添加";
    console.log(msg);
    addLog("⚠️ " + msg);
    notify("极核定时签到", "无账号", msg);
    return { skipped: true, ok: 0, fail: 0 };
  }
  const results = [];
  let ok = 0, fail = 0;
  for (const acc of accounts) {
    const r = await runSignInForAccount(acc, cfg);
    results.push(r);
    if (r.ok) ok++; else fail++;
    await sleep(randDelay());
  }
  // 回写 tokenStatus 到 zeeho_data（面板刷新后可见红/正常状态）
  const list = Backend.getTokenList();
  list.forEach(x => {
    const r = results.find(y => y.acc.token === x.token);
    if (r) { x.tokenStatus = r.acc.tokenStatus; x.errType = r.acc.errType; }
  });
  Backend.saveTokenList(list);
  // 汇总日志
  const lines = [];
  lines.push("===== 极核定时签到 " + fmtDate() + " =====");
  results.forEach(r => lines.push.apply(lines, r.logs));
  lines.push("汇总：成功 " + ok + " / 失败 " + fail);
  const summary = lines.join("\n");
  console.log(summary);
  addLog(summary);
  if (cfg.barkNotify) notify("极核定时签到", "成功 " + ok + " / 失败 " + fail, summary);
  return { skipped: false, ok, fail };
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
    const r = await barkPush(item.barkKey, "极核ZEEHO测试", "面板推送测试成功 (" + SCRIPT_VERSION_TAG + ")");
    return { ok: r.ok, msg: r.ok ? "推送成功" : ("推送失败 " + (r.msg || "")) };
  }
};

// ========== 内嵌面板 HTML（base64，构建时由 index.html 生成注入） ==========
const panelHtmlB64 = "PCFET0NUWVBFIGh0bWw+CjxodG1sIGxhbmc9InpoLUNOIj4KPGhlYWQ+CjxtZXRhIGNoYXJzZXQ9IlVURi04IiAvPgo8bWV0YSBuYW1lPSJ2aWV3cG9ydCIgY29udGVudD0id2lkdGg9ZGV2aWNlLXdpZHRoLCBpbml0aWFsLXNjYWxlPTEuMCIvPgo8dGl0bGU+5p6B5qC4IFpFRUhPIExJVEUg5aKe5by654mIIFYyLjE0PC90aXRsZT4KPHN0eWxlPgoqe2JveC1zaXppbmc6Ym9yZGVyLWJveDttYXJnaW46MDtwYWRkaW5nOjA7Zm9udC1mYW1pbHk6LWFwcGxlLXN5c3RlbSxCbGlua01hY1N5c3RlbUZvbnQsIlNlZ29lIFVJIiwiUGluZ0ZhbmcgU0MiLHNhbnMtc2VyaWZ9CmJvZHl7YmFja2dyb3VuZDojMGIxNDIyO2NvbG9yOiNlOGVkZjM7cGFkZGluZzoxNnB4O21pbi1oZWlnaHQ6MTAwdmg7cGFkZGluZy1ib3R0b206ODVweH0KLmhlYWRlcntkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMnB4O21hcmdpbi1ib3R0b206MjBweH0KLmxvZ297d2lkdGg6NTJweDtoZWlnaHQ6NTJweDtib3JkZXItcmFkaXVzOjE2cHg7YmFja2dyb3VuZDojMjNjNmRlO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmb250LXdlaWdodDpib2xkO2ZvbnQtc2l6ZToyNHB4O2NvbG9yOiMwYjE0MjI7ZmxleC1zaHJpbms6MH0KLnRpdGxlLWdyb3VwIGgxe2ZvbnQtc2l6ZToyMXB4O2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7ZmxleC13cmFwOndyYXA7Z2FwOjZweH0KLmJhZGdlLWxpdGV7YmFja2dyb3VuZDojMTQ0OTU3O2NvbG9yOiMzN2QwZTg7Zm9udC1zaXplOjEycHg7cGFkZGluZzoycHggOHB4O2JvcmRlci1yYWRpdXM6MTJweH0KLnN1YnRpdGxle2ZvbnQtc2l6ZToxM3B4O2NvbG9yOiM5OWE4Yjg7bWFyZ2luLXRvcDoycHh9Ci5yZWZyZXNoLWljb257bWFyZ2luLWxlZnQ6YXV0bzt3aWR0aDo0NHB4O2hlaWdodDo0NHB4O2JvcmRlci1yYWRpdXM6MTJweDtiYWNrZ3JvdW5kOiMxYzI5M2I7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2N1cnNvcjpwb2ludGVyO2ZvbnQtc2l6ZToyMHB4O2ZsZXgtc2hyaW5rOjB9Ci5wYW5lbC1kZXNje2JhY2tncm91bmQ6IzJjMmMyNDtjb2xvcjojZmZkZDc3O3BhZGRpbmc6MTBweCAxNHB4O2JvcmRlci1yYWRpdXM6MTBweDttYXJnaW4tYm90dG9tOjE4cHg7Zm9udC1zaXplOjE0cHh9Ci5iaWctY2FyZHtiYWNrZ3JvdW5kOiMxNzI0MzY7Ym9yZGVyLXJhZGl1czoxOHB4O3BhZGRpbmc6MjBweDttYXJnaW4tYm90dG9tOjE2cHg7Ym9yZGVyOjFweCBzb2xpZCB0cmFuc3BhcmVudH0KLmJpZy1jYXJkLmNhcmQtaW52YWxpZHtib3JkZXItY29sb3I6I2ZmNTQ3MH0KLnN0YXQtcm93e2Rpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6MWZyIDFmcjtnYXA6MTJweDttYXJnaW46MTZweCAwfQouc3RhdC1jYXJke2JhY2tncm91bmQ6IzE3MjQzNjtib3JkZXItcmFkaXVzOjE0cHg7cGFkZGluZzoxNnB4fQouc3RhdC1udW17Zm9udC1zaXplOjMycHg7Zm9udC13ZWlnaHQ6Ym9sZDtjb2xvcjojMzdkMGU4fQouc3RhdC1sYWJlbHtmb250LXNpemU6MTNweDtjb2xvcjojOTlhOGI4O21hcmdpbi10b3A6NHB4fQouYWNjb3VudC1oZWFkZXJ7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTJweDttYXJnaW4tYm90dG9tOjE0cHh9Ci5hdmF0YXItYm94e3dpZHRoOjQ4cHg7aGVpZ2h0OjQ4cHg7Ym9yZGVyLXJhZGl1czoxMnB4O2JhY2tncm91bmQ6IzIzYzZkZTtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7Zm9udC1zaXplOjIycHg7Zm9udC13ZWlnaHQ6Ym9sZDtjb2xvcjojMGIxNDIyO292ZXJmbG93OmhpZGRlbjtmbGV4LXNocmluazowfQouYXZhdGFyLWJveCBpbWd7d2lkdGg6MTAwJTtoZWlnaHQ6MTAwJTtvYmplY3QtZml0OmNvdmVyfQoubmFtZS1pZHttaW4td2lkdGg6MDtmbGV4OjF9Ci5uYW1lLWlkIGgze2ZvbnQtc2l6ZToxOHB4O292ZXJmbG93OmhpZGRlbjt0ZXh0LW92ZXJmbG93OmVsbGlwc2lzO3doaXRlLXNwYWNlOm5vd3JhcH0KLm5hbWUtaWQgLnVpZHtmb250LXNpemU6MTJweDtjb2xvcjojOTlhOGI4O21hcmdpbi10b3A6MnB4O292ZXJmbG93OmhpZGRlbjt0ZXh0LW92ZXJmbG93OmVsbGlwc2lzO3doaXRlLXNwYWNlOm5vd3JhcH0KLm5hbWUtaW52YWxpZCBoM3tjb2xvcjojZmY1NDcwfQoudGFnLWdyb3Vwe2Rpc3BsYXk6ZmxleDtnYXA6NnB4O2ZsZXgtd3JhcDp3cmFwO2p1c3RpZnktY29udGVudDpmbGV4LWVuZDtmbGV4LXNocmluazowfQoudGFne3BhZGRpbmc6NHB4IDEwcHg7Ym9yZGVyLXJhZGl1czoyMHB4O2ZvbnQtc2l6ZToxMnB4O3doaXRlLXNwYWNlOm5vd3JhcH0KLnRhZy1ncmVlbntiYWNrZ3JvdW5kOiMxOTRjNDc7Y29sb3I6IzQyZTI5OX0KLnRhZy1ibHVle2JhY2tncm91bmQ6IzE2NDQ1ODtjb2xvcjojMzdkMGU4fQoudGFnLXJlZHtiYWNrZ3JvdW5kOiM0ZDFkMjg7Y29sb3I6I2ZmNmI4Mn0KLnRhZy1vcmFuZ2V7YmFja2dyb3VuZDojNGQzYTFkO2NvbG9yOiNmZmI0NTR9Ci50YWctZ3JleXtiYWNrZ3JvdW5kOiMyYTMzNDI7Y29sb3I6IzhhOTlhYX0KLnNvcnQtYnRuc3tkaXNwbGF5OmZsZXg7Z2FwOjZweDtmbGV4LXNocmluazowfQouc29ydC1idG57d2lkdGg6MzRweDtoZWlnaHQ6MzRweDtib3JkZXItcmFkaXVzOjEwcHg7YmFja2dyb3VuZDojMWMyOTNiO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTZweDtjb2xvcjojYzVkMmUyO3VzZXItc2VsZWN0Om5vbmV9Ci5zb3J0LWJ0bjphY3RpdmV7YmFja2dyb3VuZDojMmEzYTUyfQouc29ydC1idG4uZGlzYWJsZWR7b3BhY2l0eTouMztwb2ludGVyLWV2ZW50czpub25lfQoubnVtLWdyaWR7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoNCwxZnIpO2dhcDoxMHB4O21hcmdpbi1ib3R0b206MTRweH0KLm51bS1pdGVte2JhY2tncm91bmQ6IzFmMmY0NDtwYWRkaW5nOjEycHggNnB4O2JvcmRlci1yYWRpdXM6MTJweDt0ZXh0LWFsaWduOmNlbnRlcn0KLm51bS12YWx7Zm9udC1zaXplOjIycHg7Zm9udC13ZWlnaHQ6Ym9sZH0KLm51bS1kZXNje2ZvbnQtc2l6ZToxMXB4O2NvbG9yOiM5OWE4Yjg7bWFyZ2luLXRvcDozcHh9Ci5wcm9ncmVzcy13cmFwe21hcmdpbi1ib3R0b206MTJweH0KLnByb2dyZXNzLXRpdGxle2ZvbnQtc2l6ZToxNHB4O21hcmdpbi1ib3R0b206NnB4O2Rpc3BsYXk6ZmxleDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjthbGlnbi1pdGVtczpjZW50ZXJ9Ci5wcm9ncmVzcy1iYXJ7d2lkdGg6MTAwJTtoZWlnaHQ6MTJweDtiYWNrZ3JvdW5kOiMyODM5NTA7Ym9yZGVyLXJhZGl1czo5OTlweDtvdmVyZmxvdzpoaWRkZW59Ci5wcm9ncmVzcy1maWxse2hlaWdodDoxMDAlO2JhY2tncm91bmQ6I2E4N2JmZjtib3JkZXItcmFkaXVzOjk5OXB4O3RyYW5zaXRpb246d2lkdGggLjNzfQouY291bnRkb3duLWxpbmV7Zm9udC1zaXplOjEzcHg7bWFyZ2luOjEwcHggMDtwYWRkaW5nOjhweCAxMnB4O2JvcmRlci1yYWRpdXM6MTBweDtiYWNrZ3JvdW5kOiMxZjJmNDQ7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OHB4fQouY291bnRkb3duLWxpbmUgLmNkLXZhbHtmb250LXdlaWdodDpib2xkO2NvbG9yOiNmZmQxNjY7Zm9udC12YXJpYW50LW51bWVyaWM6dGFidWxhci1udW1zfQouY291bnRkb3duLWxpbmUucmVhZHl7YmFja2dyb3VuZDojMTk0YzQ3O2NvbG9yOiM0MmUyOTl9Ci5jYWxlbmRhci1yb3d7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoNywxZnIpO2dhcDo4cHh9Ci5jLWRheXthc3BlY3QtcmF0aW86MS8xO2JhY2tncm91bmQ6IzFmMmY0NDtib3JkZXItcmFkaXVzOjEwcHg7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmb250LXNpemU6MTJweDtjb2xvcjojOGE5OWFhfQouYy1kYXkuY2hlY2tlZHtiYWNrZ3JvdW5kOiMxYzRiNTg7Y29sb3I6IzM3ZDBlODtmb250LXdlaWdodDpib2xkfQoudGFiLWJhcntwb3NpdGlvbjpmaXhlZDtsZWZ0OjA7cmlnaHQ6MDtib3R0b206MDtiYWNrZ3JvdW5kOiMxMzFlMmY7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczoxZnIgMWZyIDFmcjtwYWRkaW5nOjEwcHggMDt6LWluZGV4OjEwfQoudGFiLWl0ZW17dGV4dC1hbGlnbjpjZW50ZXI7Zm9udC1zaXplOjE0cHg7cGFkZGluZzo2cHggMDtjb2xvcjojODg5OWFhO2N1cnNvcjpwb2ludGVyfQoudGFiLWl0ZW0uYWN0aXZle2NvbG9yOiMzN2QwZTh9Ci5sb2ctaXRlbXtwYWRkaW5nOjEwcHg7YmFja2dyb3VuZDojMTcyNDM2O2JvcmRlci1yYWRpdXM6MTBweDttYXJnaW4tYm90dG9tOjhweDtmb250LXNpemU6MTNweDtjb2xvcjojYzVkMmUyO3dvcmQtYnJlYWs6YnJlYWstYWxsO3doaXRlLXNwYWNlOnByZS13cmFwfQouc2V0dGluZy1ibG9ja3tiYWNrZ3JvdW5kOiMxNzI0MzY7Ym9yZGVyLXJhZGl1czoxNHB4O3BhZGRpbmc6MTZweDttYXJnaW4tYm90dG9tOjE0cHh9Ci5zZXR0aW5nLXRpdGxle2ZvbnQtc2l6ZToxNnB4O21hcmdpbi1ib3R0b206MTJweDtmb250LXdlaWdodDpib2xkfQouY2ZnLXJvd3tkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO3BhZGRpbmc6MTFweCAwO2JvcmRlci1ib3R0b206MXB4IHNvbGlkICMxZjJmNDQ7Zm9udC1zaXplOjE0cHg7Z2FwOjEycHh9Ci5jZmctcm93Omxhc3Qtb2YtdHlwZXtib3JkZXItYm90dG9tOm5vbmV9Ci5jZmctbGFiZWx7Y29sb3I6I2M1ZDJlMjtmbGV4LXNocmluazowfQouY2ZnLWhpbnR7Zm9udC1zaXplOjExcHg7Y29sb3I6IzhhOTlhYTttYXJnaW4tdG9wOjRweDtsaW5lLWhlaWdodDoxLjV9Ci5jZmctaW5wdXR7d2lkdGg6NTYlO21pbi13aWR0aDowO2JhY2tncm91bmQ6IzFmMmY0NDtib3JkZXI6MXB4IHNvbGlkICMyYTNhNTI7Ym9yZGVyLXJhZGl1czo4cHg7Y29sb3I6I2U4ZWRmMztwYWRkaW5nOjhweCAxMHB4O2ZvbnQtc2l6ZToxMnB4O291dGxpbmU6bm9uZX0KLmNmZy1pbnB1dDpmb2N1c3tib3JkZXItY29sb3I6IzIzYzZkZX0KLnN3aXRjaHtwb3NpdGlvbjpyZWxhdGl2ZTt3aWR0aDo0OHB4O2hlaWdodDoyOHB4O2ZsZXgtc2hyaW5rOjB9Ci5zd2l0Y2ggaW5wdXR7b3BhY2l0eTowO3dpZHRoOjA7aGVpZ2h0OjB9Ci5zbGlkZXJ7cG9zaXRpb246YWJzb2x1dGU7Y3Vyc29yOnBvaW50ZXI7dG9wOjA7bGVmdDowO3JpZ2h0OjA7Ym90dG9tOjA7YmFja2dyb3VuZDojMmEzYTUyO2JvcmRlci1yYWRpdXM6OTk5cHg7dHJhbnNpdGlvbjouMnN9Ci5zbGlkZXI6YmVmb3Jle2NvbnRlbnQ6IiI7cG9zaXRpb246YWJzb2x1dGU7aGVpZ2h0OjIycHg7d2lkdGg6MjJweDtsZWZ0OjNweDt0b3A6M3B4O2JhY2tncm91bmQ6I2U4ZWRmMztib3JkZXItcmFkaXVzOjUwJTt0cmFuc2l0aW9uOi4yc30KLnN3aXRjaCBpbnB1dDpjaGVja2VkICsgLnNsaWRlcntiYWNrZ3JvdW5kOiMyM2M2ZGV9Ci5zd2l0Y2ggaW5wdXQ6Y2hlY2tlZCArIC5zbGlkZXI6YmVmb3Jle3RyYW5zZm9ybTp0cmFuc2xhdGVYKDIwcHgpfQouYmFyay1yb3d7ZGlzcGxheTpmbGV4O2dhcDo4cHg7YWxpZ24taXRlbXM6Y2VudGVyO21hcmdpbi1ib3R0b206MTBweH0KLmJhcmstcm93IC5iYXJrLWlke3dpZHRoOjgwcHg7ZmxleC1zaHJpbms6MDttaW4td2lkdGg6MH0KLmJhcmstcm93IC5iYXJrLW5hbWV7Zm9udC1zaXplOjEzcHg7Zm9udC13ZWlnaHQ6Ym9sZDtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpczt3aGl0ZS1zcGFjZTpub3dyYXB9Ci5iYXJrLXJvdyAuYmFyay1zdWJ7Zm9udC1zaXplOjExcHg7Y29sb3I6IzhhOTlhYTtvdmVyZmxvdzpoaWRkZW47dGV4dC1vdmVyZmxvdzplbGxpcHNpczt3aGl0ZS1zcGFjZTpub3dyYXB9Ci5iYXJrLXJvdyBpbnB1dHtmbGV4OjE7bWluLXdpZHRoOjA7YmFja2dyb3VuZDojMWYyZjQ0O2JvcmRlcjoxcHggc29saWQgIzJhM2E1Mjtib3JkZXItcmFkaXVzOjEwcHg7Y29sb3I6I2U4ZWRmMztwYWRkaW5nOjlweCAxMnB4O2ZvbnQtc2l6ZToxM3B4O291dGxpbmU6bm9uZX0KLmJhcmstcm93IGlucHV0OmZvY3Vze2JvcmRlci1jb2xvcjojMjNjNmRlfQouYnRue3BhZGRpbmc6OXB4IDE0cHg7Ym9yZGVyLXJhZGl1czoxMHB4O2JvcmRlcjpub25lO2N1cnNvcjpwb2ludGVyO2ZvbnQtc2l6ZToxM3B4O3doaXRlLXNwYWNlOm5vd3JhcH0KLmJ0bi1wcmltYXJ5e2JhY2tncm91bmQ6IzIzYzZkZTtjb2xvcjojMGIxNDIyO2ZvbnQtd2VpZ2h0OmJvbGR9Ci5idG4tZ2hvc3R7YmFja2dyb3VuZDojMWYyZjQ0O2NvbG9yOiNjNWQyZTJ9Ci5leHBvcnQtYXJlYXt3aWR0aDoxMDAlO2hlaWdodDoxNjBweDtiYWNrZ3JvdW5kOiMwYjE0MjI7Ym9yZGVyOjFweCBzb2xpZCAjMmEzYTUyO2JvcmRlci1yYWRpdXM6MTBweDtjb2xvcjojN2VlMGEzO2ZvbnQtZmFtaWx5Ok1lbmxvLENvbnNvbGFzLG1vbm9zcGFjZTtmb250LXNpemU6MTJweDtwYWRkaW5nOjEwcHg7Ym94LXNpemluZzpib3JkZXItYm94O3Jlc2l6ZTp2ZXJ0aWNhbDttYXJnaW4tdG9wOjEwcHh9Ci50b2FzdHtwb3NpdGlvbjpmaXhlZDtsZWZ0OjUwJTtib3R0b206OTBweDt0cmFuc2Zvcm06dHJhbnNsYXRlWCgtNTAlKTtiYWNrZ3JvdW5kOiMxYzI5M2I7Y29sb3I6I2U4ZWRmMztwYWRkaW5nOjEwcHggMThweDtib3JkZXItcmFkaXVzOjEycHg7Zm9udC1zaXplOjEzcHg7ei1pbmRleDo5OTtvcGFjaXR5OjA7dHJhbnNpdGlvbjpvcGFjaXR5IC4yNXM7cG9pbnRlci1ldmVudHM6bm9uZTttYXgtd2lkdGg6ODAlO3RleHQtYWxpZ246Y2VudGVyfQoudG9hc3Quc2hvd3tvcGFjaXR5OjF9Ci5lbXB0eXtwYWRkaW5nOjMwcHggMDt0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjojOGE5OWFhfQoucm93LXRpdGxle2Rpc3BsYXk6ZmxleDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjthbGlnbi1pdGVtczpjZW50ZXI7bWFyZ2luOjIwcHggMCAxMnB4O2ZvbnQtc2l6ZToxNnB4fQo8L3N0eWxlPgo8L2hlYWQ+Cjxib2R5Pgo8ZGl2IGlkPSJhcHAiPjwvZGl2Pgo8ZGl2IGNsYXNzPSJ0YWItYmFyIj4KICA8ZGl2IGNsYXNzPSJ0YWItaXRlbSBhY3RpdmUiIGRhdGEtcGFnZT0iaG9tZSI+8J+PoCDpppbpobU8L2Rpdj4KICA8ZGl2IGNsYXNzPSJ0YWItaXRlbSIgZGF0YS1wYWdlPSJsb2ciPuKYsCDml6Xlv5c8L2Rpdj4KICA8ZGl2IGNsYXNzPSJ0YWItaXRlbSIgZGF0YS1wYWdlPSJzZXR0aW5nIj7impkg6K6+572uPC9kaXY+CjwvZGl2Pgo8ZGl2IGNsYXNzPSJ0b2FzdCIgaWQ9InRvYXN0Ij48L2Rpdj4KPHNjcmlwdD4KY29uc3QgREVGQVVMVF9ET01BSU4gPSAiaHR0cHM6Ly9hcGktemVlaG8uZXhhbXBsZS5jb20iOwpjb25zdCBBcHAgPSB7CiAgc3RhdGU6IHsKICAgIHBhZ2U6ICJob21lIiwKICAgIGFjY291bnRMaXN0OiBbXSwKICAgIG5vQW5pbTogZmFsc2UsCiAgICBsb2dMaXN0OiBbXSwKICAgIHZlcnNpb246ICJWMi4xNCIsCiAgICBjb25maWc6IHsgc2lnbmluRW5hYmxlZDogdHJ1ZSwgYmxpbmRCb3hBdXRvOiB0cnVlLCBiYXJrTm90aWZ5OiB0cnVlLCBzaWduaW5UaW1lOiAiMDg6MzAiLCBhcGlEb21haW46IERFRkFVTFRfRE9NQUlOIH0KICB9LAogIHRvYXN0VGltZXI6IG51bGwsCiAgX2NkVGltZXI6IG51bGwsCgogIHRvYXN0KG1zZykgewogICAgY29uc3QgdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJ0b2FzdCIpOwogICAgaWYgKCF0KSByZXR1cm47CiAgICB0LnRleHRDb250ZW50ID0gbXNnOwogICAgdC5jbGFzc0xpc3QuYWRkKCJzaG93Iik7CiAgICBjbGVhclRpbWVvdXQodGhpcy50b2FzdFRpbWVyKTsKICAgIHRoaXMudG9hc3RUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4gdC5jbGFzc0xpc3QucmVtb3ZlKCJzaG93IiksIDE4MDApOwogIH0sCgogIGFzeW5jIGluaXREYXRhKCkgewogICAgYXdhaXQgUHJvbWlzZS5hbGwoW3RoaXMuZmV0Y2hBbGxBY2NvdW50cygpLCB0aGlzLmZldGNoQ29uZmlnKCksIHRoaXMuZmV0Y2hMb2dzKCldKTsKICAgIHRoaXMucmVuZGVyKCk7CiAgfSwKCiAgYXN5bmMgcmVmcmVzaEFsbCgpIHsKICAgIHRoaXMuc3RhdGUubm9BbmltID0gdHJ1ZTsKICAgIGF3YWl0IFByb21pc2UuYWxsKFt0aGlzLmZldGNoQWxsQWNjb3VudHMoKSwgdGhpcy5mZXRjaENvbmZpZygpLCB0aGlzLmZldGNoTG9ncygpXSk7CiAgICB0aGlzLnJlbmRlcigpOwogIH0sCgogIGFzeW5jIGZldGNoQWxsQWNjb3VudHMoKSB7CiAgICB0cnkgewogICAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCgiL2FwaS9kYXRhIik7CiAgICAgIGNvbnN0IGpzb24gPSBhd2FpdCByZXMuanNvbigpOwogICAgICBpZiAoanNvbi5vaykgewogICAgICAgIHRoaXMuc3RhdGUuYWNjb3VudExpc3QgPSBqc29uLmFjY291bnRzIHx8IFtdOwogICAgICAgIGlmIChqc29uLnZlcnNpb24pIHRoaXMuc3RhdGUudmVyc2lvbiA9IGpzb24udmVyc2lvbjsKICAgICAgfSBlbHNlIHsKICAgICAgICB0aGlzLnRvYXN0KGpzb24ubXNnIHx8ICLmlbDmja7liqDovb3lpLHotKUiKTsKICAgICAgfQogICAgfSBjYXRjaCAoZSkgewogICAgICBjb25zb2xlLmVycm9yKCLojrflj5botKblj7fmlbDmja7lpLHotKUiLCBlKTsKICAgICAgdGhpcy50b2FzdCgi5peg5rOV6L+e5o6l6ISa5pys5ZCO56uv77yM6K+356Gu6K6k5bey5ZyoIExvb24g5Lit5ZCv55So6Z2i5p2/5oum5oiqIik7CiAgICB9CiAgfSwKCiAgYXN5bmMgZmV0Y2hDb25maWcoKSB7CiAgICB0cnkgewogICAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCgiL2FwaS9jb25maWciKTsKICAgICAgY29uc3QganNvbiA9IGF3YWl0IHJlcy5qc29uKCk7CiAgICAgIGlmIChqc29uLm9rKSB0aGlzLnN0YXRlLmNvbmZpZyA9IE9iamVjdC5hc3NpZ24oe30sIHRoaXMuc3RhdGUuY29uZmlnLCBqc29uLmNvbmZpZyB8fCB7fSk7CiAgICB9IGNhdGNoIChlKSB7CiAgICAgIGNvbnNvbGUuZXJyb3IoIuiOt+WPlumFjee9ruWksei0pSIsIGUpOwogICAgfQogIH0sCgogIGFzeW5jIGZldGNoTG9ncygpIHsKICAgIHRyeSB7CiAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKCIvYXBpL2xvZ3MiKTsKICAgICAgY29uc3QganNvbiA9IGF3YWl0IHJlcy5qc29uKCk7CiAgICAgIGlmIChqc29uLm9rKSB0aGlzLnN0YXRlLmxvZ0xpc3QgPSBqc29uLmxvZ3MgfHwgW107CiAgICB9IGNhdGNoIChlKSB7CiAgICAgIGNvbnNvbGUuZXJyb3IoIuiOt+WPluaXpeW/l+Wksei0pSIsIGUpOwogICAgfQogIH0sCgogIHJlbmRlcigpIHsKICAgIGNvbnN0IGFwcCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJhcHAiKTsKICAgIGFwcC5jbGFzc0xpc3QudG9nZ2xlKCJuby1hbmltIiwgdGhpcy5zdGF0ZS5ub0FuaW0pOwogICAgc3dpdGNoICh0aGlzLnN0YXRlLnBhZ2UpIHsKICAgICAgY2FzZSAiaG9tZSI6IHRoaXMucmVuZGVySG9tZSgpOyBicmVhazsKICAgICAgY2FzZSAibG9nIjogdGhpcy5yZW5kZXJMb2coKTsgYnJlYWs7CiAgICAgIGNhc2UgInNldHRpbmciOiB0aGlzLnJlbmRlclNldHRpbmcoKTsgYnJlYWs7CiAgICB9CiAgICBpZiAodGhpcy5zdGF0ZS5wYWdlID09PSAiaG9tZSIpIHRoaXMuc3RhcnRDb3VudGRvd24oKTsKICB9LAoKICBpc1NpZ25lZFRvZGF5KGFjYykgewogICAgY29uc3QgcjcgPSBhY2MucmVjZW50NyB8fCBbXTsKICAgIGlmIChyNy5sZW5ndGgpIHsKICAgICAgY29uc3QgbGFzdCA9IHI3W3I3Lmxlbmd0aCAtIDFdOwogICAgICBpZiAobGFzdCAmJiBsYXN0Lm9rKSByZXR1cm4gdHJ1ZTsKICAgIH0KICAgIHJldHVybiBOdW1iZXIoYWNjLnRvZGF5U2NvcmUgfHwgMCkgPiAwOwogIH0sCgogIGFzeW5jIG1vdmVBY2NvdW50KGtleSwgZGVsdGEpIHsKICAgIGNvbnN0IGxpc3QgPSB0aGlzLnN0YXRlLmFjY291bnRMaXN0OwogICAgY29uc3QgaSA9IGxpc3QuZmluZEluZGV4KGEgPT4gYS5rZXkgPT09IGtleSk7CiAgICBjb25zdCBqID0gaSArIGRlbHRhOwogICAgaWYgKGkgPCAwIHx8IGogPCAwIHx8IGogPj0gbGlzdC5sZW5ndGgpIHJldHVybjsKICAgIGNvbnN0IGFyciA9IGxpc3Quc2xpY2UoKTsKICAgIGNvbnN0IHRtcCA9IGFycltpXTsgYXJyW2ldID0gYXJyW2pdOyBhcnJbal0gPSB0bXA7CiAgICB0aGlzLnN0YXRlLmFjY291bnRMaXN0ID0gYXJyOwogICAgdGhpcy5yZW5kZXJIb21lKCk7CiAgICB0cnkgewogICAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCgiL2FwaS9zb3J0IiwgewogICAgICAgIG1ldGhvZDogIlBPU1QiLAogICAgICAgIGhlYWRlcnM6IHsgIkNvbnRlbnQtVHlwZSI6ICJhcHBsaWNhdGlvbi9qc29uIiB9LAogICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsga2V5czogYXJyLm1hcChhID0+IGEua2V5KSB9KQogICAgICB9KTsKICAgICAgY29uc3QganNvbiA9IGF3YWl0IHJlcy5qc29uKCk7CiAgICAgIHRoaXMudG9hc3QoanNvbi5vayA/ICLmjpLluo/lt7Lkv53lrZgiIDogIuaOkuW6j+S/neWtmOWksei0pSIpOwogICAgfSBjYXRjaCAoZSkgewogICAgICB0aGlzLnRvYXN0KCLmjpLluo/kv53lrZjlpLHotKUiKTsKICAgIH0KICB9LAoKICByZW5kZXJIb21lKCkgewogICAgY29uc3QgYXBwID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImFwcCIpOwogICAgY29uc3QgbGlzdCA9IHRoaXMuc3RhdGUuYWNjb3VudExpc3Q7CiAgICBsZXQgdG90YWxTY29yZSA9IDAsIGJpbmRDYXIgPSAwLCB0b2tlbk9rID0gMDsKICAgIGxpc3QuZm9yRWFjaChhY2MgPT4gewogICAgICB0b3RhbFNjb3JlICs9IE51bWJlcihhY2Muc2NvcmUgfHwgMCk7CiAgICAgIGlmIChhY2MudG9rZW5TdGF0dXMpIHRva2VuT2srKzsKICAgICAgYmluZENhciArPSBOdW1iZXIoYWNjLmNhckNvdW50IHx8IDApOwogICAgfSk7CiAgICBjb25zdCBzaWduZWRUb2RheSA9IGxpc3QuZmlsdGVyKGEgPT4gdGhpcy5pc1NpZ25lZFRvZGF5KGEpKS5sZW5ndGg7CiAgICBjb25zdCBzaWduU3RhdGUgPSB0aGlzLnN0YXRlLmNvbmZpZy5zaWduaW5FbmFibGVkID8gIuW3suW8gOWQryIgOiAi5bey5YWz6ZetIjsKICAgIGxldCBjYXJkcyA9ICIiOwogICAgaWYgKGxpc3QubGVuZ3RoKSB7CiAgICAgIGNhcmRzID0gbGlzdC5tYXAoKGEsIGkpID0+IHRoaXMucmVuZGVyQWNjb3VudENhcmQoYSwgaSwgbGlzdCkpLmpvaW4oIiIpOwogICAgfSBlbHNlIHsKICAgICAgY2FyZHMgPSAnPGRpdiBjbGFzcz0iZW1wdHkiPuaaguaXoOi0puWPt+aVsOaNrjxici8+6K+35YWI5Zyo5a6i5oi356uv5LiK5Lyg6YWN572uPGJyLz48c3BhbiBzdHlsZT0iZm9udC1zaXplOjEycHgiPnplZWhvLmJveC9hcGkvcXVpY2stc2F2ZT9uYW1lPXh4JnRva2VuPXh4JmJhcmtLZXk9eHg8L3NwYW4+PC9kaXY+JzsKICAgIH0KICAgIGxldCBodG1sID0gYAo8ZGl2IGNsYXNzPSJoZWFkZXIiPgogIDxkaXYgY2xhc3M9ImxvZ28iPlo8L2Rpdj4KICA8ZGl2IGNsYXNzPSJ0aXRsZS1ncm91cCI+CiAgICA8aDE+5p6B5qC4IFpFRUhPPHNwYW4gY2xhc3M9ImJhZGdlLWxpdGUiPkxJVEUgJHt0aGlzLnN0YXRlLnZlcnNpb259PC9zcGFuPjwvaDE+CiAgICA8ZGl2IGNsYXNzPSJzdWJ0aXRsZSI+562+5YiwIMK3IOi9pui+hiDCtyDmjqfovaY8L2Rpdj4KICA8L2Rpdj4KICA8ZGl2IGNsYXNzPSJyZWZyZXNoLWljb24iIG9uY2xpY2s9IkFwcC5yZWZyZXNoQWxsKCkiPuKfszwvZGl2Pgo8L2Rpdj4KPGRpdiBjbGFzcz0iYmlnLWNhcmQiPgogIDxkaXYgc3R5bGU9ImZvbnQtc2l6ZToxNnB4O2NvbG9yOiM5OWE4YjgiPui0puWPt+aAu+enr+WIhjwvZGl2PgogIDxkaXYgc3R5bGU9ImZvbnQtc2l6ZTo2MHB4O2ZvbnQtd2VpZ2h0OmJvbGQ7Y29sb3I6IzM3ZDBlODttYXJnaW46NnB4IDAiPiR7dG90YWxTY29yZS50b0xvY2FsZVN0cmluZygpfTwvZGl2PgogIDxkaXYgc3R5bGU9InRleHQtYWxpZ246cmlnaHQ7Y29sb3I6IzQyZTI5OSI+5LuK5pel5bey562+5YiwICR7c2lnbmVkVG9kYXl9LyR7bGlzdC5sZW5ndGh9PC9kaXY+CiAgPGRpdiBjbGFzcz0ic3RhdC1yb3ciPgogICAgPGRpdiBjbGFzcz0ic3RhdC1jYXJkIj48ZGl2IGNsYXNzPSJzdGF0LW51bSI+JHtiaW5kQ2FyfTwvZGl2PjxkaXYgY2xhc3M9InN0YXQtbGFiZWwiPue7keWumui9pui+hjwvZGl2PjwvZGl2PgogICAgPGRpdiBjbGFzcz0ic3RhdC1jYXJkIj48ZGl2IGNsYXNzPSJzdGF0LW51bSI+JHt0b2tlbk9rfTwvZGl2PjxkaXYgY2xhc3M9InN0YXQtbGFiZWwiPlRva2VuIOato+W4uDwvZGl2PjwvZGl2PgogIDwvZGl2Pgo8L2Rpdj4KPGRpdiBjbGFzcz0icGFuZWwtZGVzYyI+6Z2i5p2/5qih5byP77ya5pWw5o2u55Sx5pys5py66ISa5pys5ZCO56uv562+5ZCN5LiO6I635Y+WIMK3ICR7dGhpcy5zdGF0ZS52ZXJzaW9ufTxici8+5a6a5pe2562+5Yiw77yaJHtzaWduU3RhdGV9JHt0aGlzLnN0YXRlLmNvbmZpZy5zaWduaW5UaW1lID8gIiDCtyDmr4/lpKkgIiArIHRoaXMuc3RhdGUuY29uZmlnLnNpZ25pblRpbWUgOiAiIn08L2Rpdj4KPGRpdiBjbGFzcz0icm93LXRpdGxlIj48c3Bhbj7wn5qXIOi0puWPt+eKtuaAgTwvc3Bhbj48c3BhbiBzdHlsZT0iZm9udC1zaXplOjEycHg7Y29sb3I6IzhhOTlhYSI+5YWxICR7bGlzdC5sZW5ndGh9IOS4qui0puWPtyDCtyDljaHniYflj7Pkvqcg4oaR4oaTIOaJi+WKqOaOkuW6jzwvc3Bhbj48L2Rpdj4KJHtjYXJkc31gOwogICAgYXBwLmlubmVySFRNTCA9IGh0bWw7CiAgfSwKCiAgcmVuZGVyQWNjb3VudENhcmQoYSwgaSwgbGlzdCkgewogICAgY29uc3QgaW52YWxpZCA9ICFhLnRva2VuU3RhdHVzOwogICAgY29uc3Qgc2lnbmVkID0gdGhpcy5pc1NpZ25lZFRvZGF5KGEpOwogICAgY29uc3QgYXZhdGFyID0gYS5hdmF0YXJVcmwKICAgICAgPyBgPGltZyBzcmM9IiR7YS5hdmF0YXJVcmx9IiBhbHQ9IiIgbG9hZGluZz0ibGF6eSIvPmAKICAgICAgOiBgPHNwYW4+JHsoYS5uYW1lIHx8ICJMIilbMF0udG9VcHBlckNhc2UoKX08L3NwYW4+YDsKICAgIGNvbnN0IGJ0ID0gTnVtYmVyKGEuYmxpbmRUb3RhbCB8fCAzMCk7CiAgICBjb25zdCBibiA9IE51bWJlcihhLmJsaW5kTm93IHx8IDApOwogICAgY29uc3QgYnIgPSBhLmJsaW5kUmVtYWluICE9IG51bGwgPyBOdW1iZXIoYS5ibGluZFJlbWFpbikgOiBNYXRoLm1heCgwLCBidCAtIGJuKTsKICAgIGNvbnN0IHBjdCA9IGJ0ID8gTWF0aC5taW4oMTAwLCBNYXRoLnJvdW5kKGJuIC8gYnQgKiAxMDApKSA6IDA7CiAgICBjb25zdCBjYW5EcmF3ID0gYnIgPD0gMDsKICAgIGxldCBjYWwgPSAiIjsKICAgIChhLnJlY2VudDcgfHwgW10pLmZvckVhY2goZCA9PiB7IGNhbCArPSBgPGRpdiBjbGFzcz0iYy1kYXkgJHtkLm9rID8gImNoZWNrZWQiIDogIiJ9Ij4ke2QuZGF5fTwvZGl2PmA7IH0pOwogICAgaWYgKCFjYWwpIGNhbCA9ICc8ZGl2IGNsYXNzPSJlbXB0eSIgc3R5bGU9ImdyaWQtY29sdW1uOjEvLTE7cGFkZGluZzoxMnB4IDAiPuaaguaXoOetvuWIsOiusOW9lTwvZGl2Pic7CiAgICBjb25zdCBmaXJzdCA9IGkgPT09IDAsIGxhc3QgPSBpID09PSBsaXN0Lmxlbmd0aCAtIDE7CiAgICBjb25zdCB0YWdUb2tlbiA9IGludmFsaWQKICAgICAgPyAoYS5lcnJUeXBlID09PSAibmV0IiA/IGA8c3BhbiBjbGFzcz0idGFnIHRhZy1vcmFuZ2UiPuiOt+WPluWksei0pTwvc3Bhbj5gIDogYDxzcGFuIGNsYXNzPSJ0YWcgdGFnLXJlZCI+VG9rZW4g5aSx5pWIPC9zcGFuPmApCiAgICAgIDogYDxzcGFuIGNsYXNzPSJ0YWcgdGFnLWJsdWUiPlRva2VuIOato+W4uDwvc3Bhbj5gOwogICAgY29uc3QgdGFnU2lnbiA9IHNpZ25lZCA/IGA8c3BhbiBjbGFzcz0idGFnIHRhZy1ncmVlbiI+5bey562+5YiwPC9zcGFuPmAgOiBgPHNwYW4gY2xhc3M9InRhZyB0YWctZ3JleSI+5pyq562+5YiwPC9zcGFuPmA7CiAgICBjb25zdCBjZExpbmUgPSBjYW5EcmF3CiAgICAgID8gYDxkaXYgY2xhc3M9ImNvdW50ZG93bi1saW5lIHJlYWR5Ij7wn46BIOebsuebkuW3suWwsee7qiDCtyDku4rml6Xlj6/mir3nm7Lnm5I8L2Rpdj5gCiAgICAgIDogYDxkaXYgY2xhc3M9ImNvdW50ZG93bi1saW5lIj7wn46BIDxzcGFuPui3neebsuebkuino+mUgTwvc3Bhbj48c3BhbiBzdHlsZT0ibWFyZ2luLWxlZnQ6YXV0byIgY2xhc3M9ImNkLXZhbCIgZGF0YS1yZW09IiR7YnJ9Ij4ke2JyfeWkqSAtLTotLTotLTwvc3Bhbj48L2Rpdj5gOwogICAgcmV0dXJuIGAKPGRpdiBjbGFzcz0iYmlnLWNhcmQgJHtpbnZhbGlkID8gImNhcmQtaW52YWxpZCIgOiAiIn0iPgogIDxkaXYgY2xhc3M9ImFjY291bnQtaGVhZGVyIj4KICAgIDxkaXYgY2xhc3M9ImF2YXRhci1ib3giPiR7YXZhdGFyfTwvZGl2PgogICAgPGRpdiBjbGFzcz0ibmFtZS1pZCAke2ludmFsaWQgPyAibmFtZS1pbnZhbGlkIiA6ICIifSI+CiAgICAgIDxoMz4ke2EubmFtZSB8fCAiLS0ifTwvaDM+CiAgICAgIDxkaXYgY2xhc3M9InVpZCI+SUQgJHthLnVpZCB8fCAoYS5rZXkgPyBhLmtleS5zbGljZSgwLCA4KSA6ICItLSIpfTwvZGl2PgogICAgPC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJ0YWctZ3JvdXAiPiR7dGFnVG9rZW59JHt0YWdTaWdufTwvZGl2PgogICAgPGRpdiBjbGFzcz0ic29ydC1idG5zIj4KICAgICAgPGRpdiBjbGFzcz0ic29ydC1idG4gJHtmaXJzdCA/ICJkaXNhYmxlZCIgOiAiIn0iIG9uY2xpY2s9IkFwcC5tb3ZlQWNjb3VudCgnJHthLmtleX0nLC0xKSI+4oaRPC9kaXY+CiAgICAgIDxkaXYgY2xhc3M9InNvcnQtYnRuICR7bGFzdCA/ICJkaXNhYmxlZCIgOiAiIn0iIG9uY2xpY2s9IkFwcC5tb3ZlQWNjb3VudCgnJHthLmtleX0nLDEpIj7ihpM8L2Rpdj4KICAgIDwvZGl2PgogIDwvZGl2PgogIDxkaXYgY2xhc3M9Im51bS1ncmlkIj4KICAgIDxkaXYgY2xhc3M9Im51bS1pdGVtIj48ZGl2IGNsYXNzPSJudW0tdmFsIj4ke2Euc2NvcmUgfHwgMH08L2Rpdj48ZGl2IGNsYXNzPSJudW0tZGVzYyI+5oC756ev5YiGPC9kaXY+PC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJudW0taXRlbSI+PGRpdiBjbGFzcz0ibnVtLXZhbCI+KyR7YS50b2RheVNjb3JlIHx8IDB9PC9kaXY+PGRpdiBjbGFzcz0ibnVtLWRlc2MiPuS7iuaXpeenr+WIhjwvZGl2PjwvZGl2PgogICAgPGRpdiBjbGFzcz0ibnVtLWl0ZW0iPjxkaXYgY2xhc3M9Im51bS12YWwiPiR7YS5jb250aW51ZURheXMgfHwgMH08L2Rpdj48ZGl2IGNsYXNzPSJudW0tZGVzYyI+6L+e562+5aSp5pWwPC9kaXY+PC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJudW0taXRlbSI+PGRpdiBjbGFzcz0ibnVtLXZhbCI+JHticn08L2Rpdj48ZGl2IGNsYXNzPSJudW0tZGVzYyI+6Led55uy55uSKOWkqSk8L2Rpdj48L2Rpdj4KICA8L2Rpdj4KICA8ZGl2IGNsYXNzPSJwcm9ncmVzcy13cmFwIj4KICAgIDxkaXYgY2xhc3M9InByb2dyZXNzLXRpdGxlIj48c3Bhbj7nm7Lnm5Lov5vluqY8L3NwYW4+PHNwYW4+JHtibn0vJHtidH0gwrcgJHtwY3R9JTwvc3Bhbj48L2Rpdj4KICAgIDxkaXYgY2xhc3M9InByb2dyZXNzLWJhciI+PGRpdiBjbGFzcz0icHJvZ3Jlc3MtZmlsbCIgc3R5bGU9IndpZHRoOiR7cGN0fSUiPjwvZGl2PjwvZGl2PgogIDwvZGl2PgogICR7Y2RMaW5lfQogIDxkaXYgY2xhc3M9ImNhbGVuZGFyLXJvdyI+JHtjYWx9PC9kaXY+CjwvZGl2PmA7CiAgfSwKCiAgc3RhcnRDb3VudGRvd24oKSB7CiAgICBpZiAodGhpcy5fY2RUaW1lcikgcmV0dXJuOwogICAgY29uc3QgdXBkYXRlID0gKCkgPT4gewogICAgICBjb25zdCBlbHMgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCJbZGF0YS1yZW1dIik7CiAgICAgIGlmICghZWxzLmxlbmd0aCkgcmV0dXJuOwogICAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpOwogICAgICBjb25zdCBtaWQgPSBuZXcgRGF0ZShub3cpOwogICAgICBtaWQuc2V0SG91cnMoMjQsIDAsIDAsIDApOwogICAgICBsZXQgZGlmZiA9IG1pZCAtIG5vdzsKICAgICAgaWYgKGRpZmYgPCAwKSBkaWZmID0gMDsKICAgICAgY29uc3QgaCA9IFN0cmluZyhNYXRoLmZsb29yKGRpZmYgLyAzNjAwMDAwKSkucGFkU3RhcnQoMiwgIjAiKTsKICAgICAgY29uc3QgbSA9IFN0cmluZyhNYXRoLmZsb29yKGRpZmYgJSAzNjAwMDAwIC8gNjAwMDApKS5wYWRTdGFydCgyLCAiMCIpOwogICAgICBjb25zdCBzID0gU3RyaW5nKE1hdGguZmxvb3IoZGlmZiAlIDYwMDAwIC8gMTAwMCkpLnBhZFN0YXJ0KDIsICIwIik7CiAgICAgIGVscy5mb3JFYWNoKGVsID0+IHsgZWwudGV4dENvbnRlbnQgPSBlbC5kYXRhc2V0LnJlbSArICLlpKkgIiArIGggKyAiOiIgKyBtICsgIjoiICsgczsgfSk7CiAgICB9OwogICAgdXBkYXRlKCk7CiAgICB0aGlzLl9jZFRpbWVyID0gc2V0SW50ZXJ2YWwodXBkYXRlLCAxMDAwKTsKICB9LAoKICByZW5kZXJMb2coKSB7CiAgICBjb25zdCBhcHAgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiYXBwIik7CiAgICBsZXQgaHRtbCA9IGAKPGRpdiBjbGFzcz0iaGVhZGVyIj4KICA8ZGl2IGNsYXNzPSJsb2dvIj5aPC9kaXY+CiAgPGRpdiBjbGFzcz0idGl0bGUtZ3JvdXAiPgogICAgPGgxPuaTjeS9nOaXpeW/lzxzcGFuIGNsYXNzPSJiYWRnZS1saXRlIj5MSVRFICR7dGhpcy5zdGF0ZS52ZXJzaW9ufTwvc3Bhbj48L2gxPgogICAgPGRpdiBjbGFzcz0ic3VidGl0bGUiPuetvuWIsOiusOW9leOAgeaOpeWPo+i/lOWbnuaXpeW/lzwvZGl2PgogIDwvZGl2Pgo8L2Rpdj5gOwogICAgaWYgKHRoaXMuc3RhdGUubG9nTGlzdC5sZW5ndGgpIHsKICAgICAgaHRtbCArPSAnPGRpdiBzdHlsZT0iZm9udC1zaXplOjEycHg7Y29sb3I6IzhhOTlhYTttYXJnaW4tYm90dG9tOjEwcHgiPuacgOi/kSAnICsgdGhpcy5zdGF0ZS5sb2dMaXN0Lmxlbmd0aCArICcg5p2h77yIemVlaG9fbG9nc++8iTwvZGl2Pic7CiAgICAgIGh0bWwgKz0gdGhpcy5zdGF0ZS5sb2dMaXN0Lm1hcCh4ID0+IGA8ZGl2IGNsYXNzPSJsb2ctaXRlbSI+JHt4fTwvZGl2PmApLmpvaW4oIiIpOwogICAgfSBlbHNlIHsKICAgICAgaHRtbCArPSAnPGRpdiBjbGFzcz0ic2V0dGluZy1ibG9jayI+5pqC5peg5pel5b+XPGJyLz48c3BhbiBzdHlsZT0iZm9udC1zaXplOjEycHg7Y29sb3I6IzhhOTlhYSI+5a6a5pe2562+5Yiw5omn6KGM5ZCO5Lya6Ieq5Yqo5YaZ5YWl5pel5b+X77yM54K55Ye75Y+z5LiK6KeS5Yi35paw5Y+v6YeN5paw5ouJ5Y+W44CCPC9zcGFuPjwvZGl2Pic7CiAgICB9CiAgICBhcHAuaW5uZXJIVE1MID0gaHRtbDsKICB9LAoKICByZW5kZXJTZXR0aW5nKCkgewogICAgY29uc3QgYXBwID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImFwcCIpOwogICAgY29uc3QgY2ZnID0gdGhpcy5zdGF0ZS5jb25maWc7CiAgICBjb25zdCBsaXN0ID0gdGhpcy5zdGF0ZS5hY2NvdW50TGlzdDsKICAgIGxldCByb3dzID0gIiI7CiAgICBpZiAobGlzdC5sZW5ndGgpIHsKICAgICAgcm93cyA9IGxpc3QubWFwKGEgPT4gewogICAgICAgIGNvbnN0IGludmFsaWQgPSAhYS50b2tlblN0YXR1czsKICAgICAgICByZXR1cm4gYAo8ZGl2IGNsYXNzPSJiYXJrLXJvdyI+CiAgPGRpdiBjbGFzcz0iYmFyay1pZCI+CiAgICA8ZGl2IGNsYXNzPSJiYXJrLW5hbWUiIHN0eWxlPSIke2ludmFsaWQgPyAiY29sb3I6I2ZmNTQ3MCIgOiAiIn0iPiR7YS5uYW1lIHx8ICItLSJ9PC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJiYXJrLXN1YiI+JHthLnVpZCB8fCBhLmtleSB8fCAiIn08L2Rpdj4KICA8L2Rpdj4KICA8aW5wdXQgaWQ9ImJhcmstJHthLmtleX0iIHR5cGU9InRleHQiIHBsYWNlaG9sZGVyPSJCYXJrS2V577yI5Y+v6YCJ77yJIiB2YWx1ZT0iJHthLmJhcmtLZXkgfHwgIiJ9Ii8+CiAgPGJ1dHRvbiBjbGFzcz0iYnRuIGJ0bi1naG9zdCIgb25jbGljaz0iQXBwLnNhdmVCYXJrKCcke2Eua2V5fScpIj7kv53lrZg8L2J1dHRvbj4KICA8YnV0dG9uIGNsYXNzPSJidG4gYnRuLXByaW1hcnkiIG9uY2xpY2s9IkFwcC50ZXN0QmFyaygnJHthLmtleX0nKSI+5rWL6K+VPC9idXR0b24+CjwvZGl2PmA7CiAgICAgIH0pLmpvaW4oIiIpOwogICAgfSBlbHNlIHsKICAgICAgcm93cyA9ICc8ZGl2IGNsYXNzPSJlbXB0eSI+5pqC5peg6LSm5Y+35pWw5o2u77yM6K+35YWI5Zyo5a6i5oi356uv5LiK5Lyg6YWN572uPC9kaXY+JzsKICAgIH0KICAgIGFwcC5pbm5lckhUTUwgPSBgCjxkaXYgY2xhc3M9ImhlYWRlciI+CiAgPGRpdiBjbGFzcz0ibG9nbyI+WjwvZGl2PgogIDxkaXYgY2xhc3M9InRpdGxlLWdyb3VwIj4KICAgIDxoMT7orr7nva48c3BhbiBjbGFzcz0iYmFkZ2UtbGl0ZSI+TElURSAke3RoaXMuc3RhdGUudmVyc2lvbn08L3NwYW4+PC9oMT4KICAgIDxkaXYgY2xhc3M9InN1YnRpdGxlIj7nrb7liLDphY3nva4gwrcg6LSm5Y+3566h55CGIMK3IOWvvOWHuiBUb2tlbjwvZGl2PgogIDwvZGl2Pgo8L2Rpdj4KPGRpdiBjbGFzcz0ic2V0dGluZy1ibG9jayI+CiAgPGRpdiBjbGFzcz0ic2V0dGluZy10aXRsZSI+562+5Yiw6YWN572uPC9kaXY+CiAgPGRpdiBjbGFzcz0iY2ZnLXJvdyI+CiAgICA8c3BhbiBjbGFzcz0iY2ZnLWxhYmVsIj7oh6rliqjnrb7liLA8L3NwYW4+CiAgICA8bGFiZWwgY2xhc3M9InN3aXRjaCI+PGlucHV0IHR5cGU9ImNoZWNrYm94IiBpZD0iY2ZnLXNpZ25pbiIgJHtjZmcuc2lnbmluRW5hYmxlZCA/ICJjaGVja2VkIiA6ICIifS8+PHNwYW4gY2xhc3M9InNsaWRlciI+PC9zcGFuPjwvbGFiZWw+CiAgPC9kaXY+CiAgPGRpdiBjbGFzcz0iY2ZnLXJvdyI+CiAgICA8c3BhbiBjbGFzcz0iY2ZnLWxhYmVsIj7nm7Lnm5Loh6rliqjmir3lj5Y8L3NwYW4+CiAgICA8bGFiZWwgY2xhc3M9InN3aXRjaCI+PGlucHV0IHR5cGU9ImNoZWNrYm94IiBpZD0iY2ZnLWJsaW5kIiAke2NmZy5ibGluZEJveEF1dG8gPyAiY2hlY2tlZCIgOiAiIn0vPjxzcGFuIGNsYXNzPSJzbGlkZXIiPjwvc3Bhbj48L2xhYmVsPgogIDwvZGl2PgogIDxkaXYgY2xhc3M9ImNmZy1yb3ciPgogICAgPHNwYW4gY2xhc3M9ImNmZy1sYWJlbCI+QmFyayDpgJrnn6U8L3NwYW4+CiAgICA8bGFiZWwgY2xhc3M9InN3aXRjaCI+PGlucHV0IHR5cGU9ImNoZWNrYm94IiBpZD0iY2ZnLWJhcmsiICR7Y2ZnLmJhcmtOb3RpZnkgPyAiY2hlY2tlZCIgOiAiIn0vPjxzcGFuIGNsYXNzPSJzbGlkZXIiPjwvc3Bhbj48L2xhYmVsPgogIDwvZGl2PgogIDxkaXYgY2xhc3M9ImNmZy1yb3ciPgogICAgPHNwYW4gY2xhc3M9ImNmZy1sYWJlbCI+562+5Yiw5pe26Ze077yI5Y+C6ICD77yJPC9zcGFuPgogICAgPGlucHV0IGNsYXNzPSJjZmctaW5wdXQiIGlkPSJjZmctdGltZSIgdmFsdWU9IiR7Y2ZnLnNpZ25pblRpbWUgfHwgIiJ9IiBwbGFjZWhvbGRlcj0i5aaCIDA4OjMwIi8+CiAgPC9kaXY+CiAgPGRpdiBjbGFzcz0iY2ZnLXJvdyI+CiAgICA8c3BhbiBjbGFzcz0iY2ZnLWxhYmVsIj7ku6PnkIblkI7nq6/lnLDlnYA8L3NwYW4+CiAgICA8aW5wdXQgY2xhc3M9ImNmZy1pbnB1dCIgaWQ9ImNmZy1kb21haW4iIHZhbHVlPSIke2NmZy5hcGlEb21haW4gfHwgREVGQVVMVF9ET01BSU59IiBwbGFjZWhvbGRlcj0iJHtERUZBVUxUX0RPTUFJTn0iLz4KICA8L2Rpdj4KICA8ZGl2IGNsYXNzPSJjZmctaGludCI+6YWN572u55Sx6Z2i5p2/5L+d5a2Y5YiwIHplZWhvX2NvbmZpZ++8jOWumuaXtuetvuWIsO+8iOWQjOS4gOiEmuacrOeahCBDUk9OIOaooeW8j++8ieiHquWKqOivu+WPluOAgkxvb24g5o+S5Lu25Lit55qEIGNyb24g5pe26Ze06ZyA5LiO5q2k5aSE44CM562+5Yiw5pe26Ze044CN5L+d5oyB5LiA6Ie044CCPC9kaXY+CiAgPGRpdiBzdHlsZT0ibWFyZ2luLXRvcDoxMnB4Ij48YnV0dG9uIGNsYXNzPSJidG4gYnRuLXByaW1hcnkiIG9uY2xpY2s9IkFwcC5zYXZlQ29uZmlnKCkiPuS/neWtmOetvuWIsOmFjee9rjwvYnV0dG9uPjwvZGl2Pgo8L2Rpdj4KPGRpdiBjbGFzcz0ic2V0dGluZy1ibG9jayI+CiAgPGRpdiBjbGFzcz0ic2V0dGluZy10aXRsZSI+6LSm5Y+3566h55CG77yIJHtsaXN0Lmxlbmd0aH3vvIk8L2Rpdj4KICA8ZGl2IHN0eWxlPSJmb250LXNpemU6MTJweDtjb2xvcjojOGE5OWFhO21hcmdpbi1ib3R0b206MTJweCI+5q+P5Liq6LSm5Y+35Y+v5Y2V54us6YWN572uIEJhcmtLZXnvvIhpT1Mg5o6o6YCB77yJ77yM5L+d5a2Y5ZCO5Y+v5Y+R6YCB5rWL6K+V5o6o6YCB44CCPC9kaXY+CiAgJHtyb3dzfQo8L2Rpdj4KPGRpdiBjbGFzcz0ic2V0dGluZy1ibG9jayI+CiAgPGRpdiBjbGFzcz0ic2V0dGluZy10aXRsZSI+5LiA6ZSu5a+85Ye6IFRva2VuPC9kaXY+CiAgPGRpdiBzdHlsZT0iZm9udC1zaXplOjEycHg7Y29sb3I6IzhhOTlhYTttYXJnaW4tYm90dG9tOjEwcHgiPuWvvOWHuuWFqOmDqOi0puWPt+eahCBUb2tlbiAvIEJhcmtLZXnvvIzkvr/kuo7lpIfku73miJbov4Hnp7vliLDlhbbku5borr7lpIfjgII8L2Rpdj4KICA8YnV0dG9uIGNsYXNzPSJidG4gYnRuLXByaW1hcnkiIG9uY2xpY2s9IkFwcC5leHBvcnRUb2tlbnMoKSI+8J+TiyDkuIDplK7lr7zlh7o8L2J1dHRvbj4KICA8YnV0dG9uIGNsYXNzPSJidG4gYnRuLWdob3N0IiBvbmNsaWNrPSJBcHAuY29weUV4cG9ydCgpIiBzdHlsZT0ibWFyZ2luLWxlZnQ6OHB4Ij7lpI3liLY8L2J1dHRvbj4KICA8dGV4dGFyZWEgaWQ9ImV4cG9ydEFyZWEiIGNsYXNzPSJleHBvcnQtYXJlYSIgcGxhY2Vob2xkZXI9IueCueWHu+OAjOS4gOmUruWvvOWHuuOAjeeUn+aIkCBUb2tlbiDmuIXljZXigKYiIHJlYWRvbmx5PjwvdGV4dGFyZWE+CjwvZGl2Pgo8ZGl2IGNsYXNzPSJzZXR0aW5nLWJsb2NrIj4KICA8ZGl2IGNsYXNzPSJzZXR0aW5nLXRpdGxlIj7niYjmnKw8L2Rpdj4KICA8ZGl2PlpFRUhPLUxJVEUtRW5oYW5jZWQgJHt0aGlzLnN0YXRlLnZlcnNpb259PC9kaXY+CiAgPGRpdiBzdHlsZT0iZm9udC1zaXplOjEycHg7Y29sb3I6IzhhOTlhYTttYXJnaW4tdG9wOjRweCI+6ISa5pysIHYyLjE0LjAgwrcg5p6E5bu6IDIwMjYtMDktMTIgwrcg6Z2i5p2/ICsg5a6a5pe2562+5Yiw5LiA5L2TPC9kaXY+CjwvZGl2PmA7CiAgfSwKCiAgYXN5bmMgc2F2ZUNvbmZpZygpIHsKICAgIGNvbnN0IHByZXYgPSB0aGlzLnN0YXRlLmNvbmZpZzsKICAgIGNvbnN0IHRpbWVWYWwgPSAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImNmZy10aW1lIikudmFsdWUgfHwgIiIpLnRyaW0oKTsKICAgIGNvbnN0IGRvbWFpblZhbCA9IChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiY2ZnLWRvbWFpbiIpLnZhbHVlIHx8ICIiKS50cmltKCk7CiAgICBjb25zdCBjZmcgPSB7CiAgICAgIHNpZ25pbkVuYWJsZWQ6IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJjZmctc2lnbmluIikuY2hlY2tlZCwKICAgICAgYmxpbmRCb3hBdXRvOiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiY2ZnLWJsaW5kIikuY2hlY2tlZCwKICAgICAgYmFya05vdGlmeTogZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImNmZy1iYXJrIikuY2hlY2tlZCwKICAgICAgc2lnbmluVGltZTogdGltZVZhbCB8fCBwcmV2LnNpZ25pblRpbWUgfHwgIjA4OjMwIiwKICAgICAgYXBpRG9tYWluOiBkb21haW5WYWwgfHwgcHJldi5hcGlEb21haW4gfHwgREVGQVVMVF9ET01BSU4KICAgIH07CiAgICB0cnkgewogICAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCgiL2FwaS9jb25maWciLCB7CiAgICAgICAgbWV0aG9kOiAiUE9TVCIsCiAgICAgICAgaGVhZGVyczogeyAiQ29udGVudC1UeXBlIjogImFwcGxpY2F0aW9uL2pzb24iIH0sCiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoY2ZnKQogICAgICB9KTsKICAgICAgY29uc3QganNvbiA9IGF3YWl0IHJlcy5qc29uKCk7CiAgICAgIGlmIChqc29uLm9rKSB7CiAgICAgICAgdGhpcy5zdGF0ZS5jb25maWcgPSBPYmplY3QuYXNzaWduKHt9LCB0aGlzLnN0YXRlLmNvbmZpZywganNvbi5jb25maWcgfHwgY2ZnKTsKICAgICAgICB0aGlzLnRvYXN0KCLnrb7liLDphY3nva7lt7Lkv53lrZgiKTsKICAgICAgfSBlbHNlIHsKICAgICAgICB0aGlzLnRvYXN0KGpzb24ubXNnIHx8ICLkv53lrZjlpLHotKUiKTsKICAgICAgfQogICAgfSBjYXRjaCAoZSkgewogICAgICB0aGlzLnRvYXN0KCLkv53lrZjlpLHotKUiKTsKICAgIH0KICB9LAoKICBhc3luYyBzYXZlQmFyayhrZXkpIHsKICAgIGNvbnN0IGlucHV0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImJhcmstIiArIGtleSk7CiAgICBjb25zdCBiYXJrS2V5ID0gKGlucHV0ICYmIGlucHV0LnZhbHVlIHx8ICIiKS50cmltKCk7CiAgICB0cnkgewogICAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCgiL2FwaS9iYXJrIiwgewogICAgICAgIG1ldGhvZDogIlBPU1QiLAogICAgICAgIGhlYWRlcnM6IHsgIkNvbnRlbnQtVHlwZSI6ICJhcHBsaWNhdGlvbi9qc29uIiB9LAogICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsga2V5LCBiYXJrS2V5IH0pCiAgICAgIH0pOwogICAgICBjb25zdCBqc29uID0gYXdhaXQgcmVzLmpzb24oKTsKICAgICAgdGhpcy50b2FzdChqc29uLm9rID8gIkJhcmtLZXkg5bey5L+d5a2YIiA6IChqc29uLm1zZyB8fCAi5L+d5a2Y5aSx6LSlIikpOwogICAgICBjb25zdCBhID0gdGhpcy5zdGF0ZS5hY2NvdW50TGlzdC5maW5kKHggPT4geC5rZXkgPT09IGtleSk7CiAgICAgIGlmIChhKSBhLmJhcmtLZXkgPSBiYXJrS2V5OwogICAgfSBjYXRjaCAoZSkgewogICAgICB0aGlzLnRvYXN0KCLkv53lrZjlpLHotKUiKTsKICAgIH0KICB9LAoKICBhc3luYyB0ZXN0QmFyayhrZXkpIHsKICAgIGNvbnN0IGEgPSB0aGlzLnN0YXRlLmFjY291bnRMaXN0LmZpbmQoeCA9PiB4LmtleSA9PT0ga2V5KTsKICAgIGlmICghYSB8fCAhYS5iYXJrS2V5KSB7IHRoaXMudG9hc3QoIuivt+WFiOS/neWtmCBCYXJrS2V5Iik7IHJldHVybjsgfQogICAgdGhpcy50b2FzdCgi5q2j5Zyo5Y+R6YCB5rWL6K+V5o6o6YCB4oCmIik7CiAgICB0cnkgewogICAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCgiL2FwaS90ZXN0LWJhcmsiLCB7CiAgICAgICAgbWV0aG9kOiAiUE9TVCIsCiAgICAgICAgaGVhZGVyczogeyAiQ29udGVudC1UeXBlIjogImFwcGxpY2F0aW9uL2pzb24iIH0sCiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBrZXkgfSkKICAgICAgfSk7CiAgICAgIGNvbnN0IGpzb24gPSBhd2FpdCByZXMuanNvbigpOwogICAgICB0aGlzLnRvYXN0KGpzb24ub2sgPyAoanNvbi5tc2cgfHwgIuaOqOmAgeaIkOWKnyIpIDogKCLmjqjpgIHlpLHotKXvvJoiICsgKGpzb24ubXNnIHx8ICIiKSkpOwogICAgfSBjYXRjaCAoZSkgewogICAgICB0aGlzLnRvYXN0KCLmjqjpgIHlpLHotKUiKTsKICAgIH0KICB9LAoKICBhc3luYyBleHBvcnRUb2tlbnMoKSB7CiAgICB0cnkgewogICAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCgiL2FwaS9leHBvcnQiKTsKICAgICAgY29uc3QganNvbiA9IGF3YWl0IHJlcy5qc29uKCk7CiAgICAgIGlmIChqc29uLm9rKSB7CiAgICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImV4cG9ydEFyZWEiKS52YWx1ZSA9IGpzb24udGV4dDsKICAgICAgICB0aGlzLnRvYXN0KCLlr7zlh7rmiJDlip/vvIzlj6/lpI3liLYiKTsKICAgICAgfSBlbHNlIHsKICAgICAgICB0aGlzLnRvYXN0KGpzb24ubXNnIHx8ICLlr7zlh7rlpLHotKUiKTsKICAgICAgfQogICAgfSBjYXRjaCAoZSkgewogICAgICB0aGlzLnRvYXN0KCLlr7zlh7rlpLHotKUiKTsKICAgIH0KICB9LAoKICBjb3B5RXhwb3J0KCkgewogICAgY29uc3QgdGEgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiZXhwb3J0QXJlYSIpOwogICAgaWYgKCF0YSB8fCAhdGEudmFsdWUpIHsgdGhpcy50b2FzdCgi6K+35YWI5LiA6ZSu5a+85Ye6Iik7IHJldHVybjsgfQogICAgdGEuc2VsZWN0KCk7CiAgICB0YS5zZXRTZWxlY3Rpb25SYW5nZSgwLCA5OTk5OTkpOwogICAgbGV0IGRvbmUgPSAoKSA9PiB0aGlzLnRvYXN0KCLlt7LlpI3liLbliLDliarotLTmnb8iKTsKICAgIGxldCBmYWlsID0gKCkgPT4geyB0cnkgeyBkb2N1bWVudC5leGVjQ29tbWFuZCgiY29weSIpOyBkb25lKCk7IH0gY2F0Y2ggKGUpIHsgdGhpcy50b2FzdCgi5aSN5Yi25aSx6LSl77yM6K+35omL5Yqo6ZW/5oyJ5aSN5Yi2Iik7IH0gfTsKICAgIGlmIChuYXZpZ2F0b3IuY2xpcGJvYXJkICYmIG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KSB7CiAgICAgIG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHRhLnZhbHVlKS50aGVuKGRvbmUsIGZhaWwpOwogICAgfSBlbHNlIHsKICAgICAgZmFpbCgpOwogICAgfQogIH0sCgogIGJpbmRUYWIoKSB7CiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCIudGFiLWl0ZW0iKS5mb3JFYWNoKGVsID0+IHsKICAgICAgZWwub25jbGljayA9ICgpID0+IHsKICAgICAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCIudGFiLWl0ZW0iKS5mb3JFYWNoKHQgPT4gdC5jbGFzc0xpc3QucmVtb3ZlKCJhY3RpdmUiKSk7CiAgICAgICAgZWwuY2xhc3NMaXN0LmFkZCgiYWN0aXZlIik7CiAgICAgICAgdGhpcy5zdGF0ZS5wYWdlID0gZWwuZGF0YXNldC5wYWdlOwogICAgICAgIHRoaXMucmVuZGVyKCk7CiAgICAgIH07CiAgICB9KTsKICB9LAoKICBpbml0KCkgewogICAgdGhpcy5iaW5kVGFiKCk7CiAgICB0aGlzLmluaXREYXRhKCk7CiAgfQp9Owp3aW5kb3cub25sb2FkID0gKCkgPT4gQXBwLmluaXQoKTsKPC9zY3JpcHQ+CjwvYm9keT4KPC9odG1sPgo=";

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
    } else if (path === "/api/config" && method === "POST") {
      const cfg = saveConfig(body);
      out = JSON.stringify({ ok: true, config: cfg, msg: "签到配置已保存" });
      contentType = "application/json; charset=utf-8";
    } else if (path === "/api/config") {
      out = JSON.stringify({ ok: true, config: getConfig() });
      contentType = "application/json; charset=utf-8";
    } else if (path === "/api/logs") {
      out = JSON.stringify({ ok: true, logs: getLogs() });
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

// ========== 模式分发 ==========
// HTTP-REQUEST 模式（有 $request）：渲染面板
// CRON 模式（Loon 定时任务：无 $request、有 $done、无 process）：自动签到
if (typeof $request !== "undefined") {
  main().catch(e => {
    console.error(e);
    respond({ status: 500, contentType: "application/json; charset=utf-8", body: JSON.stringify({ ok: false, msg: String((e && e.message) || e) }) });
  });
} else if (typeof $done === "function" && typeof process === "undefined") {
  runSignAll()
    .catch(e => { console.error("[定时签到异常]", e); addLog("❌ 定时签到异常：" + String((e && e.message) || e)); })
    .finally(() => { try { $done(); } catch (e) {} });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { main, runSignAll, runSignInForAccount, Backend, getConfig, saveConfig, getLogs, addLog, SCRIPT_VERSION, SCRIPT_VERSION_TAG, KEY_DATA, KEY_CONFIG, KEY_LOGS };
}