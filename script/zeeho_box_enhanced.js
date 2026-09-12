/*
#!name=极核 ZEEHO 签到面板 V2.14.1
#!desc=极核多账号签到面板增强版 V2.14.1 · 面板(HTTP-REQUEST) + 定时签到(CRON) 一体：多账号手动排序 / Token失效标红 / 盲盒倒计时 / 一键导出Token / BarkKey配置 / 面板管理签到配置(zeeho_config)。数据由代理后端签名获取，本地验证不依赖 Loon。
#!author=lucky

[Script]
# 面板（浏览器/客户端访问 http://zeeho.box 打开面板）
http-request ^http:\/\/zeeho\.box(\/.*)?$ script-path=zeeho_box_enhanced_lite.js, requires-body=true, timeout=60, tag=极核面板V2.14.1
# 定时签到（cron，与面板同一脚本，自动签到 + 盲盒 + Bark推送）
cron "30 8 * * *" script-path=zeeho_box_enhanced_lite.js, tag=极核签到V2.14.1

[MITM]
hostname = zeeho.box

【必读】zeeho.box 访问不上的原因与修复：
1. Loon 单独添加脚本时不会读取脚本注释里的 [Script]/[MITM] 段，需手动补主机名：
   Loon → 设置 → MITM → 主机名 → 添加 zeeho.box → 打开 MITM 开关 → 重启 Loon 生效。
2. 或直接把本文件作为插件导入（.plugin/.loon），Loon 会自动注册上面的规则和主机名。
3. 访问面板必须用 http://zeeho.box（不是 https）。
4. 若仍打不开：Loon → 配置 → 切换一下配置再切回，强制规则重新加载。

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
const SCRIPT_VERSION = "v2.14.1";     // 脚本版本号
const SCRIPT_VERSION_TAG = "V2.14.1";   // 面板/接口/导出显示的版本标签
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
const panelHtmlB64 = "PCFET0NUWVBFIGh0bWw+CjxodG1sIGxhbmc9InpoLUNOIj4KPGhlYWQ+CjxtZXRhIGNoYXJzZXQ9IlVURi04IiAvPgo8bWV0YSBuYW1lPSJ2aWV3cG9ydCIgY29udGVudD0id2lkdGg9ZGV2aWNlLXdpZHRoLCBpbml0aWFsLXNjYWxlPTEuMCIvPgo8dGl0bGU+5p6B5qC4IFpFRUhPIExJVEUg5aKe5by654mIIFYyLjE0LjE8L3RpdGxlPgo8c3R5bGU+Cip7Ym94LXNpemluZzpib3JkZXItYm94O21hcmdpbjowO3BhZGRpbmc6MDtmb250LWZhbWlseTotYXBwbGUtc3lzdGVtLEJsaW5rTWFjU3lzdGVtRm9udCwiU2Vnb2UgVUkiLCJQaW5nRmFuZyBTQyIsc2Fucy1zZXJpZn0KYm9keXtiYWNrZ3JvdW5kOiMwYjE0MjI7Y29sb3I6I2U4ZWRmMztwYWRkaW5nOjE2cHg7bWluLWhlaWdodDoxMDB2aDtwYWRkaW5nLWJvdHRvbTo4NXB4fQouaGVhZGVye2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjEycHg7bWFyZ2luLWJvdHRvbToyMHB4fQoubG9nb3t3aWR0aDo1MnB4O2hlaWdodDo1MnB4O2JvcmRlci1yYWRpdXM6MTZweDtiYWNrZ3JvdW5kOiMyM2M2ZGU7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2ZvbnQtd2VpZ2h0OmJvbGQ7Zm9udC1zaXplOjI0cHg7Y29sb3I6IzBiMTQyMjtmbGV4LXNocmluazowfQoudGl0bGUtZ3JvdXAgaDF7Zm9udC1zaXplOjIxcHg7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtmbGV4LXdyYXA6d3JhcDtnYXA6NnB4fQouYmFkZ2UtbGl0ZXtiYWNrZ3JvdW5kOiMxNDQ5NTc7Y29sb3I6IzM3ZDBlODtmb250LXNpemU6MTJweDtwYWRkaW5nOjJweCA4cHg7Ym9yZGVyLXJhZGl1czoxMnB4fQouc3VidGl0bGV7Zm9udC1zaXplOjEzcHg7Y29sb3I6Izk5YThiODttYXJnaW4tdG9wOjJweH0KLnJlZnJlc2gtaWNvbnttYXJnaW4tbGVmdDphdXRvO3dpZHRoOjQ0cHg7aGVpZ2h0OjQ0cHg7Ym9yZGVyLXJhZGl1czoxMnB4O2JhY2tncm91bmQ6IzFjMjkzYjtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7Y3Vyc29yOnBvaW50ZXI7Zm9udC1zaXplOjIwcHg7ZmxleC1zaHJpbms6MH0KLnBhbmVsLWRlc2N7YmFja2dyb3VuZDojMmMyYzI0O2NvbG9yOiNmZmRkNzc7cGFkZGluZzoxMHB4IDE0cHg7Ym9yZGVyLXJhZGl1czoxMHB4O21hcmdpbi1ib3R0b206MThweDtmb250LXNpemU6MTRweH0KLmJpZy1jYXJke2JhY2tncm91bmQ6IzE3MjQzNjtib3JkZXItcmFkaXVzOjE4cHg7cGFkZGluZzoyMHB4O21hcmdpbi1ib3R0b206MTZweDtib3JkZXI6MXB4IHNvbGlkIHRyYW5zcGFyZW50fQouYmlnLWNhcmQuY2FyZC1pbnZhbGlke2JvcmRlci1jb2xvcjojZmY1NDcwfQouc3RhdC1yb3d7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczoxZnIgMWZyO2dhcDoxMnB4O21hcmdpbjoxNnB4IDB9Ci5zdGF0LWNhcmR7YmFja2dyb3VuZDojMTcyNDM2O2JvcmRlci1yYWRpdXM6MTRweDtwYWRkaW5nOjE2cHh9Ci5zdGF0LW51bXtmb250LXNpemU6MzJweDtmb250LXdlaWdodDpib2xkO2NvbG9yOiMzN2QwZTh9Ci5zdGF0LWxhYmVse2ZvbnQtc2l6ZToxM3B4O2NvbG9yOiM5OWE4Yjg7bWFyZ2luLXRvcDo0cHh9Ci5hY2NvdW50LWhlYWRlcntkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMnB4O21hcmdpbi1ib3R0b206MTRweH0KLmF2YXRhci1ib3h7d2lkdGg6NDhweDtoZWlnaHQ6NDhweDtib3JkZXItcmFkaXVzOjEycHg7YmFja2dyb3VuZDojMjNjNmRlO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmb250LXNpemU6MjJweDtmb250LXdlaWdodDpib2xkO2NvbG9yOiMwYjE0MjI7b3ZlcmZsb3c6aGlkZGVuO2ZsZXgtc2hyaW5rOjB9Ci5hdmF0YXItYm94IGltZ3t3aWR0aDoxMDAlO2hlaWdodDoxMDAlO29iamVjdC1maXQ6Y292ZXJ9Ci5uYW1lLWlke21pbi13aWR0aDowO2ZsZXg6MX0KLm5hbWUtaWQgaDN7Zm9udC1zaXplOjE4cHg7b3ZlcmZsb3c6aGlkZGVuO3RleHQtb3ZlcmZsb3c6ZWxsaXBzaXM7d2hpdGUtc3BhY2U6bm93cmFwfQoubmFtZS1pZCAudWlke2ZvbnQtc2l6ZToxMnB4O2NvbG9yOiM5OWE4Yjg7bWFyZ2luLXRvcDoycHg7b3ZlcmZsb3c6aGlkZGVuO3RleHQtb3ZlcmZsb3c6ZWxsaXBzaXM7d2hpdGUtc3BhY2U6bm93cmFwfQoubmFtZS1pbnZhbGlkIGgze2NvbG9yOiNmZjU0NzB9Ci50YWctZ3JvdXB7ZGlzcGxheTpmbGV4O2dhcDo2cHg7ZmxleC13cmFwOndyYXA7anVzdGlmeS1jb250ZW50OmZsZXgtZW5kO2ZsZXgtc2hyaW5rOjB9Ci50YWd7cGFkZGluZzo0cHggMTBweDtib3JkZXItcmFkaXVzOjIwcHg7Zm9udC1zaXplOjEycHg7d2hpdGUtc3BhY2U6bm93cmFwfQoudGFnLWdyZWVue2JhY2tncm91bmQ6IzE5NGM0Nztjb2xvcjojNDJlMjk5fQoudGFnLWJsdWV7YmFja2dyb3VuZDojMTY0NDU4O2NvbG9yOiMzN2QwZTh9Ci50YWctcmVke2JhY2tncm91bmQ6IzRkMWQyODtjb2xvcjojZmY2YjgyfQoudGFnLW9yYW5nZXtiYWNrZ3JvdW5kOiM0ZDNhMWQ7Y29sb3I6I2ZmYjQ1NH0KLnRhZy1ncmV5e2JhY2tncm91bmQ6IzJhMzM0Mjtjb2xvcjojOGE5OWFhfQouc29ydC1idG5ze2Rpc3BsYXk6ZmxleDtnYXA6NnB4O2ZsZXgtc2hyaW5rOjB9Ci5zb3J0LWJ0bnt3aWR0aDozNHB4O2hlaWdodDozNHB4O2JvcmRlci1yYWRpdXM6MTBweDtiYWNrZ3JvdW5kOiMxYzI5M2I7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2N1cnNvcjpwb2ludGVyO2ZvbnQtc2l6ZToxNnB4O2NvbG9yOiNjNWQyZTI7dXNlci1zZWxlY3Q6bm9uZX0KLnNvcnQtYnRuOmFjdGl2ZXtiYWNrZ3JvdW5kOiMyYTNhNTJ9Ci5zb3J0LWJ0bi5kaXNhYmxlZHtvcGFjaXR5Oi4zO3BvaW50ZXItZXZlbnRzOm5vbmV9Ci5udW0tZ3JpZHtkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdCg0LDFmcik7Z2FwOjEwcHg7bWFyZ2luLWJvdHRvbToxNHB4fQoubnVtLWl0ZW17YmFja2dyb3VuZDojMWYyZjQ0O3BhZGRpbmc6MTJweCA2cHg7Ym9yZGVyLXJhZGl1czoxMnB4O3RleHQtYWxpZ246Y2VudGVyfQoubnVtLXZhbHtmb250LXNpemU6MjJweDtmb250LXdlaWdodDpib2xkfQoubnVtLWRlc2N7Zm9udC1zaXplOjExcHg7Y29sb3I6Izk5YThiODttYXJnaW4tdG9wOjNweH0KLnByb2dyZXNzLXdyYXB7bWFyZ2luLWJvdHRvbToxMnB4fQoucHJvZ3Jlc3MtdGl0bGV7Zm9udC1zaXplOjE0cHg7bWFyZ2luLWJvdHRvbTo2cHg7ZGlzcGxheTpmbGV4O2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2FsaWduLWl0ZW1zOmNlbnRlcn0KLnByb2dyZXNzLWJhcnt3aWR0aDoxMDAlO2hlaWdodDoxMnB4O2JhY2tncm91bmQ6IzI4Mzk1MDtib3JkZXItcmFkaXVzOjk5OXB4O292ZXJmbG93OmhpZGRlbn0KLnByb2dyZXNzLWZpbGx7aGVpZ2h0OjEwMCU7YmFja2dyb3VuZDojYTg3YmZmO2JvcmRlci1yYWRpdXM6OTk5cHg7dHJhbnNpdGlvbjp3aWR0aCAuM3N9Ci5jb3VudGRvd24tbGluZXtmb250LXNpemU6MTNweDttYXJnaW46MTBweCAwO3BhZGRpbmc6OHB4IDEycHg7Ym9yZGVyLXJhZGl1czoxMHB4O2JhY2tncm91bmQ6IzFmMmY0NDtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDo4cHh9Ci5jb3VudGRvd24tbGluZSAuY2QtdmFse2ZvbnQtd2VpZ2h0OmJvbGQ7Y29sb3I6I2ZmZDE2Njtmb250LXZhcmlhbnQtbnVtZXJpYzp0YWJ1bGFyLW51bXN9Ci5jb3VudGRvd24tbGluZS5yZWFkeXtiYWNrZ3JvdW5kOiMxOTRjNDc7Y29sb3I6IzQyZTI5OX0KLmNhbGVuZGFyLXJvd3tkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdCg3LDFmcik7Z2FwOjhweH0KLmMtZGF5e2FzcGVjdC1yYXRpbzoxLzE7YmFja2dyb3VuZDojMWYyZjQ0O2JvcmRlci1yYWRpdXM6MTBweDtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO2ZvbnQtc2l6ZToxMnB4O2NvbG9yOiM4YTk5YWF9Ci5jLWRheS5jaGVja2Vke2JhY2tncm91bmQ6IzFjNGI1ODtjb2xvcjojMzdkMGU4O2ZvbnQtd2VpZ2h0OmJvbGR9Ci50YWItYmFye3Bvc2l0aW9uOmZpeGVkO2xlZnQ6MDtyaWdodDowO2JvdHRvbTowO2JhY2tncm91bmQ6IzEzMWUyZjtkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOjFmciAxZnIgMWZyO3BhZGRpbmc6MTBweCAwO3otaW5kZXg6MTB9Ci50YWItaXRlbXt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTRweDtwYWRkaW5nOjZweCAwO2NvbG9yOiM4ODk5YWE7Y3Vyc29yOnBvaW50ZXJ9Ci50YWItaXRlbS5hY3RpdmV7Y29sb3I6IzM3ZDBlOH0KLmxvZy1pdGVte3BhZGRpbmc6MTBweDtiYWNrZ3JvdW5kOiMxNzI0MzY7Ym9yZGVyLXJhZGl1czoxMHB4O21hcmdpbi1ib3R0b206OHB4O2ZvbnQtc2l6ZToxM3B4O2NvbG9yOiNjNWQyZTI7d29yZC1icmVhazpicmVhay1hbGw7d2hpdGUtc3BhY2U6cHJlLXdyYXB9Ci5zZXR0aW5nLWJsb2Nre2JhY2tncm91bmQ6IzE3MjQzNjtib3JkZXItcmFkaXVzOjE0cHg7cGFkZGluZzoxNnB4O21hcmdpbi1ib3R0b206MTRweH0KLnNldHRpbmctdGl0bGV7Zm9udC1zaXplOjE2cHg7bWFyZ2luLWJvdHRvbToxMnB4O2ZvbnQtd2VpZ2h0OmJvbGR9Ci5jZmctcm93e2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47cGFkZGluZzoxMXB4IDA7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgIzFmMmY0NDtmb250LXNpemU6MTRweDtnYXA6MTJweH0KLmNmZy1yb3c6bGFzdC1vZi10eXBle2JvcmRlci1ib3R0b206bm9uZX0KLmNmZy1sYWJlbHtjb2xvcjojYzVkMmUyO2ZsZXgtc2hyaW5rOjB9Ci5jZmctaGludHtmb250LXNpemU6MTFweDtjb2xvcjojOGE5OWFhO21hcmdpbi10b3A6NHB4O2xpbmUtaGVpZ2h0OjEuNX0KLmNmZy1pbnB1dHt3aWR0aDo1NiU7bWluLXdpZHRoOjA7YmFja2dyb3VuZDojMWYyZjQ0O2JvcmRlcjoxcHggc29saWQgIzJhM2E1Mjtib3JkZXItcmFkaXVzOjhweDtjb2xvcjojZThlZGYzO3BhZGRpbmc6OHB4IDEwcHg7Zm9udC1zaXplOjEycHg7b3V0bGluZTpub25lfQouY2ZnLWlucHV0OmZvY3Vze2JvcmRlci1jb2xvcjojMjNjNmRlfQouc3dpdGNoe3Bvc2l0aW9uOnJlbGF0aXZlO3dpZHRoOjQ4cHg7aGVpZ2h0OjI4cHg7ZmxleC1zaHJpbms6MH0KLnN3aXRjaCBpbnB1dHtvcGFjaXR5OjA7d2lkdGg6MDtoZWlnaHQ6MH0KLnNsaWRlcntwb3NpdGlvbjphYnNvbHV0ZTtjdXJzb3I6cG9pbnRlcjt0b3A6MDtsZWZ0OjA7cmlnaHQ6MDtib3R0b206MDtiYWNrZ3JvdW5kOiMyYTNhNTI7Ym9yZGVyLXJhZGl1czo5OTlweDt0cmFuc2l0aW9uOi4yc30KLnNsaWRlcjpiZWZvcmV7Y29udGVudDoiIjtwb3NpdGlvbjphYnNvbHV0ZTtoZWlnaHQ6MjJweDt3aWR0aDoyMnB4O2xlZnQ6M3B4O3RvcDozcHg7YmFja2dyb3VuZDojZThlZGYzO2JvcmRlci1yYWRpdXM6NTAlO3RyYW5zaXRpb246LjJzfQouc3dpdGNoIGlucHV0OmNoZWNrZWQgKyAuc2xpZGVye2JhY2tncm91bmQ6IzIzYzZkZX0KLnN3aXRjaCBpbnB1dDpjaGVja2VkICsgLnNsaWRlcjpiZWZvcmV7dHJhbnNmb3JtOnRyYW5zbGF0ZVgoMjBweCl9Ci5iYXJrLXJvd3tkaXNwbGF5OmZsZXg7Z2FwOjhweDthbGlnbi1pdGVtczpjZW50ZXI7bWFyZ2luLWJvdHRvbToxMHB4fQouYmFyay1yb3cgLmJhcmstaWR7d2lkdGg6ODBweDtmbGV4LXNocmluazowO21pbi13aWR0aDowfQouYmFyay1yb3cgLmJhcmstbmFtZXtmb250LXNpemU6MTNweDtmb250LXdlaWdodDpib2xkO292ZXJmbG93OmhpZGRlbjt0ZXh0LW92ZXJmbG93OmVsbGlwc2lzO3doaXRlLXNwYWNlOm5vd3JhcH0KLmJhcmstcm93IC5iYXJrLXN1Yntmb250LXNpemU6MTFweDtjb2xvcjojOGE5OWFhO292ZXJmbG93OmhpZGRlbjt0ZXh0LW92ZXJmbG93OmVsbGlwc2lzO3doaXRlLXNwYWNlOm5vd3JhcH0KLmJhcmstcm93IGlucHV0e2ZsZXg6MTttaW4td2lkdGg6MDtiYWNrZ3JvdW5kOiMxZjJmNDQ7Ym9yZGVyOjFweCBzb2xpZCAjMmEzYTUyO2JvcmRlci1yYWRpdXM6MTBweDtjb2xvcjojZThlZGYzO3BhZGRpbmc6OXB4IDEycHg7Zm9udC1zaXplOjEzcHg7b3V0bGluZTpub25lfQouYmFyay1yb3cgaW5wdXQ6Zm9jdXN7Ym9yZGVyLWNvbG9yOiMyM2M2ZGV9Ci5idG57cGFkZGluZzo5cHggMTRweDtib3JkZXItcmFkaXVzOjEwcHg7Ym9yZGVyOm5vbmU7Y3Vyc29yOnBvaW50ZXI7Zm9udC1zaXplOjEzcHg7d2hpdGUtc3BhY2U6bm93cmFwfQouYnRuLXByaW1hcnl7YmFja2dyb3VuZDojMjNjNmRlO2NvbG9yOiMwYjE0MjI7Zm9udC13ZWlnaHQ6Ym9sZH0KLmJ0bi1naG9zdHtiYWNrZ3JvdW5kOiMxZjJmNDQ7Y29sb3I6I2M1ZDJlMn0KLmV4cG9ydC1hcmVhe3dpZHRoOjEwMCU7aGVpZ2h0OjE2MHB4O2JhY2tncm91bmQ6IzBiMTQyMjtib3JkZXI6MXB4IHNvbGlkICMyYTNhNTI7Ym9yZGVyLXJhZGl1czoxMHB4O2NvbG9yOiM3ZWUwYTM7Zm9udC1mYW1pbHk6TWVubG8sQ29uc29sYXMsbW9ub3NwYWNlO2ZvbnQtc2l6ZToxMnB4O3BhZGRpbmc6MTBweDtib3gtc2l6aW5nOmJvcmRlci1ib3g7cmVzaXplOnZlcnRpY2FsO21hcmdpbi10b3A6MTBweH0KLnRvYXN0e3Bvc2l0aW9uOmZpeGVkO2xlZnQ6NTAlO2JvdHRvbTo5MHB4O3RyYW5zZm9ybTp0cmFuc2xhdGVYKC01MCUpO2JhY2tncm91bmQ6IzFjMjkzYjtjb2xvcjojZThlZGYzO3BhZGRpbmc6MTBweCAxOHB4O2JvcmRlci1yYWRpdXM6MTJweDtmb250LXNpemU6MTNweDt6LWluZGV4Ojk5O29wYWNpdHk6MDt0cmFuc2l0aW9uOm9wYWNpdHkgLjI1cztwb2ludGVyLWV2ZW50czpub25lO21heC13aWR0aDo4MCU7dGV4dC1hbGlnbjpjZW50ZXJ9Ci50b2FzdC5zaG93e29wYWNpdHk6MX0KLmVtcHR5e3BhZGRpbmc6MzBweCAwO3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOiM4YTk5YWF9Ci5yb3ctdGl0bGV7ZGlzcGxheTpmbGV4O2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW46MjBweCAwIDEycHg7Zm9udC1zaXplOjE2cHh9Cjwvc3R5bGU+CjwvaGVhZD4KPGJvZHk+CjxkaXYgaWQ9ImFwcCI+PC9kaXY+CjxkaXYgY2xhc3M9InRhYi1iYXIiPgogIDxkaXYgY2xhc3M9InRhYi1pdGVtIGFjdGl2ZSIgZGF0YS1wYWdlPSJob21lIj7wn4+gIOmmlumhtTwvZGl2PgogIDxkaXYgY2xhc3M9InRhYi1pdGVtIiBkYXRhLXBhZ2U9ImxvZyI+4piwIOaXpeW/lzwvZGl2PgogIDxkaXYgY2xhc3M9InRhYi1pdGVtIiBkYXRhLXBhZ2U9InNldHRpbmciPuKamSDorr7nva48L2Rpdj4KPC9kaXY+CjxkaXYgY2xhc3M9InRvYXN0IiBpZD0idG9hc3QiPjwvZGl2Pgo8c2NyaXB0Pgpjb25zdCBERUZBVUxUX0RPTUFJTiA9ICJodHRwczovL2FwaS16ZWVoby5leGFtcGxlLmNvbSI7CmNvbnN0IEFwcCA9IHsKICBzdGF0ZTogewogICAgcGFnZTogImhvbWUiLAogICAgYWNjb3VudExpc3Q6IFtdLAogICAgbm9BbmltOiBmYWxzZSwKICAgIGxvZ0xpc3Q6IFtdLAogICAgdmVyc2lvbjogIlYyLjE0LjEiLAogICAgY29uZmlnOiB7IHNpZ25pbkVuYWJsZWQ6IHRydWUsIGJsaW5kQm94QXV0bzogdHJ1ZSwgYmFya05vdGlmeTogdHJ1ZSwgc2lnbmluVGltZTogIjA4OjMwIiwgYXBpRG9tYWluOiBERUZBVUxUX0RPTUFJTiB9CiAgfSwKICB0b2FzdFRpbWVyOiBudWxsLAogIF9jZFRpbWVyOiBudWxsLAoKICB0b2FzdChtc2cpIHsKICAgIGNvbnN0IHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgidG9hc3QiKTsKICAgIGlmICghdCkgcmV0dXJuOwogICAgdC50ZXh0Q29udGVudCA9IG1zZzsKICAgIHQuY2xhc3NMaXN0LmFkZCgic2hvdyIpOwogICAgY2xlYXJUaW1lb3V0KHRoaXMudG9hc3RUaW1lcik7CiAgICB0aGlzLnRvYXN0VGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHQuY2xhc3NMaXN0LnJlbW92ZSgic2hvdyIpLCAxODAwKTsKICB9LAoKICBhc3luYyBpbml0RGF0YSgpIHsKICAgIGF3YWl0IFByb21pc2UuYWxsKFt0aGlzLmZldGNoQWxsQWNjb3VudHMoKSwgdGhpcy5mZXRjaENvbmZpZygpLCB0aGlzLmZldGNoTG9ncygpXSk7CiAgICB0aGlzLnJlbmRlcigpOwogIH0sCgogIGFzeW5jIHJlZnJlc2hBbGwoKSB7CiAgICB0aGlzLnN0YXRlLm5vQW5pbSA9IHRydWU7CiAgICBhd2FpdCBQcm9taXNlLmFsbChbdGhpcy5mZXRjaEFsbEFjY291bnRzKCksIHRoaXMuZmV0Y2hDb25maWcoKSwgdGhpcy5mZXRjaExvZ3MoKV0pOwogICAgdGhpcy5yZW5kZXIoKTsKICB9LAoKICBhc3luYyBmZXRjaEFsbEFjY291bnRzKCkgewogICAgdHJ5IHsKICAgICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goIi9hcGkvZGF0YSIpOwogICAgICBjb25zdCBqc29uID0gYXdhaXQgcmVzLmpzb24oKTsKICAgICAgaWYgKGpzb24ub2spIHsKICAgICAgICB0aGlzLnN0YXRlLmFjY291bnRMaXN0ID0ganNvbi5hY2NvdW50cyB8fCBbXTsKICAgICAgICBpZiAoanNvbi52ZXJzaW9uKSB0aGlzLnN0YXRlLnZlcnNpb24gPSBqc29uLnZlcnNpb247CiAgICAgIH0gZWxzZSB7CiAgICAgICAgdGhpcy50b2FzdChqc29uLm1zZyB8fCAi5pWw5o2u5Yqg6L295aSx6LSlIik7CiAgICAgIH0KICAgIH0gY2F0Y2ggKGUpIHsKICAgICAgY29uc29sZS5lcnJvcigi6I635Y+W6LSm5Y+35pWw5o2u5aSx6LSlIiwgZSk7CiAgICAgIHRoaXMudG9hc3QoIuaXoOazlei/nuaOpeiEmuacrOWQjuerr++8jOivt+ehruiupOW3suWcqCBMb29uIOS4reWQr+eUqOmdouadv+aLpuaIqiIpOwogICAgfQogIH0sCgogIGFzeW5jIGZldGNoQ29uZmlnKCkgewogICAgdHJ5IHsKICAgICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goIi9hcGkvY29uZmlnIik7CiAgICAgIGNvbnN0IGpzb24gPSBhd2FpdCByZXMuanNvbigpOwogICAgICBpZiAoanNvbi5vaykgdGhpcy5zdGF0ZS5jb25maWcgPSBPYmplY3QuYXNzaWduKHt9LCB0aGlzLnN0YXRlLmNvbmZpZywganNvbi5jb25maWcgfHwge30pOwogICAgfSBjYXRjaCAoZSkgewogICAgICBjb25zb2xlLmVycm9yKCLojrflj5bphY3nva7lpLHotKUiLCBlKTsKICAgIH0KICB9LAoKICBhc3luYyBmZXRjaExvZ3MoKSB7CiAgICB0cnkgewogICAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCgiL2FwaS9sb2dzIik7CiAgICAgIGNvbnN0IGpzb24gPSBhd2FpdCByZXMuanNvbigpOwogICAgICBpZiAoanNvbi5vaykgdGhpcy5zdGF0ZS5sb2dMaXN0ID0ganNvbi5sb2dzIHx8IFtdOwogICAgfSBjYXRjaCAoZSkgewogICAgICBjb25zb2xlLmVycm9yKCLojrflj5bml6Xlv5flpLHotKUiLCBlKTsKICAgIH0KICB9LAoKICByZW5kZXIoKSB7CiAgICBjb25zdCBhcHAgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiYXBwIik7CiAgICBhcHAuY2xhc3NMaXN0LnRvZ2dsZSgibm8tYW5pbSIsIHRoaXMuc3RhdGUubm9BbmltKTsKICAgIHN3aXRjaCAodGhpcy5zdGF0ZS5wYWdlKSB7CiAgICAgIGNhc2UgImhvbWUiOiB0aGlzLnJlbmRlckhvbWUoKTsgYnJlYWs7CiAgICAgIGNhc2UgImxvZyI6IHRoaXMucmVuZGVyTG9nKCk7IGJyZWFrOwogICAgICBjYXNlICJzZXR0aW5nIjogdGhpcy5yZW5kZXJTZXR0aW5nKCk7IGJyZWFrOwogICAgfQogICAgaWYgKHRoaXMuc3RhdGUucGFnZSA9PT0gImhvbWUiKSB0aGlzLnN0YXJ0Q291bnRkb3duKCk7CiAgfSwKCiAgaXNTaWduZWRUb2RheShhY2MpIHsKICAgIGNvbnN0IHI3ID0gYWNjLnJlY2VudDcgfHwgW107CiAgICBpZiAocjcubGVuZ3RoKSB7CiAgICAgIGNvbnN0IGxhc3QgPSByN1tyNy5sZW5ndGggLSAxXTsKICAgICAgaWYgKGxhc3QgJiYgbGFzdC5vaykgcmV0dXJuIHRydWU7CiAgICB9CiAgICByZXR1cm4gTnVtYmVyKGFjYy50b2RheVNjb3JlIHx8IDApID4gMDsKICB9LAoKICBhc3luYyBtb3ZlQWNjb3VudChrZXksIGRlbHRhKSB7CiAgICBjb25zdCBsaXN0ID0gdGhpcy5zdGF0ZS5hY2NvdW50TGlzdDsKICAgIGNvbnN0IGkgPSBsaXN0LmZpbmRJbmRleChhID0+IGEua2V5ID09PSBrZXkpOwogICAgY29uc3QgaiA9IGkgKyBkZWx0YTsKICAgIGlmIChpIDwgMCB8fCBqIDwgMCB8fCBqID49IGxpc3QubGVuZ3RoKSByZXR1cm47CiAgICBjb25zdCBhcnIgPSBsaXN0LnNsaWNlKCk7CiAgICBjb25zdCB0bXAgPSBhcnJbaV07IGFycltpXSA9IGFycltqXTsgYXJyW2pdID0gdG1wOwogICAgdGhpcy5zdGF0ZS5hY2NvdW50TGlzdCA9IGFycjsKICAgIHRoaXMucmVuZGVySG9tZSgpOwogICAgdHJ5IHsKICAgICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goIi9hcGkvc29ydCIsIHsKICAgICAgICBtZXRob2Q6ICJQT1NUIiwKICAgICAgICBoZWFkZXJzOiB7ICJDb250ZW50LVR5cGUiOiAiYXBwbGljYXRpb24vanNvbiIgfSwKICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGtleXM6IGFyci5tYXAoYSA9PiBhLmtleSkgfSkKICAgICAgfSk7CiAgICAgIGNvbnN0IGpzb24gPSBhd2FpdCByZXMuanNvbigpOwogICAgICB0aGlzLnRvYXN0KGpzb24ub2sgPyAi5o6S5bqP5bey5L+d5a2YIiA6ICLmjpLluo/kv53lrZjlpLHotKUiKTsKICAgIH0gY2F0Y2ggKGUpIHsKICAgICAgdGhpcy50b2FzdCgi5o6S5bqP5L+d5a2Y5aSx6LSlIik7CiAgICB9CiAgfSwKCiAgcmVuZGVySG9tZSgpIHsKICAgIGNvbnN0IGFwcCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJhcHAiKTsKICAgIGNvbnN0IGxpc3QgPSB0aGlzLnN0YXRlLmFjY291bnRMaXN0OwogICAgbGV0IHRvdGFsU2NvcmUgPSAwLCBiaW5kQ2FyID0gMCwgdG9rZW5PayA9IDA7CiAgICBsaXN0LmZvckVhY2goYWNjID0+IHsKICAgICAgdG90YWxTY29yZSArPSBOdW1iZXIoYWNjLnNjb3JlIHx8IDApOwogICAgICBpZiAoYWNjLnRva2VuU3RhdHVzKSB0b2tlbk9rKys7CiAgICAgIGJpbmRDYXIgKz0gTnVtYmVyKGFjYy5jYXJDb3VudCB8fCAwKTsKICAgIH0pOwogICAgY29uc3Qgc2lnbmVkVG9kYXkgPSBsaXN0LmZpbHRlcihhID0+IHRoaXMuaXNTaWduZWRUb2RheShhKSkubGVuZ3RoOwogICAgY29uc3Qgc2lnblN0YXRlID0gdGhpcy5zdGF0ZS5jb25maWcuc2lnbmluRW5hYmxlZCA/ICLlt7LlvIDlkK8iIDogIuW3suWFs+mXrSI7CiAgICBsZXQgY2FyZHMgPSAiIjsKICAgIGlmIChsaXN0Lmxlbmd0aCkgewogICAgICBjYXJkcyA9IGxpc3QubWFwKChhLCBpKSA9PiB0aGlzLnJlbmRlckFjY291bnRDYXJkKGEsIGksIGxpc3QpKS5qb2luKCIiKTsKICAgIH0gZWxzZSB7CiAgICAgIGNhcmRzID0gJzxkaXYgY2xhc3M9ImVtcHR5Ij7mmoLml6DotKblj7fmlbDmja48YnIvPuivt+WFiOWcqOWuouaIt+err+S4iuS8oOmFjee9rjxici8+PHNwYW4gc3R5bGU9ImZvbnQtc2l6ZToxMnB4Ij56ZWVoby5ib3gvYXBpL3F1aWNrLXNhdmU/bmFtZT14eCZ0b2tlbj14eCZiYXJrS2V5PXh4PC9zcGFuPjwvZGl2Pic7CiAgICB9CiAgICBsZXQgaHRtbCA9IGAKPGRpdiBjbGFzcz0iaGVhZGVyIj4KICA8ZGl2IGNsYXNzPSJsb2dvIj5aPC9kaXY+CiAgPGRpdiBjbGFzcz0idGl0bGUtZ3JvdXAiPgogICAgPGgxPuaegeaguCBaRUVITzxzcGFuIGNsYXNzPSJiYWRnZS1saXRlIj5MSVRFICR7dGhpcy5zdGF0ZS52ZXJzaW9ufTwvc3Bhbj48L2gxPgogICAgPGRpdiBjbGFzcz0ic3VidGl0bGUiPuetvuWIsCDCtyDovabovoYgwrcg5o6n6L2mPC9kaXY+CiAgPC9kaXY+CiAgPGRpdiBjbGFzcz0icmVmcmVzaC1pY29uIiBvbmNsaWNrPSJBcHAucmVmcmVzaEFsbCgpIj7in7M8L2Rpdj4KPC9kaXY+CjxkaXYgY2xhc3M9ImJpZy1jYXJkIj4KICA8ZGl2IHN0eWxlPSJmb250LXNpemU6MTZweDtjb2xvcjojOTlhOGI4Ij7otKblj7fmgLvnp6/liIY8L2Rpdj4KICA8ZGl2IHN0eWxlPSJmb250LXNpemU6NjBweDtmb250LXdlaWdodDpib2xkO2NvbG9yOiMzN2QwZTg7bWFyZ2luOjZweCAwIj4ke3RvdGFsU2NvcmUudG9Mb2NhbGVTdHJpbmcoKX08L2Rpdj4KICA8ZGl2IHN0eWxlPSJ0ZXh0LWFsaWduOnJpZ2h0O2NvbG9yOiM0MmUyOTkiPuS7iuaXpeW3suetvuWIsCAke3NpZ25lZFRvZGF5fS8ke2xpc3QubGVuZ3RofTwvZGl2PgogIDxkaXYgY2xhc3M9InN0YXQtcm93Ij4KICAgIDxkaXYgY2xhc3M9InN0YXQtY2FyZCI+PGRpdiBjbGFzcz0ic3RhdC1udW0iPiR7YmluZENhcn08L2Rpdj48ZGl2IGNsYXNzPSJzdGF0LWxhYmVsIj7nu5HlrprovabovoY8L2Rpdj48L2Rpdj4KICAgIDxkaXYgY2xhc3M9InN0YXQtY2FyZCI+PGRpdiBjbGFzcz0ic3RhdC1udW0iPiR7dG9rZW5Pa308L2Rpdj48ZGl2IGNsYXNzPSJzdGF0LWxhYmVsIj5Ub2tlbiDmraPluLg8L2Rpdj48L2Rpdj4KICA8L2Rpdj4KPC9kaXY+CjxkaXYgY2xhc3M9InBhbmVsLWRlc2MiPumdouadv+aooeW8j++8muaVsOaNrueUseacrOacuuiEmuacrOWQjuerr+etvuWQjeS4juiOt+WPliDCtyAke3RoaXMuc3RhdGUudmVyc2lvbn08YnIvPuWumuaXtuetvuWIsO+8miR7c2lnblN0YXRlfSR7dGhpcy5zdGF0ZS5jb25maWcuc2lnbmluVGltZSA/ICIgwrcg5q+P5aSpICIgKyB0aGlzLnN0YXRlLmNvbmZpZy5zaWduaW5UaW1lIDogIiJ9PC9kaXY+CjxkaXYgY2xhc3M9InJvdy10aXRsZSI+PHNwYW4+8J+alyDotKblj7fnirbmgIE8L3NwYW4+PHNwYW4gc3R5bGU9ImZvbnQtc2l6ZToxMnB4O2NvbG9yOiM4YTk5YWEiPuWFsSAke2xpc3QubGVuZ3RofSDkuKrotKblj7cgwrcg5Y2h54mH5Y+z5L6nIOKGkeKGkyDmiYvliqjmjpLluo88L3NwYW4+PC9kaXY+CiR7Y2FyZHN9YDsKICAgIGFwcC5pbm5lckhUTUwgPSBodG1sOwogIH0sCgogIHJlbmRlckFjY291bnRDYXJkKGEsIGksIGxpc3QpIHsKICAgIGNvbnN0IGludmFsaWQgPSAhYS50b2tlblN0YXR1czsKICAgIGNvbnN0IHNpZ25lZCA9IHRoaXMuaXNTaWduZWRUb2RheShhKTsKICAgIGNvbnN0IGF2YXRhciA9IGEuYXZhdGFyVXJsCiAgICAgID8gYDxpbWcgc3JjPSIke2EuYXZhdGFyVXJsfSIgYWx0PSIiIGxvYWRpbmc9ImxhenkiLz5gCiAgICAgIDogYDxzcGFuPiR7KGEubmFtZSB8fCAiTCIpWzBdLnRvVXBwZXJDYXNlKCl9PC9zcGFuPmA7CiAgICBjb25zdCBidCA9IE51bWJlcihhLmJsaW5kVG90YWwgfHwgMzApOwogICAgY29uc3QgYm4gPSBOdW1iZXIoYS5ibGluZE5vdyB8fCAwKTsKICAgIGNvbnN0IGJyID0gYS5ibGluZFJlbWFpbiAhPSBudWxsID8gTnVtYmVyKGEuYmxpbmRSZW1haW4pIDogTWF0aC5tYXgoMCwgYnQgLSBibik7CiAgICBjb25zdCBwY3QgPSBidCA/IE1hdGgubWluKDEwMCwgTWF0aC5yb3VuZChibiAvIGJ0ICogMTAwKSkgOiAwOwogICAgY29uc3QgY2FuRHJhdyA9IGJyIDw9IDA7CiAgICBsZXQgY2FsID0gIiI7CiAgICAoYS5yZWNlbnQ3IHx8IFtdKS5mb3JFYWNoKGQgPT4geyBjYWwgKz0gYDxkaXYgY2xhc3M9ImMtZGF5ICR7ZC5vayA/ICJjaGVja2VkIiA6ICIifSI+JHtkLmRheX08L2Rpdj5gOyB9KTsKICAgIGlmICghY2FsKSBjYWwgPSAnPGRpdiBjbGFzcz0iZW1wdHkiIHN0eWxlPSJncmlkLWNvbHVtbjoxLy0xO3BhZGRpbmc6MTJweCAwIj7mmoLml6Dnrb7liLDorrDlvZU8L2Rpdj4nOwogICAgY29uc3QgZmlyc3QgPSBpID09PSAwLCBsYXN0ID0gaSA9PT0gbGlzdC5sZW5ndGggLSAxOwogICAgY29uc3QgdGFnVG9rZW4gPSBpbnZhbGlkCiAgICAgID8gKGEuZXJyVHlwZSA9PT0gIm5ldCIgPyBgPHNwYW4gY2xhc3M9InRhZyB0YWctb3JhbmdlIj7ojrflj5blpLHotKU8L3NwYW4+YCA6IGA8c3BhbiBjbGFzcz0idGFnIHRhZy1yZWQiPlRva2VuIOWkseaViDwvc3Bhbj5gKQogICAgICA6IGA8c3BhbiBjbGFzcz0idGFnIHRhZy1ibHVlIj5Ub2tlbiDmraPluLg8L3NwYW4+YDsKICAgIGNvbnN0IHRhZ1NpZ24gPSBzaWduZWQgPyBgPHNwYW4gY2xhc3M9InRhZyB0YWctZ3JlZW4iPuW3suetvuWIsDwvc3Bhbj5gIDogYDxzcGFuIGNsYXNzPSJ0YWcgdGFnLWdyZXkiPuacquetvuWIsDwvc3Bhbj5gOwogICAgY29uc3QgY2RMaW5lID0gY2FuRHJhdwogICAgICA/IGA8ZGl2IGNsYXNzPSJjb3VudGRvd24tbGluZSByZWFkeSI+8J+OgSDnm7Lnm5Llt7LlsLHnu6ogwrcg5LuK5pel5Y+v5oq955uy55uSPC9kaXY+YAogICAgICA6IGA8ZGl2IGNsYXNzPSJjb3VudGRvd24tbGluZSI+8J+OgSA8c3Bhbj7ot53nm7Lnm5Lop6PplIE8L3NwYW4+PHNwYW4gc3R5bGU9Im1hcmdpbi1sZWZ0OmF1dG8iIGNsYXNzPSJjZC12YWwiIGRhdGEtcmVtPSIke2JyfSI+JHticn3lpKkgLS06LS06LS08L3NwYW4+PC9kaXY+YDsKICAgIHJldHVybiBgCjxkaXYgY2xhc3M9ImJpZy1jYXJkICR7aW52YWxpZCA/ICJjYXJkLWludmFsaWQiIDogIiJ9Ij4KICA8ZGl2IGNsYXNzPSJhY2NvdW50LWhlYWRlciI+CiAgICA8ZGl2IGNsYXNzPSJhdmF0YXItYm94Ij4ke2F2YXRhcn08L2Rpdj4KICAgIDxkaXYgY2xhc3M9Im5hbWUtaWQgJHtpbnZhbGlkID8gIm5hbWUtaW52YWxpZCIgOiAiIn0iPgogICAgICA8aDM+JHthLm5hbWUgfHwgIi0tIn08L2gzPgogICAgICA8ZGl2IGNsYXNzPSJ1aWQiPklEICR7YS51aWQgfHwgKGEua2V5ID8gYS5rZXkuc2xpY2UoMCwgOCkgOiAiLS0iKX08L2Rpdj4KICAgIDwvZGl2PgogICAgPGRpdiBjbGFzcz0idGFnLWdyb3VwIj4ke3RhZ1Rva2VufSR7dGFnU2lnbn08L2Rpdj4KICAgIDxkaXYgY2xhc3M9InNvcnQtYnRucyI+CiAgICAgIDxkaXYgY2xhc3M9InNvcnQtYnRuICR7Zmlyc3QgPyAiZGlzYWJsZWQiIDogIiJ9IiBvbmNsaWNrPSJBcHAubW92ZUFjY291bnQoJyR7YS5rZXl9JywtMSkiPuKGkTwvZGl2PgogICAgICA8ZGl2IGNsYXNzPSJzb3J0LWJ0biAke2xhc3QgPyAiZGlzYWJsZWQiIDogIiJ9IiBvbmNsaWNrPSJBcHAubW92ZUFjY291bnQoJyR7YS5rZXl9JywxKSI+4oaTPC9kaXY+CiAgICA8L2Rpdj4KICA8L2Rpdj4KICA8ZGl2IGNsYXNzPSJudW0tZ3JpZCI+CiAgICA8ZGl2IGNsYXNzPSJudW0taXRlbSI+PGRpdiBjbGFzcz0ibnVtLXZhbCI+JHthLnNjb3JlIHx8IDB9PC9kaXY+PGRpdiBjbGFzcz0ibnVtLWRlc2MiPuaAu+enr+WIhjwvZGl2PjwvZGl2PgogICAgPGRpdiBjbGFzcz0ibnVtLWl0ZW0iPjxkaXYgY2xhc3M9Im51bS12YWwiPiske2EudG9kYXlTY29yZSB8fCAwfTwvZGl2PjxkaXYgY2xhc3M9Im51bS1kZXNjIj7ku4rml6Xnp6/liIY8L2Rpdj48L2Rpdj4KICAgIDxkaXYgY2xhc3M9Im51bS1pdGVtIj48ZGl2IGNsYXNzPSJudW0tdmFsIj4ke2EuY29udGludWVEYXlzIHx8IDB9PC9kaXY+PGRpdiBjbGFzcz0ibnVtLWRlc2MiPui/nuetvuWkqeaVsDwvZGl2PjwvZGl2PgogICAgPGRpdiBjbGFzcz0ibnVtLWl0ZW0iPjxkaXYgY2xhc3M9Im51bS12YWwiPiR7YnJ9PC9kaXY+PGRpdiBjbGFzcz0ibnVtLWRlc2MiPui3neebsuebkijlpKkpPC9kaXY+PC9kaXY+CiAgPC9kaXY+CiAgPGRpdiBjbGFzcz0icHJvZ3Jlc3Mtd3JhcCI+CiAgICA8ZGl2IGNsYXNzPSJwcm9ncmVzcy10aXRsZSI+PHNwYW4+55uy55uS6L+b5bqmPC9zcGFuPjxzcGFuPiR7Ym59LyR7YnR9IMK3ICR7cGN0fSU8L3NwYW4+PC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJwcm9ncmVzcy1iYXIiPjxkaXYgY2xhc3M9InByb2dyZXNzLWZpbGwiIHN0eWxlPSJ3aWR0aDoke3BjdH0lIj48L2Rpdj48L2Rpdj4KICA8L2Rpdj4KICAke2NkTGluZX0KICA8ZGl2IGNsYXNzPSJjYWxlbmRhci1yb3ciPiR7Y2FsfTwvZGl2Pgo8L2Rpdj5gOwogIH0sCgogIHN0YXJ0Q291bnRkb3duKCkgewogICAgaWYgKHRoaXMuX2NkVGltZXIpIHJldHVybjsKICAgIGNvbnN0IHVwZGF0ZSA9ICgpID0+IHsKICAgICAgY29uc3QgZWxzID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgiW2RhdGEtcmVtXSIpOwogICAgICBpZiAoIWVscy5sZW5ndGgpIHJldHVybjsKICAgICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTsKICAgICAgY29uc3QgbWlkID0gbmV3IERhdGUobm93KTsKICAgICAgbWlkLnNldEhvdXJzKDI0LCAwLCAwLCAwKTsKICAgICAgbGV0IGRpZmYgPSBtaWQgLSBub3c7CiAgICAgIGlmIChkaWZmIDwgMCkgZGlmZiA9IDA7CiAgICAgIGNvbnN0IGggPSBTdHJpbmcoTWF0aC5mbG9vcihkaWZmIC8gMzYwMDAwMCkpLnBhZFN0YXJ0KDIsICIwIik7CiAgICAgIGNvbnN0IG0gPSBTdHJpbmcoTWF0aC5mbG9vcihkaWZmICUgMzYwMDAwMCAvIDYwMDAwKSkucGFkU3RhcnQoMiwgIjAiKTsKICAgICAgY29uc3QgcyA9IFN0cmluZyhNYXRoLmZsb29yKGRpZmYgJSA2MDAwMCAvIDEwMDApKS5wYWRTdGFydCgyLCAiMCIpOwogICAgICBlbHMuZm9yRWFjaChlbCA9PiB7IGVsLnRleHRDb250ZW50ID0gZWwuZGF0YXNldC5yZW0gKyAi5aSpICIgKyBoICsgIjoiICsgbSArICI6IiArIHM7IH0pOwogICAgfTsKICAgIHVwZGF0ZSgpOwogICAgdGhpcy5fY2RUaW1lciA9IHNldEludGVydmFsKHVwZGF0ZSwgMTAwMCk7CiAgfSwKCiAgcmVuZGVyTG9nKCkgewogICAgY29uc3QgYXBwID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImFwcCIpOwogICAgbGV0IGh0bWwgPSBgCjxkaXYgY2xhc3M9ImhlYWRlciI+CiAgPGRpdiBjbGFzcz0ibG9nbyI+WjwvZGl2PgogIDxkaXYgY2xhc3M9InRpdGxlLWdyb3VwIj4KICAgIDxoMT7mk43kvZzml6Xlv5c8c3BhbiBjbGFzcz0iYmFkZ2UtbGl0ZSI+TElURSAke3RoaXMuc3RhdGUudmVyc2lvbn08L3NwYW4+PC9oMT4KICAgIDxkaXYgY2xhc3M9InN1YnRpdGxlIj7nrb7liLDorrDlvZXjgIHmjqXlj6Pov5Tlm57ml6Xlv5c8L2Rpdj4KICA8L2Rpdj4KPC9kaXY+YDsKICAgIGlmICh0aGlzLnN0YXRlLmxvZ0xpc3QubGVuZ3RoKSB7CiAgICAgIGh0bWwgKz0gJzxkaXYgc3R5bGU9ImZvbnQtc2l6ZToxMnB4O2NvbG9yOiM4YTk5YWE7bWFyZ2luLWJvdHRvbToxMHB4Ij7mnIDov5EgJyArIHRoaXMuc3RhdGUubG9nTGlzdC5sZW5ndGggKyAnIOadoe+8iHplZWhvX2xvZ3PvvIk8L2Rpdj4nOwogICAgICBodG1sICs9IHRoaXMuc3RhdGUubG9nTGlzdC5tYXAoeCA9PiBgPGRpdiBjbGFzcz0ibG9nLWl0ZW0iPiR7eH08L2Rpdj5gKS5qb2luKCIiKTsKICAgIH0gZWxzZSB7CiAgICAgIGh0bWwgKz0gJzxkaXYgY2xhc3M9InNldHRpbmctYmxvY2siPuaaguaXoOaXpeW/lzxici8+PHNwYW4gc3R5bGU9ImZvbnQtc2l6ZToxMnB4O2NvbG9yOiM4YTk5YWEiPuWumuaXtuetvuWIsOaJp+ihjOWQjuS8muiHquWKqOWGmeWFpeaXpeW/l++8jOeCueWHu+WPs+S4iuinkuWIt+aWsOWPr+mHjeaWsOaLieWPluOAgjwvc3Bhbj48L2Rpdj4nOwogICAgfQogICAgYXBwLmlubmVySFRNTCA9IGh0bWw7CiAgfSwKCiAgcmVuZGVyU2V0dGluZygpIHsKICAgIGNvbnN0IGFwcCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJhcHAiKTsKICAgIGNvbnN0IGNmZyA9IHRoaXMuc3RhdGUuY29uZmlnOwogICAgY29uc3QgbGlzdCA9IHRoaXMuc3RhdGUuYWNjb3VudExpc3Q7CiAgICBsZXQgcm93cyA9ICIiOwogICAgaWYgKGxpc3QubGVuZ3RoKSB7CiAgICAgIHJvd3MgPSBsaXN0Lm1hcChhID0+IHsKICAgICAgICBjb25zdCBpbnZhbGlkID0gIWEudG9rZW5TdGF0dXM7CiAgICAgICAgcmV0dXJuIGAKPGRpdiBjbGFzcz0iYmFyay1yb3ciPgogIDxkaXYgY2xhc3M9ImJhcmstaWQiPgogICAgPGRpdiBjbGFzcz0iYmFyay1uYW1lIiBzdHlsZT0iJHtpbnZhbGlkID8gImNvbG9yOiNmZjU0NzAiIDogIiJ9Ij4ke2EubmFtZSB8fCAiLS0ifTwvZGl2PgogICAgPGRpdiBjbGFzcz0iYmFyay1zdWIiPiR7YS51aWQgfHwgYS5rZXkgfHwgIiJ9PC9kaXY+CiAgPC9kaXY+CiAgPGlucHV0IGlkPSJiYXJrLSR7YS5rZXl9IiB0eXBlPSJ0ZXh0IiBwbGFjZWhvbGRlcj0iQmFya0tlee+8iOWPr+mAie+8iSIgdmFsdWU9IiR7YS5iYXJrS2V5IHx8ICIifSIvPgogIDxidXR0b24gY2xhc3M9ImJ0biBidG4tZ2hvc3QiIG9uY2xpY2s9IkFwcC5zYXZlQmFyaygnJHthLmtleX0nKSI+5L+d5a2YPC9idXR0b24+CiAgPGJ1dHRvbiBjbGFzcz0iYnRuIGJ0bi1wcmltYXJ5IiBvbmNsaWNrPSJBcHAudGVzdEJhcmsoJyR7YS5rZXl9JykiPua1i+ivlTwvYnV0dG9uPgo8L2Rpdj5gOwogICAgICB9KS5qb2luKCIiKTsKICAgIH0gZWxzZSB7CiAgICAgIHJvd3MgPSAnPGRpdiBjbGFzcz0iZW1wdHkiPuaaguaXoOi0puWPt+aVsOaNru+8jOivt+WFiOWcqOWuouaIt+err+S4iuS8oOmFjee9rjwvZGl2Pic7CiAgICB9CiAgICBhcHAuaW5uZXJIVE1MID0gYAo8ZGl2IGNsYXNzPSJoZWFkZXIiPgogIDxkaXYgY2xhc3M9ImxvZ28iPlo8L2Rpdj4KICA8ZGl2IGNsYXNzPSJ0aXRsZS1ncm91cCI+CiAgICA8aDE+6K6+572uPHNwYW4gY2xhc3M9ImJhZGdlLWxpdGUiPkxJVEUgJHt0aGlzLnN0YXRlLnZlcnNpb259PC9zcGFuPjwvaDE+CiAgICA8ZGl2IGNsYXNzPSJzdWJ0aXRsZSI+562+5Yiw6YWN572uIMK3IOi0puWPt+euoeeQhiDCtyDlr7zlh7ogVG9rZW48L2Rpdj4KICA8L2Rpdj4KPC9kaXY+CjxkaXYgY2xhc3M9InNldHRpbmctYmxvY2siPgogIDxkaXYgY2xhc3M9InNldHRpbmctdGl0bGUiPuetvuWIsOmFjee9rjwvZGl2PgogIDxkaXYgY2xhc3M9ImNmZy1yb3ciPgogICAgPHNwYW4gY2xhc3M9ImNmZy1sYWJlbCI+6Ieq5Yqo562+5YiwPC9zcGFuPgogICAgPGxhYmVsIGNsYXNzPSJzd2l0Y2giPjxpbnB1dCB0eXBlPSJjaGVja2JveCIgaWQ9ImNmZy1zaWduaW4iICR7Y2ZnLnNpZ25pbkVuYWJsZWQgPyAiY2hlY2tlZCIgOiAiIn0vPjxzcGFuIGNsYXNzPSJzbGlkZXIiPjwvc3Bhbj48L2xhYmVsPgogIDwvZGl2PgogIDxkaXYgY2xhc3M9ImNmZy1yb3ciPgogICAgPHNwYW4gY2xhc3M9ImNmZy1sYWJlbCI+55uy55uS6Ieq5Yqo5oq95Y+WPC9zcGFuPgogICAgPGxhYmVsIGNsYXNzPSJzd2l0Y2giPjxpbnB1dCB0eXBlPSJjaGVja2JveCIgaWQ9ImNmZy1ibGluZCIgJHtjZmcuYmxpbmRCb3hBdXRvID8gImNoZWNrZWQiIDogIiJ9Lz48c3BhbiBjbGFzcz0ic2xpZGVyIj48L3NwYW4+PC9sYWJlbD4KICA8L2Rpdj4KICA8ZGl2IGNsYXNzPSJjZmctcm93Ij4KICAgIDxzcGFuIGNsYXNzPSJjZmctbGFiZWwiPkJhcmsg6YCa55+lPC9zcGFuPgogICAgPGxhYmVsIGNsYXNzPSJzd2l0Y2giPjxpbnB1dCB0eXBlPSJjaGVja2JveCIgaWQ9ImNmZy1iYXJrIiAke2NmZy5iYXJrTm90aWZ5ID8gImNoZWNrZWQiIDogIiJ9Lz48c3BhbiBjbGFzcz0ic2xpZGVyIj48L3NwYW4+PC9sYWJlbD4KICA8L2Rpdj4KICA8ZGl2IGNsYXNzPSJjZmctcm93Ij4KICAgIDxzcGFuIGNsYXNzPSJjZmctbGFiZWwiPuetvuWIsOaXtumXtO+8iOWPguiAg++8iTwvc3Bhbj4KICAgIDxpbnB1dCBjbGFzcz0iY2ZnLWlucHV0IiBpZD0iY2ZnLXRpbWUiIHZhbHVlPSIke2NmZy5zaWduaW5UaW1lIHx8ICIifSIgcGxhY2Vob2xkZXI9IuWmgiAwODozMCIvPgogIDwvZGl2PgogIDxkaXYgY2xhc3M9ImNmZy1yb3ciPgogICAgPHNwYW4gY2xhc3M9ImNmZy1sYWJlbCI+5Luj55CG5ZCO56uv5Zyw5Z2APC9zcGFuPgogICAgPGlucHV0IGNsYXNzPSJjZmctaW5wdXQiIGlkPSJjZmctZG9tYWluIiB2YWx1ZT0iJHtjZmcuYXBpRG9tYWluIHx8IERFRkFVTFRfRE9NQUlOfSIgcGxhY2Vob2xkZXI9IiR7REVGQVVMVF9ET01BSU59Ii8+CiAgPC9kaXY+CiAgPGRpdiBjbGFzcz0iY2ZnLWhpbnQiPumFjee9rueUsemdouadv+S/neWtmOWIsCB6ZWVob19jb25maWfvvIzlrprml7bnrb7liLDvvIjlkIzkuIDohJrmnKznmoQgQ1JPTiDmqKHlvI/vvInoh6rliqjor7vlj5bjgIJMb29uIOaPkuS7tuS4reeahCBjcm9uIOaXtumXtOmcgOS4juatpOWkhOOAjOetvuWIsOaXtumXtOOAjeS/neaMgeS4gOiHtOOAgjwvZGl2PgogIDxkaXYgc3R5bGU9Im1hcmdpbi10b3A6MTJweCI+PGJ1dHRvbiBjbGFzcz0iYnRuIGJ0bi1wcmltYXJ5IiBvbmNsaWNrPSJBcHAuc2F2ZUNvbmZpZygpIj7kv53lrZjnrb7liLDphY3nva48L2J1dHRvbj48L2Rpdj4KPC9kaXY+CjxkaXYgY2xhc3M9InNldHRpbmctYmxvY2siPgogIDxkaXYgY2xhc3M9InNldHRpbmctdGl0bGUiPui0puWPt+euoeeQhu+8iCR7bGlzdC5sZW5ndGh977yJPC9kaXY+CiAgPGRpdiBzdHlsZT0iZm9udC1zaXplOjEycHg7Y29sb3I6IzhhOTlhYTttYXJnaW4tYm90dG9tOjEycHgiPuavj+S4qui0puWPt+WPr+WNleeLrOmFjee9riBCYXJrS2V577yIaU9TIOaOqOmAge+8ie+8jOS/neWtmOWQjuWPr+WPkemAgea1i+ivleaOqOmAgeOAgjwvZGl2PgogICR7cm93c30KPC9kaXY+CjxkaXYgY2xhc3M9InNldHRpbmctYmxvY2siPgogIDxkaXYgY2xhc3M9InNldHRpbmctdGl0bGUiPuS4gOmUruWvvOWHuiBUb2tlbjwvZGl2PgogIDxkaXYgc3R5bGU9ImZvbnQtc2l6ZToxMnB4O2NvbG9yOiM4YTk5YWE7bWFyZ2luLWJvdHRvbToxMHB4Ij7lr7zlh7rlhajpg6jotKblj7fnmoQgVG9rZW4gLyBCYXJrS2V577yM5L6/5LqO5aSH5Lu95oiW6L+B56e75Yiw5YW25LuW6K6+5aSH44CCPC9kaXY+CiAgPGJ1dHRvbiBjbGFzcz0iYnRuIGJ0bi1wcmltYXJ5IiBvbmNsaWNrPSJBcHAuZXhwb3J0VG9rZW5zKCkiPvCfk4sg5LiA6ZSu5a+85Ye6PC9idXR0b24+CiAgPGJ1dHRvbiBjbGFzcz0iYnRuIGJ0bi1naG9zdCIgb25jbGljaz0iQXBwLmNvcHlFeHBvcnQoKSIgc3R5bGU9Im1hcmdpbi1sZWZ0OjhweCI+5aSN5Yi2PC9idXR0b24+CiAgPHRleHRhcmVhIGlkPSJleHBvcnRBcmVhIiBjbGFzcz0iZXhwb3J0LWFyZWEiIHBsYWNlaG9sZGVyPSLngrnlh7vjgIzkuIDplK7lr7zlh7rjgI3nlJ/miJAgVG9rZW4g5riF5Y2V4oCmIiByZWFkb25seT48L3RleHRhcmVhPgo8L2Rpdj4KPGRpdiBjbGFzcz0ic2V0dGluZy1ibG9jayI+CiAgPGRpdiBjbGFzcz0ic2V0dGluZy10aXRsZSI+54mI5pysPC9kaXY+CiAgPGRpdj5aRUVITy1MSVRFLUVuaGFuY2VkICR7dGhpcy5zdGF0ZS52ZXJzaW9ufTwvZGl2PgogIDxkaXYgc3R5bGU9ImZvbnQtc2l6ZToxMnB4O2NvbG9yOiM4YTk5YWE7bWFyZ2luLXRvcDo0cHgiPuiEmuacrCB2Mi4xNC4xIMK3IOaehOW7uiAyMDI2LTA5LTEyIMK3IOmdouadvyArIOWumuaXtuetvuWIsOS4gOS9kzwvZGl2Pgo8L2Rpdj5gOwogIH0sCgogIGFzeW5jIHNhdmVDb25maWcoKSB7CiAgICBjb25zdCBwcmV2ID0gdGhpcy5zdGF0ZS5jb25maWc7CiAgICBjb25zdCB0aW1lVmFsID0gKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJjZmctdGltZSIpLnZhbHVlIHx8ICIiKS50cmltKCk7CiAgICBjb25zdCBkb21haW5WYWwgPSAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImNmZy1kb21haW4iKS52YWx1ZSB8fCAiIikudHJpbSgpOwogICAgY29uc3QgY2ZnID0gewogICAgICBzaWduaW5FbmFibGVkOiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiY2ZnLXNpZ25pbiIpLmNoZWNrZWQsCiAgICAgIGJsaW5kQm94QXV0bzogZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImNmZy1ibGluZCIpLmNoZWNrZWQsCiAgICAgIGJhcmtOb3RpZnk6IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJjZmctYmFyayIpLmNoZWNrZWQsCiAgICAgIHNpZ25pblRpbWU6IHRpbWVWYWwgfHwgcHJldi5zaWduaW5UaW1lIHx8ICIwODozMCIsCiAgICAgIGFwaURvbWFpbjogZG9tYWluVmFsIHx8IHByZXYuYXBpRG9tYWluIHx8IERFRkFVTFRfRE9NQUlOCiAgICB9OwogICAgdHJ5IHsKICAgICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goIi9hcGkvY29uZmlnIiwgewogICAgICAgIG1ldGhvZDogIlBPU1QiLAogICAgICAgIGhlYWRlcnM6IHsgIkNvbnRlbnQtVHlwZSI6ICJhcHBsaWNhdGlvbi9qc29uIiB9LAogICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGNmZykKICAgICAgfSk7CiAgICAgIGNvbnN0IGpzb24gPSBhd2FpdCByZXMuanNvbigpOwogICAgICBpZiAoanNvbi5vaykgewogICAgICAgIHRoaXMuc3RhdGUuY29uZmlnID0gT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5zdGF0ZS5jb25maWcsIGpzb24uY29uZmlnIHx8IGNmZyk7CiAgICAgICAgdGhpcy50b2FzdCgi562+5Yiw6YWN572u5bey5L+d5a2YIik7CiAgICAgIH0gZWxzZSB7CiAgICAgICAgdGhpcy50b2FzdChqc29uLm1zZyB8fCAi5L+d5a2Y5aSx6LSlIik7CiAgICAgIH0KICAgIH0gY2F0Y2ggKGUpIHsKICAgICAgdGhpcy50b2FzdCgi5L+d5a2Y5aSx6LSlIik7CiAgICB9CiAgfSwKCiAgYXN5bmMgc2F2ZUJhcmsoa2V5KSB7CiAgICBjb25zdCBpbnB1dCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJiYXJrLSIgKyBrZXkpOwogICAgY29uc3QgYmFya0tleSA9IChpbnB1dCAmJiBpbnB1dC52YWx1ZSB8fCAiIikudHJpbSgpOwogICAgdHJ5IHsKICAgICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goIi9hcGkvYmFyayIsIHsKICAgICAgICBtZXRob2Q6ICJQT1NUIiwKICAgICAgICBoZWFkZXJzOiB7ICJDb250ZW50LVR5cGUiOiAiYXBwbGljYXRpb24vanNvbiIgfSwKICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGtleSwgYmFya0tleSB9KQogICAgICB9KTsKICAgICAgY29uc3QganNvbiA9IGF3YWl0IHJlcy5qc29uKCk7CiAgICAgIHRoaXMudG9hc3QoanNvbi5vayA/ICJCYXJrS2V5IOW3suS/neWtmCIgOiAoanNvbi5tc2cgfHwgIuS/neWtmOWksei0pSIpKTsKICAgICAgY29uc3QgYSA9IHRoaXMuc3RhdGUuYWNjb3VudExpc3QuZmluZCh4ID0+IHgua2V5ID09PSBrZXkpOwogICAgICBpZiAoYSkgYS5iYXJrS2V5ID0gYmFya0tleTsKICAgIH0gY2F0Y2ggKGUpIHsKICAgICAgdGhpcy50b2FzdCgi5L+d5a2Y5aSx6LSlIik7CiAgICB9CiAgfSwKCiAgYXN5bmMgdGVzdEJhcmsoa2V5KSB7CiAgICBjb25zdCBhID0gdGhpcy5zdGF0ZS5hY2NvdW50TGlzdC5maW5kKHggPT4geC5rZXkgPT09IGtleSk7CiAgICBpZiAoIWEgfHwgIWEuYmFya0tleSkgeyB0aGlzLnRvYXN0KCLor7flhYjkv53lrZggQmFya0tleSIpOyByZXR1cm47IH0KICAgIHRoaXMudG9hc3QoIuato+WcqOWPkemAgea1i+ivleaOqOmAgeKApiIpOwogICAgdHJ5IHsKICAgICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goIi9hcGkvdGVzdC1iYXJrIiwgewogICAgICAgIG1ldGhvZDogIlBPU1QiLAogICAgICAgIGhlYWRlcnM6IHsgIkNvbnRlbnQtVHlwZSI6ICJhcHBsaWNhdGlvbi9qc29uIiB9LAogICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsga2V5IH0pCiAgICAgIH0pOwogICAgICBjb25zdCBqc29uID0gYXdhaXQgcmVzLmpzb24oKTsKICAgICAgdGhpcy50b2FzdChqc29uLm9rID8gKGpzb24ubXNnIHx8ICLmjqjpgIHmiJDlip8iKSA6ICgi5o6o6YCB5aSx6LSl77yaIiArIChqc29uLm1zZyB8fCAiIikpKTsKICAgIH0gY2F0Y2ggKGUpIHsKICAgICAgdGhpcy50b2FzdCgi5o6o6YCB5aSx6LSlIik7CiAgICB9CiAgfSwKCiAgYXN5bmMgZXhwb3J0VG9rZW5zKCkgewogICAgdHJ5IHsKICAgICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goIi9hcGkvZXhwb3J0Iik7CiAgICAgIGNvbnN0IGpzb24gPSBhd2FpdCByZXMuanNvbigpOwogICAgICBpZiAoanNvbi5vaykgewogICAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJleHBvcnRBcmVhIikudmFsdWUgPSBqc29uLnRleHQ7CiAgICAgICAgdGhpcy50b2FzdCgi5a+85Ye65oiQ5Yqf77yM5Y+v5aSN5Yi2Iik7CiAgICAgIH0gZWxzZSB7CiAgICAgICAgdGhpcy50b2FzdChqc29uLm1zZyB8fCAi5a+85Ye65aSx6LSlIik7CiAgICAgIH0KICAgIH0gY2F0Y2ggKGUpIHsKICAgICAgdGhpcy50b2FzdCgi5a+85Ye65aSx6LSlIik7CiAgICB9CiAgfSwKCiAgY29weUV4cG9ydCgpIHsKICAgIGNvbnN0IHRhID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImV4cG9ydEFyZWEiKTsKICAgIGlmICghdGEgfHwgIXRhLnZhbHVlKSB7IHRoaXMudG9hc3QoIuivt+WFiOS4gOmUruWvvOWHuiIpOyByZXR1cm47IH0KICAgIHRhLnNlbGVjdCgpOwogICAgdGEuc2V0U2VsZWN0aW9uUmFuZ2UoMCwgOTk5OTk5KTsKICAgIGxldCBkb25lID0gKCkgPT4gdGhpcy50b2FzdCgi5bey5aSN5Yi25Yiw5Ymq6LS05p2/Iik7CiAgICBsZXQgZmFpbCA9ICgpID0+IHsgdHJ5IHsgZG9jdW1lbnQuZXhlY0NvbW1hbmQoImNvcHkiKTsgZG9uZSgpOyB9IGNhdGNoIChlKSB7IHRoaXMudG9hc3QoIuWkjeWItuWksei0pe+8jOivt+aJi+WKqOmVv+aMieWkjeWItiIpOyB9IH07CiAgICBpZiAobmF2aWdhdG9yLmNsaXBib2FyZCAmJiBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCkgewogICAgICBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCh0YS52YWx1ZSkudGhlbihkb25lLCBmYWlsKTsKICAgIH0gZWxzZSB7CiAgICAgIGZhaWwoKTsKICAgIH0KICB9LAoKICBiaW5kVGFiKCkgewogICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgiLnRhYi1pdGVtIikuZm9yRWFjaChlbCA9PiB7CiAgICAgIGVsLm9uY2xpY2sgPSAoKSA9PiB7CiAgICAgICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgiLnRhYi1pdGVtIikuZm9yRWFjaCh0ID0+IHQuY2xhc3NMaXN0LnJlbW92ZSgiYWN0aXZlIikpOwogICAgICAgIGVsLmNsYXNzTGlzdC5hZGQoImFjdGl2ZSIpOwogICAgICAgIHRoaXMuc3RhdGUucGFnZSA9IGVsLmRhdGFzZXQucGFnZTsKICAgICAgICB0aGlzLnJlbmRlcigpOwogICAgICB9OwogICAgfSk7CiAgfSwKCiAgaW5pdCgpIHsKICAgIHRoaXMuYmluZFRhYigpOwogICAgdGhpcy5pbml0RGF0YSgpOwogIH0KfTsKd2luZG93Lm9ubG9hZCA9ICgpID0+IEFwcC5pbml0KCk7Cjwvc2NyaXB0Pgo8L2JvZHk+CjwvaHRtbD4K";

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