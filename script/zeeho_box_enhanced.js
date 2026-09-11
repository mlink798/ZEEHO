===== index.html (增强版) =====
<!DOCTYPE html>
<html lang="zh‑CN">
<head>
<meta charset="UTF‑8" />
<meta name="viewport" content="width=device‑width, initial‑scale=1.0"/>
<title>极核 ZEEHO LITE 增强版</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{background:#0b1422;color:#e8edf3;padding:16px;min-height:100vh;padding-bottom:85px}
.header{display:flex;align-items:center;gap:12px;margin-bottom:20px}
.logo{width:52px;height:52px;border-radius:16px;background:#23c6de;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:24px;color:#0b1422}
.title-group h1{font-size:22px}
.badge-lite{background:#144957;color:#37d0e8;font-size:12px;padding:2px 8px;border-radius:12px;margin-left:6px}
.subtitle{font-size:14px;color:#99a8b8;margin-top:2px}
.refresh-icon{margin-left:auto;width:44px;height:44px;border-radius:12px;background:#1c293b;display:flex;align-items:center;justify-content:center;cursor:pointer}
.panel-desc{background:#2c2c24;color:#ffdd77;padding:10px 14px;border-radius:10px;margin-bottom:18px;font-size:14px}
.stat-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0}
.stat-card{background:#172436;border-radius:14px;padding:16px}
.stat-num{font-size:32px;font-weight:bold;color:#37d0e8}
.stat-label{font-size:13px;color:#99a8b8;margin-top:4px}
.big-card{background:#172436;border-radius:18px;padding:20px;margin-bottom:16px}
.account-header{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.avatar-box{width:48px;height:48px;border-radius:12px;background:#23c6de;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:bold;color:#0b1422;overflow:hidden}
.avatar-box img{width:100%;height:100%;object‑fit:cover}
.name-id h3{font-size:19px}
.name-id div{font-size:13px;color:#99a8b8}
.tag-group{margin-left:auto;display:flex;gap:8px}
.tag{padding:5px 12px;border-radius:20px;font-size:13px}
.tag-green{background:#194c47;color:#42e299}
.tag-blue{background:#164458;color:#37d0e8}
.num-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
.num-item{background:#1f2f44;padding:12px 6px;border-radius:12px;text-align:center}
.num-val{font-size:24px;font-weight:bold}
.num-desc{font-size:12px;color:#99a8b8;margin-top:3px}
.progress-wrap{margin-bottom:16px}
.progress-title{font-size:15px;margin-bottom:8px}
.progress-bar{width:100%;height:14px;background:#283950;border-radius:999px;overflow:hidden}
.progress-fill{height:100%;background:#a87bff}
.calendar-row{display:grid;grid-template-columns:repeat(7,1fr);gap:8px}
.c-day{aspect‑ratio:1/1;background:#1f2f44;border-radius:10px;display:flex;flex‑direction:column;align‑items:center;justify‑content:center;font‑size:14px}
.c-day.checked{background:#1c4b58;color:#37d0e8}
.tab-bar{position:fixed;left:0;right:0;bottom:0;background:#131e2f;display:grid;grid-template-columns:1fr 1fr 1fr;padding:10px 0}
.tab-item{text‑align:center;font‑size:14px;padding:6px 0;color:#8899aa}
.tab-item.active{color:#37d0e8}
.no‑anim *{animation:none !important;transition:none !important}
.log-item{padding:10px;background:#172436;border‑radius:10px;margin‑bottom:8px;font‑size:13px;color:#c5d2e2}
.setting-block{background:#172436;border‑radius:14px;padding:16px;margin‑bottom:14px}
.setting-title{font‑size:16px;margin‑bottom:10px}
</style>
</head>
<body>
<div id="app"></div>
<div class="tab-bar">
<div class="tab-item active" data‑page="home">🏠首页</div>
<div class="tab-item" data‑page="log">☰日志</div>
<div class="tab-item" data‑page="setting">⚙设置</div>
</div>
<script>
const App={
    state:{
        page:"home",
        accountList:[],
        noAnim:false,
        logList:[]
    },
    async refreshAll(){
        this.state.noAnim=true;
        await this.fetchAllAccounts();
        this.render();
    },
    async fetchAllAccounts(){
        try{
            const res=await fetch("/api/data");
            this.state.accountList=await res.json();
        }catch(e){
            console.error("获取账号数据失败",e);
        }
    },
    render(){
        const app=document.getElementById("app");
        if(this.state.noAnim) app.classList.add("no‑anim");
        else app.classList.remove("no‑anim");
        switch(this.state.page){
            case "home": this.renderHome();break;
            case "log": this.renderLog();break;
            case "setting": this.renderSetting();break;
        }
    },
    async renderHome(){
        let totalScore=0,bindCar=0,tokenOk=0;
        for(let acc of this.state.accountList){
            totalScore+=Number(acc.score||0);
            if(acc.tokenStatus) tokenOk++;
            bindCar+=Number(acc.carCount||0);
        }
        let html=`
<div class="header">
    <div class="logo">Z</div>
    <div class="title-group">
        <h1>极核 ZEEHO<span class="badge-lite">LITE‑增强</span></h1>
        <div class="subtitle">签到 · 车辆 · 控车</div>
    </div>
    <div class="refresh-icon" onclick="App.refreshAll()">⟳</div>
</div>
<div class="big-card">
    <div style="font‑size:16px;color:#99a8b8">账号总积分</div>
    <div style="font‑size:64px;font‑weight:bold;color:#37d0e8;margin:6px 0">${totalScore.toLocaleString()}</div>
    <div style="text‑align:right;color:#42e299">今日已签到 ${tokenOk}/${this.state.accountList.length}</div>
    <div class="stat-row">
        <div class="stat-card"><div class="stat-num">${bindCar}</div><div class="stat-label">绑定车辆</div></div>
        <div class="stat-card"><div class="stat-num">${tokenOk}</div><div class="stat-label">Token 正常</div></div>
    </div>
</div>
<div class="panel-desc">面板模式：数据由本机脚本后端签名与获取。</div>
<div style="margin:20px 0;font‑size:16px">🚗 账号状态</div>
`;
        for(let acc of this.state.accountList){
            html+=this.renderAccountCard(acc);
        }
        app.innerHTML=html;
    },
    renderAccountCard(acc){
        let avatarHtml;
        if(acc.avatarUrl){
            avatarHtml=`<img src="${acc.avatarUrl}" alt="avatar" loading="lazy"/>`;
        }else{
            const firstChar=(acc.name||"L")[0].toUpperCase();
            avatarHtml=`<span>${firstChar}</span>`;
        }
        let calendarHtml="";
        const sevenDays=acc.recent7||[];
        for(let d of sevenDays){
            calendarHtml+=`<div class="c-day ${d.ok?'checked':''}">${d.day}</div>`;
        }
        const blindPercent=Math.round((acc.blindNow/acc.blindTotal)*100);
        return `
<div class="big-card">
    <div class="account-header">
        <div class="avatar-box">${avatarHtml}</div>
        <div class="name-id">
            <h3>${acc.name||"--"}</h3>
            <div>ID ${acc.uid||"--"}</div>
        </div>
        <div class="tag-group">
            <span class="tag tag-blue">Token 正常</span>
            <span class="tag tag-green">已签到</span>
        </div>
    </div>
    <div class="num-grid">
        <div class="num-item"><div class="num-val">${acc.score||0}</div><div class="num-desc">总积分</div></div>
        <div class="num-item"><div class="num-val">+${acc.todayScore||0}</div><div class="num-desc">今日积分</div></div>
        <div class="num-item"><div class="num-val">${acc.continueDays||0}</div><div class="num-desc">连签天数</div></div>
        <div class="num-item"><div class="num-val">${acc.blindRemain||0}</div><div class="num-desc">距盲盒</div></div>
    </div>
    <div class="progress-wrap">
        <div class="progress-title">盲盒进度 ${acc.blindNow}/${acc.blindTotal} · ${blindPercent}%</div>
        <div class="progress-bar">
            <div class="progress-fill" style="width:${blindPercent}%"></div>
        </div>
    </div>
    <div class="calendar-row">${calendarHtml}</div>
</div>
`;
    },
    renderLog(){
        const app=document.getElementById("app");
        let html=`
<div class="header">
    <div class="logo">Z</div>
    <div class="title-group">
        <h1>操作日志<span class="badge-lite">LITE‑增强</span></h1>
        <div class="subtitle">签到记录、接口返回日志</div>
    </div>
</div>
`;
        if(this.state.logList.length===0){
            html+='<div class="setting-block">暂无日志</div>';
        }else{
            for(let l of this.state.logList){
                html+=`<div class="log-item">${l}</div>`;
            }
        }
        app.innerHTML=html;
    },
    renderSetting(){
        const app=document.getElementById("app");
        app.innerHTML=`
<div class="header">
    <div class="logo">Z</div>
    <div class="title-group">
        <h1>设置<span class="badge-lite">LITE‑增强</span></h1>
        <div class="subtitle">账号管理、参数配置</div>
    </div>
</div>
<div class="setting-block">
    <div class="setting-title">账号列表</div>
    <div>共 ${this.state.accountList.length} 个已绑定账号</div>
</div>
<div class="setting-block">
    <div class="setting-title">版本</div>
    <div>ZEEHO‑LITE‑Enhanced V2.12</div>
</div>
`;
    },
    bindTab(){
        document.querySelectorAll(".tab-item").forEach(el=>{
            el.onclick=()=>{
                document.querySelectorAll(".tab-item").forEach(t=>t.classList.remove("active"));
                el.classList.add("active");
                this.state.page=el.dataset.page;
                this.render();
            }
        })
    },
    init(){
        this.bindTab();
        this.refreshAll();
    }
};
window.onload=()=>App.init();
</script>
</body>
</html>

===== zeeho_box_enhanced_lite.js (清理无用代码版) =====
// 极核签到增强脚本 · 清理冗余旧面板、签到执行函数，支持头像获取
// 移除：runSignin、runAllSignin、barkPush、旧版renderDashboard、签到弹窗代码
// 新增：getUserInfo 获取头像url，并发分批拉取账号数据，优化刷新速度

const $config={
    delayMin:600,
    delayMax:1200,
    batchSize:2,
    apiDomain:"https://api‑zeeho.example.com"
};

async function sleep(ms){
    return new Promise(resolve=>setTimeout(resolve,ms));
}

// 获取ID+头像
async function getUseridByToken(token){
    const resp=await fetch(`${$config.apiDomain}/get‑userid`,{
        method:"POST",
        body:JSON.stringify({token})
    });
    const json=await resp.json();
    return {
        uid:json.userId,
        avatarUrl:json.headUrl||json.avatar||""
    }
}

// 获取单个账号完整数据
async function fetchAccountData(token){
    const uidObj=await getUseridByToken(token);
    await sleep(Math.floor(Math.random()*($config.delayMax‑$config.delayMin))+$config.delayMin);
    const res=await fetch(`${$config.apiDomain}/get‑account`,{
        method:"POST",
        body:JSON.stringify({token,uid:uidObj.uid})
    });
    const d=await res.json();
    return {
        uid:uidObj.uid,
        avatarUrl:uidObj.avatarUrl,
        name:d.nickname,
        score:d.score,
        todayScore:d.todayScore,
        continueDays:d.continueDays,
        blindNow:d.blindNow,
        blindTotal:d.blindTotal,
        blindRemain:d.blindRemain,
        carCount:d.carCount,
        tokenStatus:true,
        recent7:d.recent7
    }
}

// 分批并发拉取，避免限流，解决刷新慢、数据显示不及时
async function fetchBatch(tokenList){
    let result=[];
    for(let i=0;i<tokenList.length;i+=$config.batchSize){
        const slice=tokenList.slice(i,i+$config.batchSize);
        const tasks=slice.map(t=>fetchAccountData(t).catch(err=>{
            console.error("账号拉取失败",err);
            return null;
        }));
        const batch=await Promise.all(tasks);
        result.push(...batch.filter(x=>x!==null));
    }
    return result;
}

// 后端路由示例（适配Surge/JSBox）
const Backend={
    tokenList:[],
    async getDashboard(){
        return await fetchBatch(this.tokenList);
    }
}

// 移除全部签到执行相关函数，不再自动发起签到请求

// base64 内嵌增强版index.html，用于无本地html文件环境
const panelHtmlB64=btoa(`<!DOCTYPE html>
<html lang="zh‑CN">
<head>
<meta charset="UTF‑8" />
<meta name="viewport" content="width=device‑width, initial‑scale=1.0"/>
<title>极核 ZEEHO LITE 增强版</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{background:#0b1422;color:#e8edf3;padding:16px;min-height:100vh;padding-bottom:85px}
.header{display:flex;align-items:center;gap:12px;margin-bottom:20px}
.logo{width:52px;height:52px;border-radius:16px;background:#23c6de;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:24px;color:#0b1422}
.title-group h1{font-size:22px}
.badge-lite{background:#144957;color:#37d0e8;font-size:12px;padding:2px 8px;border-radius:12px;margin-left:6px}
.subtitle{font-size:14px;color:#99a8b8;margin-top:2px}
.refresh-icon{margin-left:auto;width:44px;height:44px;border-radius:12px;background:#1c293b;display:flex;align-items:center;justify-content:center;cursor:pointer}
.panel-desc{background:#2c2c24;color:#ffdd77;padding:10px 14px;border-radius:10px;margin-bottom:18px;font-size:14px}
.stat-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0}
.stat-card{background:#172436;border-radius:14px;padding:16px}
.stat-num{font-size:32px;font-weight:bold;color:#37d0e8}
.stat-label{font-size:13px;color:#99a8b8;margin-top:4px}
.big-card{background:#172436;border-radius:18px;padding:20px;margin-bottom:16px}
.account-header{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.avatar-box{width:48px;height:48px;border-radius:12px;background:#23c6de;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:bold;color:#0b1422;overflow:hidden}
.avatar-box img{width:100%;height:100%;object‑fit:cover}
.name-id h3{font-size:19px}
.name-id div{font-size:13px;color:#99a8b8}
.tag-group{margin-left:auto;display:flex;gap:8px}
.tag{padding:5px 12px;border-radius:20px;font-size:13px}
.tag-green{background:#194c47;color:#42e299}
.tag-blue{background:#164458;color:#37d0e8}
.num-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
.num-item{background:#1f2f44;padding:12px 6px;border-radius:12px;text-align:center}
.num-val{font-size:24px;font-weight:bold}
.num-desc{font-size:12px;color:#99a8b8;margin-top:3px}
.progress-wrap{margin-bottom:16px}
.progress-title{font-size:15px;margin-bottom:8px}
.progress-bar{width:100%;height:14px;background:#283950;border-radius:999px;overflow:hidden}
.progress-fill{height:100%;background:#a87bff}
.calendar-row{display:grid;grid-template-columns:repeat(7,1fr);gap:8px}
.c-day{aspect‑ratio:1/1;background:#1f2f44;border-radius:10px;display:flex;flex‑direction:column;align‑items:center;justify‑content:center;font‑size:14px}
.c-day.checked{background:#1c4b58;color:#37d0e8}
.tab-bar{position:fixed;left:0;right:0;bottom:0;background:#131e2f;display:grid;grid-template-columns:1fr 1fr 1fr;padding:10px 0}
.tab-item{text‑align:center;font‑size:14px;padding:6px 0;color:#8899aa}
.tab-item.active{color:#37d0e8}
.no‑anim *{animation:none !important;transition:none !important}
.log-item{padding:10px;background:#172436;border‑radius:10px;margin‑bottom:8px;font‑size:13px;color:#c5d2e2}
.setting-block{background:#172436;border‑radius:14px;padding:16px;margin‑bottom:14px}
.setting-title{font‑size:16px;margin‑bottom:10px}
</style>
</head>
<body>
<div id="app"></div>
<div class="tab-bar">
<div class="tab-item active" data‑page="home">🏠首页</div>
<div class="tab-item" data‑page="log">☰日志</div>
<div class="tab-item" data‑page="setting">⚙设置</div>
</div>
<script>
const App={
    state:{page:"home",accountList:[],noAnim:false,logList:[]},
    async refreshAll(){
        this.state.noAnim=true;
        await this.fetchAllAccounts();
        this.render();
    },
    async fetchAllAccounts(){
        try{
            const res=await fetch("/api/data");
            this.state.accountList=await res.json();
        }catch(e){console.error(e);}
    },
    render(){
        const app=document.getElementById("app");
        if(this.state.noAnim) app.classList.add("no‑anim");
        else app.classList.remove("no‑anim");
        switch(this.state.page){
            case "home":this.renderHome();break;
            case "log":this.renderLog();break;
            case "setting":this.renderSetting();break;
        }
    },
    async renderHome(){
        let totalScore=0,bindCar=0,tokenOk=0;
        for(let acc of this.state.accountList){
            totalScore+=Number(acc.score||0);
            if(acc.tokenStatus)tokenOk++;
            bindCar+=Number(acc.carCount||0);
        }
        let html=`
<div class="header"><div class="logo">Z</div><div class="title-group"><h1>极核 ZEEHO<span class="badge-lite">LITE‑增强</span></h1><div class="subtitle">签到 · 车辆 · 控车</div></div><div class="refresh-icon" onclick="App.refreshAll()">⟳</div></div>
<div class="big-card"><div style="font‑size:16px;color:#99a8b8">账号总积分</div><div style="font‑size:64px;font‑weight:bold;color:#37d0e8;margin:6px 0">${totalScore.toLocaleString()}</div><div style="text‑align:right;color:#42e299">今日已签到 ${tokenOk}/${this.state.accountList.length}</div><div class="stat-row"><div class="stat-card"><div class="stat-num">${bindCar}</div><div class="stat-label">绑定车辆</div></div><div class="stat-card"><div class="stat-num">${tokenOk}</div><div class="stat-label">Token 正常</div></div></div></div>
<div class="panel-desc">面板模式：数据由本机脚本后端签名与获取。</div>
<div style="margin:20px 0;font‑size:16px">🚗 账号状态</div>`;
        for(let acc of this.state.accountList) html+=this.renderAccountCard(acc);
        app.innerHTML=html;
    },
    renderAccountCard(acc){
        let avatarHtml=acc.avatarUrl?`<img src="${acc.avatarUrl}" loading="lazy"/>`:`<span>${(acc.name||"L")[0].toUpperCase()}</span>`;
        let cal="";
        (acc.recent7||[]).forEach(d=>cal+=`<div class="c-day ${d.ok?'checked':''}">${d.day}</div>`);
        const pct=Math.round((acc.blindNow/acc.blindTotal)*100);
        return `<div class="big-card"><div class="account-header"><div class="avatar-box">${avatarHtml}</div><div class="name-id"><h3>${acc.name||"--"}</h3><div>ID ${acc.uid||"--"}</div></div><div class="tag-group"><span class="tag tag-blue">Token 正常</span><span class="tag tag-green">已签到</span></div></div><div class="num-grid"><div class="num-item"><div class="num-val">${acc.score||0}</div><div class="num-desc">总积分</div></div><div class="num-item"><div class="num-val">+${acc.todayScore||0}</div><div class="num-desc">今日积分</div></div><div class="num-item"><div class="num-val">${acc.continueDays||0}</div><div class="num-desc">连签天数</div></div><div class="num-item"><div class="num-val">${acc.blindRemain||0}</div><div class="num-desc">距盲盒</div></div></div><div class="progress-wrap"><div class="progress-title">盲盒进度 ${acc.blindNow}/${acc.blindTotal} · ${pct}%</div><div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div></div><div class="calendar-row">${cal}</div></div>`;
    },
    renderLog(){
        const app=document.getElementById("app");
        let html=`<div class="header"><div class="logo">Z</div><div class="title-group"><h1>操作日志<span class="badge-lite">LITE‑增强</span></h1><div class="subtitle">签到记录、接口返回日志</div></div></div>`;
        html+=this.state.logList.length?this.state.logList.map(x=>`<div class="log-item">${x}</div>`).join(""):"<div class='setting-block'>暂无日志</div>";
        app.innerHTML=html;
    },
    renderSetting(){
        const app=document.getElementById("app");
        app.innerHTML=`<div class="header"><div class="logo">Z</div><div class="title-group"><h1>设置<span class="badge-lite">LITE‑增强</span></h1><div class="subtitle">账号管理、参数配置</div></div></div><div class="setting-block"><div class="setting-title">账号列表</div><div>共 ${this.state.accountList.length} 个已绑定账号</div></div><div class="setting-block"><div class="setting-title">版本</div><div>ZEEHO‑LITE‑Enhanced V2.12</div></div>`;
    },
    bindTab(){
        document.querySelectorAll(".tab-item").forEach(el=>{el.onclick=()=>{document.querySelectorAll(".tab-item").forEach(t=>t.classList.remove("active"));el.classList.add("active");this.state.page=el.dataset.page;this.render();}})
    },
    init(){this.bindTab();this.refreshAll();}
};
window.onload=()=>App.init();
</script>
</body>
</html>`);