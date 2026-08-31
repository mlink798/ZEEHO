/*
@Author: lucky
@HomePage: https://github.com/mlink798
@Date: 2026‑06‑07
@Description: 极核‑ZEEHO 每日签到、积分任务、社区互动、盲盒抽奖
获取 Cookie 方式：zeeho app‑我的

图标: https://raw.githubusercontent.com/mlink798/ZEEHO/refs/heads/main/script/ZEEHO.png

[Script]
# 获取 Cookie
http-response ^https:\/\/tapi\.zeehoev\.com\/v1\.0\/mine\/cfmotoservermine\/setting script-path=https://raw.githubusercontent.com/mlink798/ZEEHO/refs/heads/main/script/zeeho.js, requires-body=true, timeout=60, tag=极核Cookie

# 脚本任务
cron "0 7 * * *" script-path=https://raw.githubusercontent.com/mlink798/ZEEHO/refs/heads/main/script/zeeho.js, tag=极核

[MITM]
hostname = tapi.zeehoev.com

====================================
⚠️【免责声明】
------------------------------------------
1、此脚本仅用于学习研究，不保证其合法性、准确性、有效性，请根据情况自行判断，本人对此不承担任何保证责任。
2、由于此脚本仅用于学习研究，您必须在下载后 24 小时内将所有内容从您的计算机或手机或任何存储设备中完全删除，若违反规定引起任何事件本人对此均不负责。
3、请勿将此脚本用于任何商业或非法目的，若违反规定请自行对此负责。
4、此脚本涉及应用与本人无关，本人对因此引起的任何隐私泄漏或其他后果不承担任何责任。
5、本人对任何脚本引发的问题概不负责，包括但不限于由脚本错误引起的任何损失和损害。
6、如果任何单位或个人认为此脚本可能涉嫌侵犯其权利，应及时通知并提供身份证明，所有权证明，我们将在收到认证文件确认后删除此脚本。
7、所有直接或间接使用、查看此脚本的人均应该仔细阅读此声明。一旦您使用或复制了此脚本，即视为您已接受此免责声明。
 */

// env.js 全局
const $ = new Env("极核-ZEEHO");
const ckName = "zeeho_data";
//-------------------- 一般不动变量区域 -------------------------------------
const Notify = 1;//0为关闭通知,1为打开通知,默认为1
const notify = $.isNode() ? require('./sendNotify') : '';
let envSplitor = ["@"]; //多账号分隔符
var userCookie = ($.isNode() ? process.env[ckName] : $.getdata(ckName)) || '';
let userList = [];
let userIdx = 0;
let userCount = 0;

// 调试
$.is_debug = ($.isNode() ? process.env.IS_DEDUG : $.getdata('is_debug')) || 'false';
// 为多用户准备的通知数组
$.notifyList = [];
// 为通知准备的空数组
$.notifyMsg = [];

//---------------------- 自定义变量区域 -----------------------------------
//脚本入口函数main()
async function main() {
  try {
    $.log('\n================== 任务 ==================\n');
    for (let user of userList) {
      console.log(`🔷账号${user.index} >> Start work`)
      console.log(`随机延迟${user.getRandomTime()}ms`);
      // 签到
      const integral = await user.signin();
      let integralScore = 0
      if (user.ckStatus) {
        await $.wait(user.getRandomTime());
        // 查看签到记录
        const {
  count = 0,
  prize = 0,
  prizes = 0
} = await user.getSignRecord() || {}

await $.wait(user.getRandomTime());

if(prizes >= 30) {

  // 盲盒抽奖
  integralScore = await user.lottery()

  await $.wait(user.getRandomTime());

}
        // 创建动态
        let postId = await user.createArticle()
        await $.wait(user.getRandomTime());
        // 获取动态列表
        postId = postId || await user.getArticles()
        if (!postId) {
          $.log(`⚠️ 获取动态失败: 未获取到动态ID，跳过互动任务`);
          continue;
        }
        await $.wait(user.getRandomTime());
        // 点赞
        await user.thumbsUp(postId)
        await $.wait(user.getRandomTime());
        // 分享动态
        await user.comment(postId)
        await $.wait(user.getRandomTime());
        await user.share(postId)
        await $.wait(user.getRandomTime());
        
        // 删除动态
        await user.deletePost(postId)
        await $.wait(user.getRandomTime());
        //查询待领取积分
        const score = await user.getSignInfo();
        $.title = `本次运行共获得${(integral + integralScore + 3)}积分`;
        DoubleLog(`「${user.userName}」当前积分:${score}分,累计签到:${count}天`);
      } else {
        //将ck过期消息存入消息数组
        $.notifyMsg.push(`❌账号${user.userName || user.index} >> Check ck error!`)
      }
      //账号通知
      $.notifyList.push({ "id": user.index, "avatar": user.avatar, "message": $.notifyMsg });
      //清空数组
      $.notifyMsg = [];
    }
  } catch (e) {
    $.log(`⛔️ main run error => ${e}`);
    throw new Error(`⛔️ main run error => ${e}`);
  }
}


class UserInfo {
  constructor(user) {
    //默认属性
    this.index = ++userIdx;
    this.token = user.token || user;
    this.userId = user.userId;
    this.userName = user.userName;
    this.userAgent = user.userAgent;
    this.ckStatus = true;
    //请求封装
    this.baseUrl = ``;
    this.host = "";
    this.headers = {
      "Content-Type": "application/json;charset=UTF-8",
      "Authorization": this.token,
      "User-Agent": this.userAgent,
    }
    this.getRandomTime = () => randomInt(1e3, 3e3);
    this.fetch = async (o) => {
      try {
        if (typeof o === 'string') o = { url: o };
        if (o?.url?.startsWith("/")) o.url = this.host + o.url
        const res = await Request({ ...o, headers: o.headers || this.headers, url: o.url || this.baseUrl })
        debug(res, o?.url?.replace(/\/+$/, '').substring(o?.url?.lastIndexOf('/') + 1));
        if (res?.code == 40001) throw new Error(res?.message || `用户需要去登录`);
        return res;
      } catch (e) {
        this.ckStatus = false;
        $.log(`⛔️ 请求发起失败！${e}`);
      }
    }
  }
  //签到
  async signin() {
    try {
      const params = {
        server_name: 'SMART'
      }
      const opts = {
        url: "https://h5.zeehoev.com/cfmotoservermine/signin",
        type: "post",
        headers: Object.assign({}, this.headers, getSign('h5', params)),
        params,
        dataType: "json"
      }
      let res = await this.fetch(opts);
      if (res?.code == '10000' && res?.message == '操作成功') {
        if(res?.data?.signInStatus == 0 && res?.data?.integralScore) {
          $.log(`✅ 签到任务: 已完成`);
          const point = res?.data?.integralScore
          return point
        } else {
          $.log(`✅ 签到任务: 今日已签到`);
          return null
        }
      } else {
        $.log(`⛔️ 签到任务: ${res?.message}`);
        return null
      }
    } catch (e) {
      this.ckStatus = false;
      $.log(`⛔️ 签到失败! ${e}`);
    }
  }
    // 查询签到记录


  async getSignRecord() {

  try {

    const params = {
      month: new Date().getFullYear() + '-' + (new Date().getMonth() + 1),
      server_name: 'SMART'
    };

    const opts = {
      url: "https://h5.zeehoev.com/cfmotoservermine/signin/info",
      type: "get",
      headers: Object.assign({}, this.headers, getSign('h5', params)),
      params,
      dataType: "json"
    };

    let res = await this.fetch(opts);

    if (res?.code == '10000' && res?.message == '操作成功') {

      const list = res?.data?.nowSignDetailVos || [];

      // 今日日期
      const today = new Date().toISOString().slice(0, 10);

      // 找到今天索引
      const todayIndex = list.findIndex(
        item => item.createDate === today
      );

      // 连续签到天数
      let count = 0;

      // 从今天开始往前统计
      for (let i = todayIndex; i >= 0; i--) {

        const status = list[i]?.signStatue;

        // 3=已签到 5=补签
        if (status == 3 || status == 5) {
          count++;
        } else {
          break;
        }
      }

      // 今日积分
      const prize = res?.data?.integral || 0;

      // 连签累计奖励次数
      const prizes = res?.data?.signCount || 0;

      $.log(
        `✅ 连续签到${count}天 | 今日积分${prize} | 连签奖励累计${prizes}`
      );

      return {
        count,
        prize,
        prizes
      };

    }

    return null;

  } catch (e) {

    this.ckStatus = false;
    $.log(`⛔️ 查询签到记录失败! ${e}`);

  }

}
    // 开启盲盒


  async lottery() {
    try {
      const date = new Date();
      const today = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');

      const params = {
        supplementDate: today
      }
      const opts = {
        url: "https://h5.zeehoev.com/cfmotoservermine/signin/supplementPrize",
        type: "get",
        headers: Object.assign({}, this.headers, getSign('h5', params)),
        params,
        dataType: "json"
      }
      let res = await this.fetch(opts);
      if (res?.code == '10000') {

        const integralScore = res?.data?.integral || res?.data?.integralScore || 0;
        const prizesName = res?.data?.prizesName || (integralScore + '积分');
        $.log(`✅ 盲盒抽奖获得: ${prizesName}`);
        return Number(integralScore);
      } else {
        $.log(`⚠️ 盲盒抽奖(今日可能无盲盒): ${res?.message}`);
        return 0;
      }
    } catch (e) {
      this.ckStatus = false;
      $.log(`⛔️ 盲盒抽奖发起失败! ${e}`);
      return 0;
    }
  }
  
  // 创建动态
  async createArticle() {
    try {
      const opts = {
        url: `https://tapi.zeehoev.com/v1.0/social/cfmotoserversocial/commonArticle`,
        type: "post",
        dataType: "json",
        headers: Object.assign({}, this.headers, getSign('app')),
        body: {
          postcontent: "开心的一天"
        }
      }
      let res = await this.fetch(opts);
      if (res?.code == '10000') {
        const postId = getPostId(res?.data);
        $.log(`✅ 创建动态: 成功${postId ? ` ${postId}` : ''}`);
        return postId;
      } else {
        $.log(`⚠️ 创建动态失败: ${res?.message}`);
      }
    } catch (e) {
      this.ckStatus = false;
      $.log(`⛔️ 创建动态失败! ${e}`);
    }
  }
  // 获取动态列表
  async getArticles() {
    try {
      const opts = {
        url: `https://tapi.zeehoev.com/v1.0/social/cfmotoserversocial/community/mineArticleInfo`,
        type: "get",
        headers: Object.assign({}, this.headers, getSign('app')),
        dataType: "json",
        params: {
          userId: this.userId,
          page: 1,
          pageSize: 10
        }
      }
      let res = await this.fetch(opts);
      if (res?.code == '10000') {
        const list = Array.isArray(res?.data) ? res.data : (res?.data?.records || res?.data?.list || res?.data?.rows || [])
        let postId = getPostId(list?.[0] || res?.data)
        if (!postId) postId = await this.getCommunityArticle()
        $.log(`✅ 获取动态: ${postId}`);
        return postId
      } else {
        $.log(`⚠️ 获取动态失败: ${res?.message}`);
      }
    } catch (e) {
      this.ckStatus = false;
      $.log(`⛔️ 获取动态列表失败! ${e}`);
    }
  }
  async getCommunityArticle() {
    try {
      const opts = {
        url: `https://tapi.zeehoev.com/v1.0/social/cfmotoserversocial/community/qbTzInfoNewV2`,
        type: "get",
        headers: Object.assign({}, this.headers, getSign('app')),
        dataType: "json",
        params: {
          page: 1,
          pageSize: 20,
          postModule: 2,
          slidingType: 1
        }
      }
      const res = await this.fetch(opts);
      if (res?.code == '10000') {
        const list = Array.isArray(res?.data) ? res.data : [];
        const mine = list.find(item => String(item.userId || item.createBy || item.uid || '') === String(this.userId));
        return getPostId(mine || list[0]);
      }
      return null;
    } catch (e) {
      $.log(`⚠️ 获取社区动态失败: ${e}`);
      return null;
    }
  }

  // 点赞动态
  async thumbsUp(postId) {
    try {
      const opts = {
        url: `https://tapi.zeehoev.com/v1.0/social/cfmotoserversocial/socialCommu/likeFavoriteInfo`,
        type: "post",
        headers: Object.assign({}, this.headers, getSign('app')),
        dataType: "json",
        body: {
          postId: String(postId),
          kindFlag:"0"
        }
      }
      const res = await this.fetch(opts);
      if (res?.code == '1000...