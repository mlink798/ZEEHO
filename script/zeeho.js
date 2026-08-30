#!name = 极核ZEEHO自动签到
#!desc = 极核 APP 每日自动签到+积分任务（签到/盲盒抽奖/动态/点赞/分享）。打开极核 APP 进入「我的」页面一次，插件自动捕获 userId/Authorization/Cookie，无需手动抓包；每日定时自动签到并推送 iOS 通知。仅供个人学习使用，请勿用于违规用途。
#!author = zeeho-signin (Loon port)
#!homepage = https://github.com/jixiaotong1999/zeeho-signin
#!system = iOS
#!loon_version = 2.0
#!tag = 签到,自动化
#!type = normal

[Script]
# ① 捕获：极核 APP 所有 API 请求（tapi/h5 等 zeehoev.com 子域）→ 自动保存 Authorization/User-Agent/Cookie(user_id)
http-request ^https?:\/\/(?:[\w-]+\.)*zeehoev\.com\/.* script-path=https://aka.doubaocdn.com/s/VmAJHfvDpU, tag=极核捕获凭证, enable=true
# ② 捕获：极核 APP「我的」页 setting 接口 → 自动解析 userId/昵称
http-response ^https?:\/\/tapi\.zeehoev\.com\/v1\.0\/mine\/cfmotoservermine\/setting.* script-path=https://aka.doubaocdn.com/s/VmAJHfvDpU, tag=极核获取账号, requires-body=true, enable=true
# ③ 定时：每天 08:10 自动签到+积分任务（可按需修改 cron 表达式）
cron "10 8 * * *" script-path=https://aka.doubaocdn.com/s/QiYWl4e6nL, tag=极核自动签到, enable=true

[Mitm]
hostname = h5.zeehoev.com, tapi.zeehoev.com, *.zeehoev.com
