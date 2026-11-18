DSH 便捷工具（dsh-convenience）
==============================

当前版本：0.1.3。本项目由 dsh-easytier-access 演进而来，已验证 DSH 0.2.2-rc.3。
名称暂定；目前提供可信 IP 免登录与中文规则设置页，后续功能可独立加入。

使用设置页
----------
打开 DSH 左侧“插件”，选择已安装的“DSH 便捷工具”。
“可信 IP 免登录”表单显示在插件说明下方、“包含的组件”上方。
可以启用或停用免登录，添加、编辑、删除规则，为每条规则添加备注。
点击“保存设置”后即时生效，无须重启；设置通过官方接口写入当前 profile。
其他页面同时修改过配置时，本页拒绝覆盖，需先重新读取。

规则可填写：
  单个 IPv4：192.168.1.8
  IPv4 网段：192.168.1.0/24
  起止范围：192.168.1.10-192.168.1.30（含两端）
  单个 IPv6：fd00::8
  IPv6 网段：fd00::/64
  IPv6 范围：fd00::10-fd00::30
重叠规则按“任一启用规则命中”处理；没有拒绝规则，也没有优先级。
空列表或关闭总开关表示所有请求使用官方鉴权。
非法地址、前缀和逆序范围会被服务端拒绝，不写入配置。
默认仅信任 127.0.0.1 和 ::1，默认仅监听 127.0.0.1:3080。
不内置任何特定用户的 EasyTier 地址。

访问行为
--------
规则依据直接 TCP 连接的源 IP，不相信 X-Forwarded-For / Forwarded。
仅当来源命中、浏览器请求受官方信任、尚未登录且访问 GET / 或 /index.html 时，
插件向回环后端传递官方启动令牌，由官方服务签发 Cookie。
自动登录先返回一个同站过渡页面，保留官方 Cookie 的全部属性；页面以 HEAD
请求确认 Cookie 已通过官方鉴权后进入 DSH。Cookie 未返回时显示中文提示，
不会重复跳转，也不通过降低 Cookie 安全属性或注入 API 凭据绕过检查。
令牌不出现在插件日志、设置页或返回给浏览器的重定向地址中。
来源未命中时原样转交官方服务，已有 Cookie 和手动令牌登录照常使用。
因此，删除规则不会撤销已经签发的官方 Cookie；验证新规则请用无痕窗口。
Host、请求目标和官方 Origin 检查仍有效；OAuth 回调交给官方校验 state/PKCE。
WebSocket、流式响应和普通 HTTP 均转发。插件不注册出站网络代理或工具拦截器，
不改变搜索、网页抓取、模型 API 或其他插件的出站请求。
此版本支持 HTTP 入口及回环 HTTP 后端；不要把外部反向代理 IP 当成终端用户 IP。

安装和部署
----------
开发安装：
  npm ci --ignore-scripts
  npm test
  dsh plugin --profile web add link:/你的路径/dsh-convenience

必须把官方后端与插件入口分开。例如官方后端使用 127.0.0.1:3081：
  dsh web --no-open --host 127.0.0.1 --port 3081 \
    --trusted-host 192.168.1.8:3080 --public-url http://192.168.1.8:3080/

在当前 profile 的 cordis.patch.yml 中配置监听地址（示例 IP 请替换为本机接口）：
  - id: convenience
    config:
      listeners:
        - host: 127.0.0.1
          port: 3080
          aliases: [localhost]
        - host: 192.168.1.8
          port: 3080
          waitForAddress: true

监听配置修改需要重启插件/DSH；免登录规则在设置页修改即可。
waitForAddress 会在虚拟网卡尚未就绪时每 5 秒重试绑定，保留其他入口。
不支持 0.0.0.0 或 :: 全接口监听；额外主机名须同时列入 aliases 和官方 trusted-host。
插件不修改系统防火墙、EasyTier 配置、官方二进制或其他插件。

本机从旧版迁移时，在 profile 显式保留原来的监听接口与可信网段。
不要同时启用旧版 dsh-easytier-access 和本插件，以免争用入口端口。
停用/卸载本插件会关闭它的入口，请从官方后端启动链接恢复登录后操作。

开发和验证
----------
  npm run build     生成官方 ModuleLoader 可加载的 dist/client.js
  npm test          IP 边界、服务端校验、HTTP 代理、中文设置页交互与并发修改测试
  npm pack --dry-run 检查发行文件

src/config.js：官方配置 schema 与服务端语义校验。
src/ip-rules.js：严格 IP 解析、CIDR/范围和即时匹配。
src/proxy.js：入站 HTTP / WebSocket 代理及生命周期。
src/login-page.js：同站登录过渡页面及 Cookie 可用性检查。
src/client.jsx：注册在 plugins.bundle.config 中的中文设置页，直接显示在本插件详情中。
不同工具可增设独立模块；不要把无关功能塞入访问代理。

发布状态
--------
当前版本通过上面的开发安装步骤使用，尚未发布到 npm 或插件市场。
插件市场收录步骤见 PUBLISHING.txt。
