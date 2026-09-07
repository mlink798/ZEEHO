/*
#!name=极核 ZEEHO 签到面板
#!desc=极核ZEEHO多账号签到面板，访问 http://zeeho.box，去除Bark推送，同步修复签到显示逻辑
#!author=lucky
#!version=2.4.7-box
#!homepage=https://github.com/mlink798/ZEEHO
*/

// ========= PersistentStore 封装 =========
const StoreBox = {
    read(key) {
        try {
            const s = $persistentStore.read(key);
            return s ? JSON.parse(s) : null;
        } catch (e) { return null; }
    },
    write(key, obj) {
        try {
            return $persistentStore.write(JSON.stringify(obj), key);
        } catch (e) { return false; }
    }
};

// ========= 日志存储 =========
const LOG_KEY = "zeeho_runtime_log";
const MAX_LOG = 50;
function pushLog(item) {
    let logs = StoreBox.read(LOG_KEY) || [];
    logs.unshift({ ts: Date.now(), ...item });
    if(logs.length>MAX_LOG) logs = logs.slice(0,MAX_LOG);
    StoreBox.write(LOG_KEY, logs);
}
function getLogList(){
    return StoreBox.read(LOG_KEY) || [];
}
function clearLog(){
    StoreBox.write(LOG_KEY,[]);
}

// =========账号读取 =========
function getAccounts(){
    const raw = StoreBox.read("zeeho_accounts");
    if(!raw||!Array.isArray(raw)) return [];
    return raw.filter(a=>a.token&&a.userId);
}

// ========= HTML页面渲染 =========
function renderHtml(){
    const accounts = getAccounts();
    const logs = getLogList();
    let htmlAcc = "";
    let signedCount = 0;

    for(const acc of accounts){
        const name = acc.name||"未知账号";
        const contDay = acc.continueDay||0;
        const todayScore = acc.todayScore||0;
        const isSign = acc.todaySign === true;
        if(isSign) signedCount++;

        htmlAcc += `
<div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:10px 0;background:#fff;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="font-size:18px;font-weight:bold;">${name}</div>
        <span style="padding:4px 10px;border-radius:8px;font-size:13px;background:${isSign?"#dcfce7;color:#166534":"#fee2e2;color:#991b1b"}">${isSign?"已签到":"未签到"}</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div style="background:#f9fafb;padding:12px;border-radius:8px;">
            <div style="font-size:24px;font-weight:bold;">${acc.totalPoint??"--"}</div>
            <div style="font-size:12px;color:#6b7280;">总积分</div>
        </div>
        <div style="background:#f9fafb;padding:12px;border-radius:8px;">
            <div style="font-size:24px;font-weight:bold;color:#059669;">+${todayScore}</div>
            <div style="font-size:12px;color:#6b7280;">今日积分</div>
        </div>
        <div style="background:#f9fafb;padding:12px;border-radius:8px;">
            <div style="font-size:24px;font-weight:bold;">${contDay}</div>
            <div style="font-size:12px;color:#6b7280;">连签天数</div>
        </div>
        <div style="background:#f9fafb;padding:12px;border-radius:8px;">
            <div style="font-size:24px;font-weight:bold;">${acc.boxLeft??"--"}</div>
            <div style="font-size:12px;color:#6b7280;">距盲盒</div>
        </div>
    </div>
</div>`;
    }

    let htmlLog = "";
    for(const l of logs){
        const dt = new Date(l.ts);
        const timestr = `${dt.getFullYear()}/${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}:${String(dt.getSeconds()).padStart(2,'0')}`;
        htmlLog +=`
<div style="padding:10px 0;border-bottom:1px solid #eee;">
    <div style="color:#6b7280;font-size:12px;">${timestr}</div>
    <div style="font-weight:bold;margin:4px 0;">${l.name} <span style="color:${l.ok?"#059669":"#dc2626"}">${l.ok?"成功":"失败"} ${l.score?`+${l.score}`:""}</span></div>
    <div style="font-size:13px;color:#444;">${l.msg||""}</div>
</div>`;
    }

    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>极核 ZEEHO 签到面板</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto}
body{background:#f3f4f6;padding:12px;max-width:720px;margin:0 auto;}
.header{display:flex;align-items:center;gap:8px;margin-bottom:16px;}
.btns{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;}
button{padding:10px 16px;border:none;border-radius:10px;background:#0891b2;color:white;font-size:15px;}
button.gray{background:#9ca3af;}
</style>
</head>
<body>
    <div class="header">
        <div style="width:40px;height:40px;background:#0891b2;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;">Z</div>
        <div>
            <div style="font-size:20px;font-weight:bold;">极核 ZEEHO 签到面板</div>
            <div style="font-size:13px;color:#6b7280;">${accounts.length} 个账号 · 实时数据</div>
        </div>
    </div>
    <div class="btns">
        <span style="background:#dcfce7;color:#166534;padding:6px 10px;border-radius:8px;font-size:14px;">${signedCount}/${accounts.length} 已签到</span>
        <button onclick="location.reload()">刷新</button>
    </div>
    ${htmlAcc||"<div>暂无账号，请先捕获Token</div>"}
    <hr style="margin:20px 0;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
        <h3>运行日志（最近${MAX_LOG}条）</h3>
        <button class="gray" onclick="fetch('/clearLog').then(()=>location.reload())">清空日志</button>
    </div>
    ${htmlLog||"<div style='padding:10px;color:#666;'>暂无日志</div>"}
</body>
</html>`;
    return html;
}

// ========= http入口处理 =========
async function handleRequest(request){
    const url = new URL(request.url);
    const path = url.pathname;

    if(path==="/clearLog"){
        clearLog();
        return {status:200,headers:{"Content‑Type":"text/plain;charset=utf‑8"},body:"ok"};
    }

    return {
        status:200,
        headers:{"Content‑Type":"text/html;charset=utf‑8"},
        body:renderHtml()
    }
}

$httpServer.handleRequest(async req=>{
    const resp = await handleRequest(req);
    return resp;
})