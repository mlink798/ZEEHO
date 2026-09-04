/*
#!name=极核 ZEEHO 每日签到
#!desc=极核打开我的页面自动捕获 user_id/Authorization，每日定时自动签到+盲盒+社区互动任务，多账号支持。仅供个人学习使用。
#!author=lucky
#!version=2.4.0
图标: https://cdn.jsdelivr.net/gh/mlink798/ZEEHO@main/ZEEHO.png

[Script]
# 获取 Cookie：打开极核App-我的，自动捕获 Authorization/userId
http-response ^https:\/\/tapi\.zeehoev\.com\/v1\.0\/mine\/cfmotoservermine\/setting script-path=https://cdn.jsdelivr.net/gh/mlink798/ZEEHO@main/script/zeeho.js, requires-body=true, timeout=30, tag=极核抓Token

# 定时签到：每天早上7点自动签到+盲盒+社区任务
cron "0 7 * * *" script-path=https://cdn.jsdelivr.net/gh/mlink798/ZEEHO@main/script/zeeho.js, timeout=120, tag=极核每日签到

[MITM]
hostname = tapi.zeehoev.com, h5.zeehoev.com
 */

// ==================== 环境适配类 ====================
function Env(name, opts) {
  return new class {
    constructor(name, opts) {
      this.name = name;
      this.data = null;
      this.dataFile = "box.dat";
      this.logs = [];
      this.isMute = false;
      this.logSeparator = "\n";
      this.startTime = new Date().getTime();
      Object.assign(this, opts);
      this.log("", `🔔${this.name}, 开始!`);
    }
    getEnv() {
      if (typeof $task !== "undefined") return "Quantumult X";
      if (typeof $loon !== "undefined") return "Loon";
      if (typeof $rocket !== "undefined") return "Shadowrocket";
      if (typeof module !== "undefined" && module.exports) return "Node.js";
      if (typeof $environment !== "undefined" && $environment["surge-version"]) return "Surge";
      return "Unknown";
    }
    isNode() { return this.getEnv() === "Node.js"; }
    isQuanX() { return this.getEnv() === "Quantumult X"; }
    isSurge() { return this.getEnv() === "Surge"; }
    isLoon() { return this.getEnv() === "Loon"; }
    toObj(str, defaultValue = null) { try { return JSON.parse(str); } catch { return defaultValue; } }
    toStr(obj, defaultValue = null) { try { return JSON.stringify(obj); } catch { return defaultValue; } }
    getjson(key, defaultValue) {
      let val = defaultValue;
      if (this.getdata(key)) { try { val = JSON.parse(this.getdata(key)); } catch {} }
      return val;
    }
    setjson(obj, key) { try { return this.setdata(JSON.stringify(obj), key); } catch { return false; } }
    getdata(key) {
      let val = this.getval(key);
      if (/^@/.test(key)) {
        const [, objKey, path] = /^@(.*?)\.(.*?)$/.exec(key);
        const obj = objKey ? this.getval(objKey) : "";
        if (obj) {
          try {
            const parsed = JSON.parse(obj);
            val = path.split(".").reduce((o, k) => o?.[k], parsed) ?? "";
          } catch {}
        }
      }
      return val;
    }
    setdata(val, key) {
      let success = false;
      if (/^@/.test(key)) {
        const [, objKey, path] = /^@(.*?)\.(.*?)$/.exec(key);
        const obj = this.getval(objKey) || "{}";
        try {
          const parsed = JSON.parse(obj);
          path.split(".").reduce((o, k, i, arr) => {
            if (i === arr.length - 1) o[k] = val;
            return o[k] = o[k] || {};
          }, parsed);
          success = this.setval(JSON.stringify(parsed), objKey);
        } catch {}
      } else {
        success = this.setval(val, key);
      }
      return success;
    }
    getval(key) {
      switch (this.getEnv()) {
        case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Egern":
          return $persistentStore.read(key);
        case "Quantumult X":
          return $prefs.valueForKey(key);
        case "Node.js":
          this.data = this.loaddata();
          return this.data[key];
        default:
          return this.data?.[key] ?? null;
      }
    }
    setval(val, key) {
      switch (this.getEnv()) {
        case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Egern":
          return $persistentStore.write(val, key);
        case "Quantumult X":
          return $prefs.setValueForKey(val, key);
        case "Node.js":
          this.data = this.loaddata();
          this.data[key] = val;
          this.writedata();
          return true;
        default:
          return false;
      }
    }
    loaddata() {
      if (!this.isNode()) return {};
      const fs = require("fs"), path = require("path");
      const dataPath = path.resolve(this.dataFile);
      if (fs.existsSync(dataPath)) {
        try { return JSON.parse(fs.readFileSync(dataPath, "utf-8")); } catch { return {}; }
      }
      return {};
    }
    writedata() {
      if (this.isNode()) {
        const fs = require("fs"), path = require("path");
        fs.writeFileSync(path.resolve(this.dataFile), JSON.stringify(this.data));
      }
    }
    // HTTP请求：Env实例自带get/post/send（callback风格，兼容Loon/Surge/QuanX/Node）
    get(request, callback) { this.send(request, "GET", callback); }
    post(request, callback) { this.send(request, "POST", callback); }
    send(request, method, callback) {
      request = typeof request === "string" ? { url: request } : request;
      request.method = method;
      switch (this.getEnv()) {
        case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Egern":
        default:
          $httpClient[method.toLowerCase()](request, (err, resp, body) => {
            if (!err && resp) { resp.body = body; resp.statusCode = resp.status ?? resp.statusCode; }
            callback(err, resp, body);
          });
          break;
        case "Quantumult X":
          $task.fetch(request).then(resp => callback(null, resp, resp.body), err => callback(err));
          break;
        case "Node.js":
          const https = require("https");
          const url = new URL(request.url);
          const options = {
            hostname: url.hostname, path: url.pathname + url.search,
            method: method, headers: request.headers || {}, timeout: request.timeout || 15000
          };
          const req = https.request(options, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
              const resp = { statusCode: res.statusCode, headers: res.headers, body: data };
              callback(null, resp, data);
            });
          });
          req.on("error", err => callback(err));
          if (request.body) req.write(request.body);
          req.end();
          break;
      }
    }
    // $.http：Promise风格封装（供Request函数使用）
    get http() {
      const self = this;
      return {
        get: (request) => new Promise((resolve, reject) => {
          self.get(request, (err, resp) => { err ? reject(err) : resolve(resp); });
        }),
        post: (request) => new Promise((resolve, reject) => {
          self.post(request, (err, resp) => { err ? reject(err) : resolve(resp); });
        })
      };
    }
    time(fmt, ts = null) {
      const date = ts ? new Date(ts) : new Date();
      const pad = n => String(n).padStart(2, "0");
      return fmt
        .replace("YYYY", date.getFullYear())
        .replace("MM", pad(date.getMonth() + 1))
        .replace("DD", pad(date.getDate()))
        .replace("HH", pad(date.getHours()))
        .replace("mm", pad(date.getMinutes()))
        .replace("ss", pad(date.getSeconds()));
    }
    queryStr(obj) {
      return Object.entries(obj)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(typeof v === "object" ? JSON.stringify(v) : v)}`)
        .join("&");
    }
    msg(title = "", subtitle = "", body = "", opts = {}) {
      if (this.isMute) return;
      const env = this.getEnv();
      if (env === "Surge" || env === "Loon" || env === "Stash" || env === "Shadowrocket" || env === "Egern") {
        $notification.post(title, subtitle, body, opts);
      } else if (env === "Quantumult X") {
        $notify(title, subtitle, body, opts);
      }
      this.logs = this.logs.concat(["", "==============📣系统通知📣==============", title, subtitle, body]);
    }
    log(...logs) { logs.forEach(log => { console.log(log); this.logs.push(log); }); }
    logErr(err) { this.log("", `❗️${this.name}, 错误!`, err?.message ?? err); }
    wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    done(val = {}) {
      const duration = ((new Date().getTime() - this.startTime) / 1000).toFixed(2);
      this.log("", `🔔${this.name}, 结束! 🕛 ${duration} 秒`);
      if (this.isNode()) process.exit(0);
      else $done(val);
    }
  }(name, opts);
}

// ==================== 全局变量 ====================
const $ = new Env("极核-ZEEHO");
const ckName = "zeeho_data";
const Notify = 1; // 0=关闭通知, 1=打开通知
let userCookie = ($.isNode() ? process.env[ckName] : $.getdata(ckName)) || "";
let userList = [];
let userIdx = 0;
$.notifyMsg = [];
$.successCount = 0;
$.failCount = 0;

// ==================== 工具函数 ====================
function randomInt(min, max) { return Math.round(Math.random() * (max - min) + min); }

// 生成随机字符串（app端nonce用）
function randomChars(n) {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < n; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

function getUuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function ObjectKeys2LowerCase(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
}

// MD5算法
function md5(string) {
  function add32(a, b) { return (a + b) & 0xFFFFFFFF; }
  function cmn(q, a, b, x, s, t) { a = add32(add32(a, q), add32(x, t)); return add32((a << s) | (a >>> (32 - s)), b); }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
  function md5cycle(x, k) {
    let a = x[0], b = x[1], c = x[2], d = x[3];
    a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586);
    c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426);
    c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417);
    c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101);
    c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
    a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632);
    c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083);
    c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690);
    c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784);
    c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);
    a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463);
    c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353);
    c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222);
    c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
    a = hh(a, b, c, d, k[9], 4, -640364485); d = hh(d, a, b, c, k[12], 11, -421815835);
    c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651);
    a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415);
    c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606);
    c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744);
    c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379);
    c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);
    x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
  }
  function md5blk(s) {
    const md5blks = [];
    for (let i = 0; i < 64; i += 4) {
      md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
    }
    return md5blks;
  }
  function md51(s) {
    const n = s.length;
    const state = [1732584193, -271733879, -1732584194, 271733878];
    let i;
    for (i = 64; i <= n; i += 64) md5cycle(state, md5blk(s.substring(i - 64, i)));
    s = s.substring(i - 64);
    const tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (i = 0; i < s.length; i++) tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
    tail[i >> 2] |= 0x80 << ((i % 4) << 3);
    if (i > 55) { md5cycle(state, tail); for (i = 0; i < 16; i++) tail[i] = 0; }
    tail[14] = n * 8;
    md5cycle(state, tail);
    return state;
  }
  function rhex(n) {
    let s = "";
    for (let j = 0; j < 4; j++) s += ((n >> (j * 8 + 4)) & 0x0F).toString(16) + ((n >> (j * 8)) & 0x0F).toString(16);
    return s;
  }
  return rhex(md51(string)[0]) + rhex(md51(string)[1]) + rhex(md51(string)[2]) + rhex(md51(string)[3]);
}

// SHA1算法
function sha1(msg) {
  function rotate_left(n, s) { return (n << s) | (n >>> (32 - s)); }
  function cvt_hex(val) {
    let str = "";
    for (let i = 7; i >= 0; i--) str += ((val >>> (i * 4)) & 0x0f).toString(16);
    return str;
  }
  function Utf8Encode(string) {
    string = string.replace(/\r\n/g, "\n");
    let utftext = "";
    for (let n = 0; n < string.length; n++) {
      const c = string.charCodeAt(n);
      if (c < 128) utftext += String.fromCharCode(c);
      else if (c > 127 && c < 2048) {
        utftext += String.fromCharCode((c >> 6) | 192);
        utftext += String.fromCharCode((c & 63) | 128);
      } else {
        utftext += String.fromCharCode((c >> 12) | 224);
        utftext += String.fromCharCode(((c >> 6) & 63) | 128);
        utftext += String.fromCharCode((c & 63) | 128);
      }
    }
    return utftext;
  }
  msg = Utf8Encode(msg);
  const msg_len = msg.length;
  const word_array = [];
  for (let i = 0; i < msg_len - 3; i += 4) {
    word_array.push(msg.charCodeAt(i) << 24 | msg.charCodeAt(i + 1) << 16 | msg.charCodeAt(i + 2) << 8 | msg.charCodeAt(i + 3));
  }
  switch (msg_len % 4) {
    case 0: word_array.push(0x080000000); break;
    case 1: word_array.push(msg.charCodeAt(msg_len - 1) << 24 | 0x0800000); break;
    case 2: word_array.push(msg.charCodeAt(msg_len - 2) << 24 | msg.charCodeAt(msg_len - 1) << 16 | 0x08000); break;
    case 3: word_array.push(msg.charCodeAt(msg_len - 3) << 24 | msg.charCodeAt(msg_len - 2) << 16 | msg.charCodeAt(msg_len - 1) << 8 | 0x80); break;
  }
  while ((word_array.length % 16) !== 14) word_array.push(0);
  word_array.push(msg_len >>> 29);
  word_array.push((msg_len << 3) & 0x0ffffffff);
  const W = new Array(80);
  let H0 = 0x67452301, H1 = 0xEFCDAB89, H2 = 0x98BADCFE, H3 = 0x10325476, H4 = 0xC3D2E1F0;
  for (let blockstart = 0; blockstart < word_array.length; blockstart += 16) {
    for (let i = 0; i < 16; i++) W[i] = word_array[blockstart + i];
    for (let i = 16; i <= 79; i++) W[i] = rotate_left(W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16], 1);
    let A = H0, B = H1, C = H2, D = H3, E = H4;
    for (let i = 0; i <= 19; i++) {
      const temp = (rotate_left(A, 5) + ((B & C) | (~B & D)) + E + W[i] + 0x5A827999) & 0x0ffffffff;
      E = D; D = C; C = rotate_left(B, 30); B = A; A = temp;
    }
    for (let i = 20; i <= 39; i++) {
      const temp = (rotate_left(A, 5) + (B ^ C ^ D) + E + W[i] + 0x6ED9EBA1) & 0x0ffffffff;
      E = D; D = C; C = rotate_left(B, 30); B = A; A = temp;
    }
    for (let i = 40; i <= 59; i++) {
      const temp = (rotate_left(A, 5) + ((B & C) | (B & D) | (C & D)) + E + W[i] + 0x8F1BBCDC) & 0x0ffffffff;
      E = D; D = C; C = rotate_left(B, 30); B = A; A = temp;
    }
    for (let i = 60; i <= 79; i++) {
      const temp = (rotate_left(A, 5) + (B ^ C ^ D) + E + W[i] + 0xCA62C1D6) & 0x0ffffffff;
      E = D; D = C; C = rotate_left(B, 30); B = A; A = temp;
    }
    H0 = (H0 + A) & 0x0ffffffff; H1 = (H1 + B) & 0x0ffffffff;
    H2 = (H2 + C) & 0x0ffffffff; H3 = (H3 + D) & 0x0ffffffff; H4 = (H4 + E) & 0x0ffffffff;
  }
  return (cvt_hex(H0) + cvt_hex(H1) + cvt_hex(H2) + cvt_hex(H3) + cvt_hex(H4)).toLowerCase();
}

// ==================== 签名函数（对齐Android源码SignUtil.java） ====================
// 签名公式：md5(sha1(querySorted + bodyStr(DELETE不加) + appId=...&nonce=...&timestamp=... + appSecret))
// App端：query + body + param + secret
// H5端：query + param + secret（不加body）
// nonce：app端 = timestamp + 随机16字符；h5端 = uuid
function getSign(type, params = {}, body = "", method = "GET") {
  const APP_ID = "S7qPWPU1";
  const APP_SECRET = "c5e0da7f4da28df805694ec3dd1fc6792e9df99d";

  // 从面板配置读取（优先级最高）
  let appId = APP_ID;
  let appSecret = APP_SECRET;
  try {
    const cfgRaw = $.getdata("zeeho_config");
    if (cfgRaw) {
      const cfg = JSON.parse(cfgRaw);
      const c = cfg[type] || cfg.app;
      if (c?.appId) appId = c.appId;
      if (c?.appSecret) appSecret = c.appSecret;
    }
  } catch (e) { /* 配置读取失败用默认值 */ }

  // 构建query字符串（key字典序排序，k=v用&拼接，不做URL encode，跳过null）
  const query = Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== null)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join("&");

  const timestamp = new Date().getTime();
  // nonce：app端 = timestamp + 随机16字符；h5端 = uuid
  const nonce = type === "h5" ? getUuid() : (timestamp + randomChars(16));
  const param = `appId=${appId}&nonce=${nonce}&timestamp=${timestamp}`;

  // bodyStr：DELETE方法不加body
  const bodyStr = (method.toUpperCase() === "DELETE" || !body) ? "" : (typeof body === "string" ? body : JSON.stringify(body));

  // 拼接签名字符串
  let sig = query;
  if (type !== "h5") sig += bodyStr; // App端加body，H5端不加
  sig += param + appSecret;

  const sign = md5(sha1(sig));

  return {
    "cfmoto-x-param": param,
    "cfmoto-x-sign": sign,
    "cfmoto-x-sign-type": "0",
    "timestamp": String(timestamp),
    "nonce": nonce,
    "signature": sign
  };
}

// ==================== HTTP请求封装 ====================
async function Request(o) {
  if (typeof o === "string") o = { url: o };
  try {
    if (!o?.url) throw new Error("[发送请求] 缺少 url 参数");
    let { url: u, type, headers = {}, body: b, params, dataType = "form", resultType = "data" } = o;
    const method = type ? type?.toLowerCase() : ("body" in o ? "post" : "get");
    const query = params ? $.queryStr(params) : "";
    const url = u.concat(query ? (u.includes("?") ? "&" : "?") + query : "");
    const timeout = o.timeout ? ($.isSurge() ? o.timeout / 1e3 : o.timeout) : 15000;

    if (dataType === "json") headers["Content-Type"] = "application/json;charset=UTF-8";
    const hasBody = b !== undefined && b !== null;
    const body = hasBody ? (dataType == "form" ? $.queryStr(b) : $.toStr(b)) : "";
    if (method !== "get" && !hasBody) headers["Content-Length"] = "0";
    if (hasBody && body) headers["Content-Length"] = String(body.length);

    // $.http.get/post 返回Promise，内部调用Env实例的get/post（callback风格）
    const httpEntry = method === "get" ? "get" : "post";
    const request = { ...o, url, method: method, headers, timeout: timeout };
    if (method !== "get") request.body = body;

    const httpPromise = $.http[httpEntry](request)
      .then(response => {
        if (resultType == "data") return $.toObj(response.body) || response.body;
        return $.toObj(response) || response;
      })
      .catch(err => {
        $.log(`❌请求发起失败！原因为：${err}`);
        throw err;
      });

    return Promise.race([
      new Promise((_, e) => setTimeout(() => e(new Error("当前请求已超时")), timeout)),
      httpPromise
    ]);
  } catch (e) {
    $.log(`❌请求发起失败！原因为：${e}`);
    return null;
  }
}

// ==================== 用户信息类 ====================
class UserInfo {
  constructor(user) {
    this.index = ++userIdx;
    // 清洗token：去掉Bearer前缀，再统一加上Bearer
    const rawToken = user.token || user;
    this.token = "Bearer " + String(rawToken || "").replace(/^[bB]earer\s+/i, "").trim();
    this.userId = String(user.userId || "").trim();
    this.userName = user.userName || `账号${this.index}`;
    this.userAgent = user.userAgent || "ZEEHO/5.0 (iPhone; iOS 17.0; Scale/3.00)";
    this.ckStatus = true; // Token状态：true=有效，false=失效

    // 请求头基础配置（对齐Android源码ApiClient.java）
    this.headers = {
      "Content-Type": "application/json;charset=UTF-8",
      "Accept-Language": "zh-CN",
      "Authorization": this.token,
      "User-Agent": this.userAgent,
      "user_id": this.userId,
      "interfaceversion": "2"
    };

    this.getRandomTime = () => randomInt(1000, 3000);

    // 统一请求封装
    this.fetch = async (options) => {
      try {
        if (typeof options === "string") options = { url: options };
        const requestOptions = {
          ...options,
          headers: options.headers || this.headers,
          url: options.url || ""
        };
        const response = await Request(requestOptions);
        // 只有返回code=40001才标记Token失效
        if (response?.code == 40001) {
          this.ckStatus = false;
          throw new Error(response?.message || "Token已过期，请重新登录");
        }
        return response;
      } catch (e) {
        // catch块不设置ckStatus=false，只有真正的Token失效才标记
        if (/登录|token|40001/i.test(e.message || "")) {
          this.ckStatus = false;
        }
        $.log(`⚠️ 请求失败: ${e.message}`);
        return null;
      }
    };
  }

  // 【签到】先查今日是否已签，未签则执行签到，返回今日积分
  async signin() {
    try {
      // 使用本地时间计算今日日期
      const now = new Date();
      const today = now.getFullYear() + "-" +
        String(now.getMonth() + 1).padStart(2, "0") + "-" +
        String(now.getDate()).padStart(2, "0");
      const month = today.slice(0, 7);

      // 1) 先查今日是否已签到（带server_name=SMART，对齐Android源码）
      const infoOpts = {
        url: "https://h5.zeehoev.com/cfmotoservermine/signin/info",
        type: "get",
        headers: { ...this.headers, ...getSign("h5", { month, server_name: "SMART" }, null, "GET") },
        params: { month, server_name: "SMART" }
      };
      const infoRes = await this.fetch(infoOpts);
      if (infoRes?.code == "10000") {
        const todayEntry = (infoRes.data?.nowSignDetailVos || []).find(x => x.createDate === today);
        if (todayEntry && (todayEntry.signStatue === 3 || todayEntry.signStatue === 5)) {
          $.log(`✅ 签到: 今日已签到（+${todayEntry.integralScore || 0}积分）`);
          return Number(todayEntry.integralScore) || 0;
        }
      }

      // 2) 执行签到（POST，带server_name=SMART参数，空body）
      const signOpts = {
        url: "https://h5.zeehoev.com/cfmotoservermine/signin",
        type: "post",
        headers: { ...this.headers, ...getSign("h5", { server_name: "SMART" }, null, "POST") },
        params: { server_name: "SMART" }
      };
      const signRes = await this.fetch(signOpts);
      if (signRes?.code == "10000" && signRes?.message == "操作成功") {
        // 3) 再查一次info，取今日积分
        const infoRes2 = await this.fetch(infoOpts);
        const te = (infoRes2?.data?.nowSignDetailVos || []).find(x => x.createDate === today);
        const point = te ? Number(te.integralScore) || 0 : 0;
        $.log(`✅ 签到: 完成 +${point}积分`);
        return point;
      } else {
        $.log(`⚠️ 签到: ${signRes?.message || "未知错误"}`);
        return 0;
      }
    } catch (e) {
      $.log(`⚠️ 签到异常: ${e.message}`);
      return 0;
    }
  }

  // 【查询签到记录】返回连签天数、今日积分、连签奖励次数
  async getSignRecord() {
    try {
      const now = new Date();
      const month = now.getFullYear() + "-" + (now.getMonth() + 1);
      const today = now.getFullYear() + "-" +
        String(now.getMonth() + 1).padStart(2, "0") + "-" +
        String(now.getDate()).padStart(2, "0");

      const opts = {
        url: "https://h5.zeehoev.com/cfmotoservermine/signin/info",
        type: "get",
        headers: { ...this.headers, ...getSign("h5", { month, server_name: "SMART" }, null, "GET") },
        params: { month, server_name: "SMART" }
      };
      const res = await this.fetch(opts);
      if (res?.code == "10000") {
        const list = res.data?.nowSignDetailVos || [];
        const todayIdx = list.findIndex(item => item.createDate === today);
        let count = 0;
        if (todayIdx >= 0) {
          for (let i = todayIdx; i >= 0; i--) {
            if (list[i]?.signStatue == 3 || list[i]?.signStatue == 5) count++;
            else break;
          }
        }
        const prize = res.data?.integral || 0;
        const prizes = res.data?.signCount || 0;
        $.log(`✅ 签到记录: 连签${count}天 | 今日积分${prize} | 连签奖励${prizes}次`);
        return { count, prize, prizes };
      }
      return { count: 0, prize: 0, prizes: 0 };
    } catch (e) {
      $.log(`⚠️ 查询签到记录异常: ${e.message}`);
      return { count: 0, prize: 0, prizes: 0 };
    }
  }

  // 【盲盒抽奖】连签满30天可抽一次（supplementPrize接口）
  async lottery() {
    try {
      const now = new Date();
      const today = now.getFullYear() + "-" +
        String(now.getMonth() + 1).padStart(2, "0") + "-" +
        String(now.getDate()).padStart(2, "0");
      const opts = {
        url: "https://h5.zeehoev.com/cfmotoservermine/signin/supplementPrize",
        type: "get",
        headers: { ...this.headers, ...getSign("h5", { supplementDate: today }, null, "GET") },
        params: { supplementDate: today }
      };
      const res = await this.fetch(opts);
      if (res?.code == "10000") {
        const integralScore = res.data?.integral || res.data?.integralScore || 0;
        const prizesName = res.data?.prizesName || (integralScore + "积分");
        $.log(`✅ 盲盒抽奖: 获得${prizesName}`);
        return Number(integralScore);
      }
      $.log(`⚠️ 盲盒抽奖: ${res?.message || "今日无盲盒"}`);
      return 0;
    } catch (e) {
      $.log(`⚠️ 盲盒抽奖异常: ${e.message}`);
      return 0;
    }
  }

  // 【创建动态】每日首次发帖+1分（body对齐Android源码：postSubInfo含topicList空数组）
  async createArticle() {
    try {
      const body = {
        postSubInfo: { topicList: [] },
        topicid: "",
        postcontent: "开心的一天"
      };
      const opts = {
        url: "https://tapi.zeehoev.com/v1.0/social/cfmotoserversocial/commonArticle",
        type: "post",
        headers: { ...this.headers, ...getSign("app", {}, body, "POST") },
        body: body
      };
      const res = await this.fetch(opts);
      if (res?.code == "10000") {
        const postId = this.extractPostId(res.data);
        $.log(`✅ 创建动态: 成功${postId ? " " + postId : ""}`);
        return postId;
      }
      $.log(`⚠️ 创建动态: ${res?.message || "失败"}`);
      return null;
    } catch (e) {
      $.log(`⚠️ 创建动态异常: ${e.message}`);
      return null;
    }
  }

  // 【获取动态列表】创建失败时用已有动态
  async getArticles() {
    try {
      const params = { userId: this.userId };
      const opts = {
        url: "https://tapi.zeehoev.com/v1.0/social/cfmotoserversocial/community/mineArticleInfo",
        type: "get",
        headers: { ...this.headers, ...getSign("app", params, null, "GET") },
        params: params
      };
      const res = await this.fetch(opts);
      if (res?.code == "10000") {
        const list = Array.isArray(res.data) ? res.data : (res.data?.records || res.data?.list || []);
        const postId = this.extractPostId(list[0] || res.data);
        $.log(`✅ 获取动态: ${postId || "无"}`);
        return postId;
      }
      return null;
    } catch (e) {
      $.log(`⚠️ 获取动态异常: ${e.message}`);
      return null;
    }
  }

  // 【点赞动态】+1分
  async thumbsUp(postId) {
    try {
      const body = { postId: String(postId), kindFlag: "0" };
      const opts = {
        url: "https://tapi.zeehoev.com/v1.0/social/cfmotoserversocial/socialCommu/likeFavoriteInfo",
        type: "post",
        headers: { ...this.headers, ...getSign("app", {}, body, "POST") },
        body: body
      };
      const res = await this.fetch(opts);
      const ok = res?.code == "10000";
      $.log(`${ok ? "✅" : "⚠️"} 点赞动态: ${ok ? "成功" : res?.message || "失败"}`);
      return ok;
    } catch (e) {
      $.log(`⚠️ 点赞异常: ${e.message}`);
      return false;
    }
  }

  // 【评论动态】评论不加分，但分享前必须有评论
  async comment(postId) {
    try {
      const body = { postid: String(postId), userId: String(this.userId), comments: "厉害", sendTos: "[\n\n]" };
      const opts = {
        url: "https://tapi.zeehoev.com/v1.0/social/cfmotoserversocial/commentInfo",
        type: "post",
        headers: { ...this.headers, ...getSign("app", {}, body, "POST") },
        body: body
      };
      const res = await this.fetch(opts);
      $.log(`${res?.code == "10000" ? "✅" : "⚠️"} 评论动态: ${res?.code == "10000" ? "成功" : res?.message || "失败"}`);
    } catch (e) {
      $.log(`⚠️ 评论异常: ${e.message}`);
    }
  }

  // 【分享动态】+1分（PUT，无body，路径含articleId）
  async share(postId) {
    try {
      const opts = {
        url: `https://tapi.zeehoev.com/v1.0/social/cfmotoserversocial/article/share/${postId}`,
        type: "put",
        headers: { ...this.headers, ...getSign("app", {}, null, "PUT") }
      };
      const res = await this.fetch(opts);
      const ok = res?.code == "10000";
      if (ok) await this.adjustByShare(); // 触发分享积分结算
      $.log(`${ok ? "✅" : "⚠️"} 分享动态: ${ok ? "成功" : res?.message || "失败"}`);
      return ok;
    } catch (e) {
      $.log(`⚠️ 分享异常: ${e.message}`);
      return false;
    }
  }

  // 【分享积分结算】分享后调用触发积分到账
  async adjustByShare() {
    try {
      const opts = {
        url: "https://tapi.zeehoev.com/v1.0/mine/cfmotoservermine/integral/adjustByShare",
        type: "get",
        headers: { ...this.headers, ...getSign("app", {}, null, "GET") }
      };
      const res = await this.fetch(opts);
      $.log(`${res?.code == "10000" ? "✅" : "⚠️"} 分享积分结算: ${res?.code == "10000" ? "已触发" : res?.message || "失败"}`);
    } catch (e) {
      $.log(`⚠️ 分享积分结算异常: ${e.message}`);
    }
  }

  // 【删除动态】清理刚才创建的动态（DELETE，参数放params参与签名，对齐Android源码）
  async deletePost(postId) {
    try {
      const params = { articleId: String(postId), postType: "1" };
      const opts = {
        url: "https://tapi.zeehoev.com/v1.0/social/cfmotoserversocial/commonArticle/deleteArticle",
        type: "delete",
        headers: { ...this.headers, ...getSign("app", params, null, "DELETE") },
        params: params
      };
      const res = await this.fetch(opts);
      $.log(`${res?.code == "10000" ? "✅" : "⚠️"} 删除动态: ${res?.code == "10000" ? "成功" : res?.message || "失败"}`);
    } catch (e) {
      $.log(`⚠️ 删除动态异常: ${e.message}`);
    }
  }

  // 【查询用户积分】返回总积分
  async getSignInfo() {
    try {
      const opts = {
        url: `https://tapi.zeehoev.com/v1.0/mine/cfmotoservermine/setting/${this.userId}`,
        type: "get",
        headers: { ...this.headers, ...getSign("app", {}, null, "GET") }
      };
      const res = await this.fetch(opts);
      if (res?.code == "10000" && res.data) {
        return Number(res.data.score) || 0;
      }
      return 0;
    } catch (e) {
      $.log(`⚠️ 查询积分异常: ${e.message}`);
      return 0;
    }
  }

  // 从响应数据中提取动态ID
  extractPostId(data) {
    if (!data) return null;
    if (typeof data === "string" || typeof data === "number") return String(data);
    if (Array.isArray(data)) return this.extractPostId(data[0]);
    const direct = data.uuid || data.tuuid || data.postId || data.postid ||
      data.articleId || data.articleID || data.id || data.dataId || data.tid;
    if (direct) return String(direct);
    for (const key of ["records", "list", "rows", "data", "result"]) {
      const postId = this.extractPostId(data[key]);
      if (postId) return postId;
    }
    return null;
  }
}

// ==================== Token自动捕获 ====================
async function getCookie() {
  if (typeof $request === "undefined") return;
  if ($request.method === "OPTIONS") return;

  try {
    const header = ObjectKeys2LowerCase($request.headers || {});
    const token = header["authorization"];
    if (!token) return;

    const body = $.toObj($response?.body || "{}");
    if (!body?.data) {
      $.msg($.name, "❌获取Cookie失败!", "");
      return;
    }

    const { id, nickName } = body.data;
    const newData = {
      userId: String(id || ""),
      token: token.replace(/^[bB]earer\s+/i, "").trim(),
      userName: nickName || ""
    };

    let accounts = [];
    try {
      const raw = $.getdata(ckName);
      if (raw) accounts = JSON.parse(raw);
      if (!Array.isArray(accounts)) accounts = [];
    } catch { accounts = []; }

    const idx = accounts.findIndex(e => String(e.userId) === String(newData.userId));
    if (idx >= 0) accounts[idx] = { ...accounts[idx], ...newData };
    else accounts.push(newData);

    $.setdata(JSON.stringify(accounts), ckName);
    $.msg($.name, `🎉${newData.userName || "新账号"} Token已更新!`, `用户ID: ${newData.userId}`);
  } catch (e) {
    $.log(`⚠️ 捕获Token异常: ${e.message}`);
  }
}

// ==================== 社区任务开关 ====================
function getCommunityConfig() {
  try {
    const cfgRaw = $.getdata("zeeho_config");
    if (cfgRaw) {
      const cfg = JSON.parse(cfgRaw);
      return {
        enablePost: cfg.community?.enablePost !== false,
        enableLike: cfg.community?.enableLike !== false,
        enableComment: cfg.community?.enableComment !== false,
        enableShare: cfg.community?.enableShare !== false,
        enableDelete: cfg.community?.enableDelete !== false
      };
    }
  } catch { /* 配置读取失败用默认值 */ }
  return { enablePost: true, enableLike: true, enableComment: true, enableShare: true, enableDelete: true };
}

// ==================== 运行日志 ====================
function addSigninLog(entry) {
  try {
    let logs = [];
    const raw = $.getdata("zeeho_logs");
    if (raw) {
      try { logs = JSON.parse(raw); } catch { logs = []; }
    }
    if (!Array.isArray(logs)) logs = [];
    logs.unshift(entry);
    if (logs.length > 50) logs.length = 50;
    $.setdata(JSON.stringify(logs), "zeeho_logs");
  } catch (e) {
    $.log(`⚠️ 写入日志异常: ${e.message}`);
  }
}

// ==================== 主函数 ====================
async function main() {
  $.log("\n================== 签到任务开始 ==================\n");
  const commCfg = getCommunityConfig();

  for (const user of userList) {
    console.log(`🔷 账号${user.index}「${user.userName}」开始执行`);

    try {
      // 1. 签到
      const integral = await user.signin() || 0;
      let integralScore = 0;
      let count = 0;

      // 只有签到成功(ckStatus为true)才继续后续任务
      if (user.ckStatus) {
        await $.wait(user.getRandomTime());

        // 2. 查询签到记录
        const record = await user.getSignRecord() || {};
        count = record.count || 0;
        const prizes = record.prizes || 0;
        await $.wait(user.getRandomTime());

        // 3. 盲盒抽奖（连签满30次可抽）
        if (prizes >= 30) {
          integralScore = await user.lottery();
          await $.wait(user.getRandomTime());
        }

        // 4. 社区互动任务
        let interactGain = 0;
        let postId = null;

        // 4.1 创建动态
        if (commCfg.enablePost !== false) {
          postId = await user.createArticle();
          if (postId) interactGain += 1;
          await $.wait(user.getRandomTime());
        }

        // 4.2 创建失败则获取已有动态
        if (!postId) {
          postId = await user.getArticles();
        }

        // 获取不到动态ID时，跳过互动任务但继续签到积分查询和通知
        let interactSkipped = false;
        if (!postId) {
          $.log(`⚠️ 未获取到动态ID，跳过互动任务（不影响签到结果和通知）`);
          interactSkipped = true;
          interactGain = 0;
        }

        // 4.3 点赞/评论/分享/删除
        if (!interactSkipped) {
          await $.wait(user.getRandomTime());

          if (commCfg.enableLike !== false) {
            if (await user.thumbsUp(postId)) interactGain += 1;
            await $.wait(user.getRandomTime());
          }

          if (commCfg.enableComment !== false) {
            await user.comment(postId);
            await $.wait(user.getRandomTime());
          }

          if (commCfg.enableShare !== false) {
            if (await user.share(postId)) interactGain += 1;
            await $.wait(user.getRandomTime());
          }

          if (commCfg.enableDelete !== false && postId) {
            await user.deletePost(postId);
            await $.wait(user.getRandomTime());
          }
        }

        // 5. 查询当前总积分
        const score = await user.getSignInfo();

        // 6. 计算本次获得积分
        const gain = (integral || 0) + (integralScore || 0) + interactGain;
        const oldScore = typeof score === "number" ? score - gain : "未知";

        // 7. 汇总通知
        $.notifyMsg.push(`「${user.userName}」积分: ${oldScore}+${gain}=${score}, 连签: ${count}天`);

        // 8. 写入运行日志
        addSigninLog({
          time: new Date().toLocaleString("zh-CN", { hour12: false }),
          userName: user.userName,
          userId: user.userId,
          success: true,
          totalGain: gain,
          signinScore: integral || 0,
          blindBoxScore: integralScore || 0,
          interactScore: interactGain,
          continueDays: count,
          error: null,
          steps: [`签到 +${integral || 0}`, `盲盒 +${integralScore || 0}`, `互动 +${interactGain}`, `连签 ${count}天`]
        });

        $.successCount++;
        console.log(`✅ 账号${user.index}「${user.userName}」完成: +${gain}积分, 连签${count}天`);
      } else {
        // Token失效
        $.notifyMsg.push(`❌账号「${user.userName}」执行失败: Token失效或请求异常`);
        addSigninLog({
          time: new Date().toLocaleString("zh-CN", { hour12: false }),
          userName: user.userName,
          userId: user.userId,
          success: false,
          totalGain: 0,
          error: "Token失效或请求异常",
          steps: ["执行失败: Token失效或请求异常"]
        });
        $.failCount++;
        console.log(`❌ 账号${user.index}「${user.userName}」失败: Token失效`);
      }
    } catch (e) {
      // 单个账号异常不影响其他账号
      $.log(`⛔️ 账号${user.index}「${user.userName}」异常: ${e.message}`);
      $.notifyMsg.push(`❌账号「${user.userName}」异常: ${e.message}`);
      addSigninLog({
        time: new Date().toLocaleString("zh-CN", { hour12: false }),
        userName: user.userName,
        userId: user.userId,
        success: false,
        totalGain: 0,
        error: e.message,
        steps: [`异常: ${e.message}`]
      });
      $.failCount++;
    }
  }

  $.log("\n================== 签到任务结束 ==================\n");
}

// ==================== 发送汇总通知 ====================
async function SendMsg(summary, detail) {
  if (!summary && !detail) return;
  if (!(0 < Notify)) {
    console.log([summary, detail].filter(Boolean).join("\n"));
    return;
  }
  if ($.isNode()) {
    const text = [summary, detail].filter(Boolean).join("\n");
    console.log(text);
  } else {
    $.msg($.name, summary || "", detail || "");
  }
}

// ==================== 主入口 ====================
!(async () => {
  // 抓包模式：捕获Token
  if (typeof $request !== "undefined") {
    await getCookie();
    $.done({});
    return;
  }

  // 签到模式：读取账号列表
  try {
    userCookie = $.toObj(userCookie) || [];
    if (!Array.isArray(userCookie)) userCookie = [];
    userList = userCookie.map(n => new UserInfo(n)).filter(Boolean);
  } catch (e) {
    $.log(`⚠️ 读取账号数据异常: ${e.message}`);
    userList = [];
  }

  console.log(`共找到${userList.length}个账号`);

  if (userList.length > 0) {
    try {
      await main();
    } catch (e) {
      $.log(`⛔️ 主函数异常: ${e.message}`);
      $.notifyMsg.push(`❌任务异常: ${e.message}`);
    }
  } else {
    $.notifyMsg.push("⚠️ 未配置账号，请打开极核App「我的」页面自动捕获Token");
  }

  // 发送汇总通知
  const total = userList.length;
  const success = $.successCount || 0;
  const fail = $.failCount || (total - success);
  const summary = `共${total}个账号, 成功${success}个, 失败${fail}个`;
  const body = $.notifyMsg.length ? $.notifyMsg.join("\n") : "";
  if (body || typeof $request === "undefined") await SendMsg(summary, body);

  $.done({ ok: 1 });
})();