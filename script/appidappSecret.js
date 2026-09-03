/*
极核 ZEEHO appId/appSecret 自动捕获脚本（Loon版）
功能：
1. 自动拦截极核 API 请求，从请求头提取 appId
2. 区分 H5 端（h5.zeehoev.com）和 App 端（tapi.zeehoev.com）
3. 自动保存 appId 到 Loon 持久化存储（$persistentStore）
4. appSecret 需手动在下方配置（无法从请求中自动捕获）
5. 捕获到新 appId 时通过通知提醒
6. 签到脚本/看板可直接从 $persistentStore 读取配置

使用方法：
1. Loon -> 脚本 -> 新增 -> 请求脚本
2. 匹配 URL：^https?://.*zeehoev\.com/.*
3. 脚本类型：request
4. 粘贴本脚本
5. 在下方 CONFIG 区域填入已知的 appSecret
6. 打开极核App任意页面，触发请求后自动捕获 appId
7. 查看 Loon 通知，确认捕获结果

配置存储键名（签到脚本可直接读取）：
- zeeho_h5_appId / zeeho_h5_appSecret
- zeeho_app_appId / zeeho_app_appSecret
*/

// ============ 手动配置区（填入已知的 appSecret） ============
const CONFIG = {
  h5: {
    appId: "",           // 留空自动捕获，已知可填入：Sw5F9uJi
    appSecret: "46870a8f678a09109468f5b0168818b91c292845"  // H5端 appSecret
  },
  app: {
    appId: "",           // 留空自动捕获，已知可填入：S7qPWPU1
    appSecret: "c5e0da7f4da28df805694ec3dd1fc6792e9df99d"  // App端 appSecret
  }
};

// ============ 存储键名 ============
const STORE_KEYS = {
  h5: { appId: 'zeeho_h5_appId', appSecret: 'zeeho_h5_appSecret' },
  app: { appId: 'zeeho_app_appId', appSecret: 'zeeho_app_appSecret' }
};

// ============ 工具函数 ============
function getType(url) {
  if (url.includes('h5.zeehoev.com')) return 'h5';
  if (url.includes('tapi.zeehoev.com')) return 'app';
  return null;
}

function extractAppId(headers) {
  const param = headers['cfmoto-x-param'] ||
                headers['Cfmoto-X-Param'] ||
                headers['CFMOTO-X-PARAM'] || '';
  const match = param.match(/appId=([^&]+)/i);
  return match ? match[1] : null;
}

function readStore(key) {
  try {
    return $persistentStore.read(key) || '';
  } catch(e) {
    return '';
  }
}

function writeStore(value, key) {
  try {
    $persistentStore.write(value, key);
    return true;
  } catch(e) {
    return false;
  }
}

function getSavedConfig(type) {
  const keys = STORE_KEYS[type];
  return {
    appId: readStore(keys.appId),
    appSecret: readStore(keys.appSecret)
  };
}

function saveConfig(type, appId, appSecret) {
  const keys = STORE_KEYS[type];
  if (appId) writeStore(appId, keys.appId);
  if (appSecret) writeStore(appSecret, keys.appSecret);
}

function maskSecret(secret) {
  if (!secret) return '(未设置)';
  if (secret.length < 12) return secret;
  return secret.substring(0, 8) + '...' + secret.substring(secret.length - 4);
}

function notify(title, subtitle, body) {
  try {
    $notification.post(title, subtitle, body);
  } catch(e) {
    console.log('通知失败:', e);
  }
}

// ============ 主逻辑 ============
async function main() {
  const url = $request.url;
  const headers = $request.headers;
  const type = getType(url);

  // 非极核域名，直接放行
  if (!type) {
    $done({});
    return;
  }

  const appId = extractAppId(headers);
  if (!appId) {
    $done({});
    return;
  }

  const typeName = type === 'h5' ? 'H5端' : 'App端';
  const saved = getSavedConfig(type);
  const manualConfig = CONFIG[type];

  // 优先使用手动配置的 appId，其次使用捕获到的
  const finalAppId = manualConfig.appId || appId;
  const finalSecret = manualConfig.appSecret || '';

  // 检查是否需要更新
  let needUpdate = false;
  let updateMsg = [];

  if (saved.appId !== finalAppId) {
    saveConfig(type, finalAppId, null);
    needUpdate = true;
    updateMsg.push(`appId: ${finalAppId}`);
  }

  if (finalSecret && saved.appSecret !== finalSecret) {
    saveConfig(type, null, finalSecret);
    needUpdate = true;
    updateMsg.push(`appSecret: ${maskSecret(finalSecret)}`);
  }

  // 首次捕获或配置更新时发送通知
  if (needUpdate) {
    const h5Config = getSavedConfig('h5');
    const appConfig = getSavedConfig('app');
    const body = `【H5端】appId: ${h5Config.appId || '(未捕获)'}\n` +
                 `         appSecret: ${maskSecret(h5Config.appSecret)}\n` +
                 `【App端】appId: ${appConfig.appId || '(未捕获)'}\n` +
                 `         appSecret: ${maskSecret(appConfig.appSecret)}`;
    notify(`极核 ${typeName} 配置已捕获`, `appId: ${finalAppId}`, body);
    console.log(`[极核捕获] ${typeName} 配置已保存: appId=${finalAppId}, appSecret=${maskSecret(finalSecret)}`);
  }

  $done({});
}

main().catch((e) => {
  console.log('[极核捕获] 脚本错误:', e);
  $done({});
});