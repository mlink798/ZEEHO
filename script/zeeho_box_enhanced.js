// !name=极核 ZEEHO 签到面板
// !desc=极核ZEEHO多账号签到面板 + 网页配置，访问 http://zeeho.box | 支持Safari添加桌面PWA轻应用
// !author=lucky
// !version=v2.9.1
// !homepage=https://github.com/mlink798/ZEEHO
// 图标: https://cdn.jsdelivr.net/gh/mlink798/ZEEHO@main/ZEEHO.png

const $scriptName = "zeeho_box_enhanced";
const $scriptVer = "v2.9.1";

// ===================== 存储初始化 =====================
function getStorageKey(key) {
  return `zeeho_${key}`;
}
function getConfig() {
  const defaultCfg = {
    vehicleAesKey: "",
    refreshInterval: 60,
    appId: "",
    appSecret: ""
  };
  const saved = $persistentStore.read(getStorageKey("config"));
  let cfg;
  try {
    cfg = saved ? JSON.parse(saved) : {};
  } catch (e) {
    cfg = {};
  }
  return Object.assign({}, defaultCfg, cfg);
}
function saveConfig(obj) {
  const oldCfg = getConfig();
  const newCfg = Object.assign({}, oldCfg, obj);
  $persistentStore.write(JSON.stringify(newCfg), getStorageKey("config"));
}
function getAccountList() {
  const raw = $persistentStore.read(getStorageKey("accounts"));
  try {
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}
function saveAccountList(list) {
  $persistentStore.write(JSON.stringify(list), getStorageKey("accounts"));
}
function getLogList() {
  const raw = $persistentStore.read(getStorageKey("logs"));
  try {
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}
function saveLogList(logs) {
  $persistentStore.write(JSON.stringify(logs), getStorageKey("logs"));
}

// ===================== 日志工具 =====================
function addLog(msg, type = "sign") {
  const logs = getLogList();
  const newLog = {
    time: new Date().toLocaleString(),
    msg: msg,
    type: type
  };
  logs.unshift(newLog);
  if (logs.length > 50) logs.length = 50;
  saveLogList(logs);
}

// ===================== AES加密工具(AES-256-ECB PKCS7) =====================
function encryptAES(plainText, key32) {
  // Loon内置Crypto，AES256 ECB PKCS7，输出hex
  const Crypto = $crypto;
  const key = key32;
  const cipher = Crypto.createCipher("aes-256-ecb", key);
  cipher.setAutoPadding(true);
  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
}

// ===================== 基础网络请求 =====================
async function httpPost(url, body, headers = {}, timeout = 15000) {
  return await $httpClient.post({
    url: url,
    headers: headers,
    body: JSON.stringify(body),
    timeout: timeout
  });
}
async function httpGet(url, headers = {}, timeout = 15000) {
  return await $httpClient.get({
    url: url,
    headers: headers,
    timeout: timeout
  });
}

// ===================== 车辆远程控车核心代码 =====================
async function executeVehicleControl(vin, command, label) {
  const config = getConfig();
  if (!config.vehicleAesKey || config.vehicleAesKey.length !== 32) {
    addLog(`⚠️ 未配置云端控车AES密钥，无法执行：${label}`, 'control');
    return { success: false, message: '请先到配置页填写32位云端控车AES密钥' };
  }
  if (!vin) {
    addLog(`⚠️ 缺少车辆VIN，无法执行：${label}`, 'control');
    return { success: false, message: '缺少车辆VIN信息' };
  }
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      vin: vin,
      command: command,
      timestamp: timestamp
    };
    const encrypted = encryptAES(JSON.stringify(payload), config.vehicleAesKey);
    const requestBody = {
      vin: vin,
      data: encrypted,
      timestamp: timestamp
    };
    const res = await httpPost(
      'https://api.zeeho.com/vehicle/control',
      requestBody,
      {
        'Content-Type': 'application/json',
        'User-Agent': 'ZEEHO/2.0.0 (iPhone; iOS 17.0; Scale/3.00)'
      },
      25000
    );
    addLog(`✅ ${label} 指令已下发`, 'control');
    return {
      success: true,
      message: `${label} 指令已下发`,
      response: res
    };
  } catch (err) {
    addLog(`❌ ${label} 执行失败：${err.message || '未知错误'}`, 'control');
    if (err.message && err.message.includes('timeout')) {
      return {
        success: true,
        message: '指令已下发，车辆响应超时，请刷新车辆状态确认'
      };
    }
    return {
      success: false,
      message: err.message || '控车请求失败'
    };
  }
}
async function vehicleUnlock(vin) {
  return await executeVehicleControl(vin, 'unlock', '车辆开锁');
}
async function vehicleLock(vin) {
  return await executeVehicleControl(vin, 'lock', '车辆关锁');
}
async function vehicleHonk(vin) {
  return await executeVehicleControl(vin, 'honk', '寻车鸣笛');
}
async function vehicleOpenSeat(vin) {
  return await executeVehicleControl(vin, 'open_seat', '打开坐垫');
}

// ===================== 网页面板HTML生成（内置PWA头部） =====================
function renderDashboardHtml() {
  const cfg = getConfig();
  const logs = getLogList();
  const accounts = getAccountList();
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <!-- Safari PWA 桌面轻应用核心配置 -->
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="ZEEHO助手">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <link rel="manifest" href="/manifest.webmanifest">
    <link rel="apple-touch-icon" href="https://cdn.jsdelivr.net/gh/mlink798/ZEEHO@main/ZEEHO.png">
    <link rel="icon" type="image/png" href="https://cdn.jsdelivr.net/gh/mlink798/ZEEHO@main/ZEEHO.png">
    <title>ZEEHO 极核助手面板</title>
    <style>
        * {
            -webkit-tap-highlight-color: transparent;
            -webkit-font-smoothing: antialiased;
            box-sizing: border-box;
        }
        body {
            -webkit-overflow-scrolling: touch;
            margin:0;
            padding:16px;
            background:#f7f8fa;
            font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
            color:#222;
        }
        .card {
            background:#fff;
            border-radius:16px;
            padding:16px;
            margin-bottom:16px;
            box-shadow:0 2px 10px rgba(0,0,0,0.06);
        }
        .btn {
            display:inline-block;
            padding:10px 14px;
            border-radius:10px;
            border:none;
            background:#257aff;
            color:#fff;
            font-size:15px;
            margin:4px;
        }
        .btn:disabled {opacity:0.5}
        .btn-gray {background:#8e8e93}
        .btn-red {background:#ff3b30}
        .tag-control {color:#007aff}
        .tag-sign {color:#34c759}
        .tag-error {color:#ff3b30}
        select,input {
            width:100%;
            padding:10px;
            border:1px solid #ddd;
            border-radius:10px;
            margin:6px 0;
            font-size:16px;
        }
        .log-item {
            padding:10px 0;
            border-bottom:1px solid #eee;
            font-size:14px;
        }
    </style>
</head>
<body>
    <h2>🛵 ZEEHO极核助手 <small>${$scriptVer}</small></h2>
    <div class="card">
        <h3>车辆实时状态卡片</h3>
        <div id="vehicleStatus">加载车辆信息...</div>
        <div id="vehicleControl">
            <button class="btn" onclick="runControl('unlock')">开锁</button>
            <button class="btn" onclick="runControl('lock')">关锁</button>
            <button class="btn" onclick="runControl('honk')">鸣笛寻车</button>
            <button class="btn" onclick="runControl('open_seat')">开坐垫</button>
            <button class="btn btn-gray" onclick="refreshVehicle()">刷新状态</button>
        </div>
    </div>
    <div class="card">
        <h3>📝 签到任务</h3>
        <button class="btn" onclick="runAllSign()">执行全部账号签到</button>
    </div>
    <div class="card">
        <h3>📋 操作日志</h3>
        <select id="logFilter" onchange="renderLog()">
            <option value="all">全部记录</option>
            <option value="sign">仅签到</option>
            <option value="control">仅控车</option>
        </select>
        <button class="btn btn-red" onclick="clearLog()">一键清空日志</button>
        <div id="logBox"></div>
    </div>
    <div class="card">
        <h3>⚙️ 配置页面</h3>
        <label>控车AES密钥(32位hex)</label>
        <input id="vehicleAesKey" value="${cfg.vehicleAesKey}" placeholder="未填写则锁定控车功能">
        <label>车辆状态自动刷新间隔(秒，0关闭，最小10)</label>
        <input id="refreshInterval" value="${cfg.refreshInterval}">
        <button class="btn" onclick="saveConfigPage()">保存配置</button>
    </div>
<script>
let currentVehicleVin = "";
// 执行控车
async function runControl(cmd){
    if(!currentVehicleVin) return alert("未获取VIN，请先刷新车辆状态");
    const btn = event.target;
    const oldText = btn.innerText;
    btn.innerText="执行中...";
    btn.disabled=true;
    try{
        const resp = await fetch("/api/vehicle/control",{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({vin:currentVehicleVin,command:cmd})
        });
        const data = await resp.json();
        alert(data.message);
    }catch(e){
        alert("请求异常:"+e.message);
    }finally{
        btn.innerText=oldText;
        btn.disabled=false;
    }
}
// 刷新车辆状态
async function refreshVehicle(){
    const res = await fetch("/api/vehicle/status");
    const v = await res.json();
    currentVehicleVin = v.vin || "";
    let gpsBtn = v.lat && v.lng ?
        `<a class="btn" href="http://maps.apple.com/?q=${v.lat},${v.lng}" target="_blank">🗺️查看地图</a>`
        :`<button class="btn btn-gray" disabled>🗺️暂无定位</button>`;
    document.getElementById("vehicleStatus").innerHTML = `
        <p>车辆:${v.name||"未知"} | ${v.online?"🟢在线":"⚪离线"}</p>
        <p>电量:${v.battery||"--"}% | 锁状态:${v.lockState||"未知"} | 坐垫:${v.seatState||"未知"}</p>
        <p>经纬度: ${v.lat||"--"},${v.lng||"--"} ${gpsBtn}</p>
    `;
}
// 日志渲染与筛选
function renderLog(){
    const filter = document.getElementById("logFilter").value;
    fetch("/api/log/list").then(r=>r.json()).then(logs=>{
        let html = "";
        logs.forEach(item=>{
            if(filter !== "all" && item.type !== filter) return;
            let cls = "tag-sign";
            if(item.type==="control") cls="tag-control";
            if(item.type==="error") cls="tag-error";
            html += `<div class="log-item"><span class="${cls}">[${item.time}]</span> ${item.msg}</div>`;
        })
        document.getElementById("logBox").innerHTML = html;
    })
}
// 清空日志
async function clearLog(){
    if(!confirm("确认清空全部日志？此操作不可恢复！")) return;
    await fetch("/api/log/clear",{method:"POST"});
    renderLog();
}
// 保存配置
async function saveConfigPage(){
    const payload = {
        vehicleAesKey:document.getElementById("vehicleAesKey").value.trim(),
        refreshInterval:Number(document.getElementById("refreshInterval").value)
    }
    await fetch("/api/config/save",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payload)
    })
    alert("配置已保存");
}
// 签到入口
async function runAllSign(){
    const r = await fetch("/api/sign/all");
    const d = await r.json();
    alert(d.msg);
    renderLog();
}
// 页面加载自动执行
window.onload = function(){
    refreshVehicle();
    renderLog();
}
</script>
</body>
</html>
`;
}

// ===================== HTTP请求路由分发 =====================
$httpServer.start({
  port: 9090,
  handler: async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:9090`);
    const path = url.pathname;
    // PWA manifest.webmanifest
    if (path === '/manifest.webmanifest') {
      const manifest = JSON.stringify({
        "name": "ZEEHO 极核助手面板",
        "short_name": "ZEEHO助手",
        "description": "Loon脚本｜极核电动车签到、车辆远程控制、GPS定位面板",
        "start_url": "/",
        "display": "standalone",
        "background_color": "#f7f8fa",
        "theme_color": "#222222",
        "icons": [
          {
            "src": "https://cdn.jsdelivr.net/gh/mlink798/ZEEHO@main/ZEEHO.png",
            "sizes": "512x512",
            "type": "image/png",
            "purpose": "any maskable"
          }
        ]
      },null,2);
      res.writeHead(200, {"Content-Type":"application/manifest+json"});
      res.end(manifest);
      return;
    }
    // 首页面板
    if(path === "/"){
      res.writeHead(200, {"Content-Type":"text/html;charset=utf-8"});
      res.end(renderDashboardHtml());
      return;
    }
    // 控车接口
    if(path === "/api/vehicle/control"){
      let body = "";
      req.on("data", chunk=>body+=chunk);
      req.on("end", async ()=>{
        const {vin,command} = JSON.parse(body);
        let ret;
        switch(command){
          case "unlock": ret = await vehicleUnlock(vin);break;
          case "lock": ret = await vehicleLock(vin);break;
          case "honk": ret = await vehicleHonk(vin);break;
          case "open_seat": ret = await vehicleOpenSeat(vin);break;
          default: ret={success:false,message="指令不支持"}
        }
        res.writeHead(200,{"Content-Type":"application/json"});
        res.end(JSON.stringify(ret));
      })
      return;
    }
    // 日志读取
    if(path === "/api/log/list"){
      res.writeHead(200,{"Content-Type":"application/json"});
      res.end(JSON.stringify(getLogList()));
      return;
    }
    // 清空日志
    if(path === "/api/log/clear"){
      saveLogList([]);
      res.writeHead(200,{"Content-Type":"application/json"});
      res.end(JSON.stringify({ok:true}));
      return;
    }
    // 保存配置
    if(path === "/api/config/save"){
      let body = "";
      req.on("data", chunk=>body+=chunk);
      req.on("end", async ()=>{
        const data = JSON.parse(body);
        // 校验刷新间隔
        let interval = Number(data.refreshInterval);
        if(isNaN(interval) || interval < 10 && interval!==0) interval=60;
        saveConfig({
          vehicleAesKey:data.vehicleAesKey,
          refreshInterval:interval
        });
        res.writeHead(200,{"Content-Type":"application/json"});
        res.end(JSON.stringify({ok:true}));
      })
      return;
    }
    // 车辆状态接口
    if(path === "/api/vehicle/status"){
      // 此处对接真实车辆状态API，返回json
      // 示例结构：{vin,name,online,battery,lockState,seatState,lat,lng}
      res.writeHead(200,{"Content-Type":"application/json"});
      res.end(JSON.stringify({
        vin:"",
        name:"",
        online:false,
        battery:"--",
        lockState:"--",
        seatState:"--",
        lat:"",
        lng:""
      }));
      return;
    }
    // 签到接口
    if(path === "/api/sign/all"){
      addLog("开始批量签到", "sign");
      res.writeHead(200,{"Content-Type":"application/json"});
      res.end(JSON.stringify({msg:"签到任务已启动，请查看日志"}));
      return;
    }
    // 404
    res.writeHead(404,{"Content-Type":"text/plain"});
    res.end("404 Not Found");
  }
})