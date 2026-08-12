# ftle

[![CI](https://github.com/boomzero/ftle/actions/workflows/ci.yml/badge.svg)](https://github.com/boomzero/ftle/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](README.md) | 简体中文

一个完全运行在 Cloudflare 免费套餐上的动态可编辑博客引擎——无需维护服务器,无需照看数据库,也没有每月的托管账单。

大多数自托管博客引擎(WordPress 及其同类)用一个基于网页的编辑器,换来的是一台 PHP 服务器、一个 MySQL 实例、插件安全补丁,以及一份托管账单。ftle 保留了真正有用的部分——随时随地通过浏览器撰写和发布——并抛弃了其余的一切:它只是一个 Cloudflare Worker 和一个 D1(SQLite)数据库,一条命令即可部署,也无需打补丁,因为根本没有可被攻破的服务器进程。

- **免费运行。** 完全适配 Cloudflare 免费的 Workers + D1 套餐。边缘缓存命中会完全跳过 Worker 和数据库——不消耗 CPU 时间,也不产生 D1 读取——所以只有缓存未命中(新文章,或缓存清除后的首位读者)才会真正访问它们。保存文章时只会清除受影响的缓存标签,因此修改依然会立即生效,不存在缓存陈旧的取舍问题。(缓存命中仍会计入 Free 套餐每日 100,000 次请求的配额——这并非真正无限的流量,只是廉价的流量。)
- **快速。** 面向读者的页面输出 **0 字节 JavaScript**,压缩后的 HTML **≤ 14KB**,由 Cloudflare 边缘缓存提供服务。每次提交都会通过回归测试强制执行这一预算——参见[性能预算](#性能预算)。
- **攻击面小。** 没有 PHP,没有插件生态,没有可能泄露的数据库凭据。后台面板由 [Cloudflare Access](#3-配置-cloudflare-access) 把关——请求到达 Worker 之前,Cloudflare 就已经验证了你的身份。
- **随时随地编辑。** 基于网页的 Markdown 编辑器,支持 LaTeX 数学公式实时预览——无需本地工具链,无需构建步骤,也无需重新生成静态站点。

## 特性

- 支持原始 HTML 直通与服务端 [KaTeX](https://katex.org) 数学公式渲染(`$inline$` 与 `$$display$$`)的 Markdown 文章
- 草稿 / 不公开 / 已发布三种文章可见性
- 从编辑器直接上传图片——按钮或粘贴均可——通过可插拔的外部图床(参见[图片上传](#图片上传))
- 标签、Atom 订阅源(`/rss.xml`)、`sitemap.xml`、`robots.txt`
- 每篇文章都带有 OpenGraph、Twitter Card 与 JSON-LD `BlogPosting` 元数据
- 使用 Tailwind 实现的深色模式感知样式,内联到每个页面中(无外部样式表)
- 基于缓存标签的 CDN 失效机制——修改立即生效,而不是等待 TTL 过期

## 快速开始

配置过程是一个循环,而非一条直线:`/admin*` 由 [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/) 把关,而 Access 需要一个真实的主机名才能挂载策略——而这个主机名要等 Worker 部署完成、域名指向它之后才会存在。所以 `ACCESS_TEAM_DOMAIN` 和 `ACCESS_AUD` 无法提前填好;它们一开始是占位符,等 Access 建好之后你再回来填入真实值。共四个步骤:

### 1. 部署 Worker

**方式 A:一键部署到 Cloudflare 按钮**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/boomzero/ftle)

这会将仓库克隆到你自己的 GitHub 账号下,创建一个 D1 数据库,并通过几次点击完成 Worker 部署。`deploy` 脚本(`package.json`)会在 `wrangler deploy` 之前执行 `wrangler d1 migrations apply DB --remote`,因此数据库表结构会作为同一次构建的一部分自动应用——无需额外操作。

部署向导的 "Create and deploy" 步骤会与其他 `vars` 一起,提示你填写 `ACCESS_TEAM_DOMAIN` 和 `ACCESS_AUD`。保持它们预填的占位符不变(`https://your-team.cloudflareaccess.com` 和 `replace-with-your-access-application-aud-tag`)——你现在还没有真实值,要等到第 3 步才会有。在完成第 4 步之前,`/admin` 会一直处于无保护状态(如果占位符无法被解析为合法配置,甚至可能直接损坏)。

**方式 B:手动搭建**

1. `npm install`
2. 创建 D1 数据库:`npx wrangler d1 create ftle`——将返回的 `database_id` 复制到 `wrangler.jsonc` 的 `d1_databases[0].database_id` 中。
3. 在本地应用迁移:`npm run migrate:local`
4. 在 `wrangler.jsonc` 的 `vars` 中设置非 Access 相关的 Worker 变量——参见下方的[配置](#配置)。`ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` 暂时保持占位符不变。
5. 生成类型定义:`npx wrangler types`
6. 生成自托管的 KaTeX 资源文件:`npm run prepare:katex`
7. 运行 `npm run dev` 在本地试用,准备好上线时再运行 `npm run deploy`(需要 Wrangler ≥ 4.69.0)。

### 2. 绑定你的域名

在 Cloudflare 控制台中,进入 **Workers & Pages → 你的 Worker → Settings → Domains & Routes → Add → Custom Domain**,填入你想让博客运行在其上的域名。这要求该域名已经是你 Cloudflare 账号下的一个活跃 zone(如果还不是,先通过 **Websites → Add a domain** 添加)。这一步同时也是让 Access 获得一个可挂载策略的真实主机名的关键——这就是为什么它必须在第 3 步之前完成。

### 3. 配置 Cloudflare Access

`/admin*` 并非通过用户名/密码登录来保护——而是由 Cloudflare Access 保护,它位于 Worker 之前,只有在 Cloudflare 自身验证了你的身份之后,请求才会被放行。Worker 还会通过 [`jose`](https://github.com/panva/jose) 在进程内对照 Access 的公钥验证 `Cf-Access-Jwt-Assertion` JWT(`src/auth/access.ts`)作为纵深防御,但真正的关卡是 Access。

1. **创建应用。** 在 Cloudflare 控制台中,进入 **Zero Trust → Access controls → Applications → Add an application → Self-hosted**。这是一个自托管、基于 DNS 路由的应用(而非需要 WARP 客户端的 "Private" 应用)——访客通过普通 HTTPS 访问它。在 **Add public hostname** 中,选择你在第 2 步绑定的域名,并将路径设为 `/admin*`,让策略覆盖整个后台面板。
2. **添加一条仅限你邮箱的 Allow 策略。** 在同一界面中,添加一条策略,**Action** 设为 **Allow**,**Include** 规则类型选 **Emails**,值填入你的邮箱地址。请使用精确匹配的 **Emails** 选择器,而不是 **Emails ending in** 某个域名——后者会让该域名下的任何人都能请求登录验证码。
3. **将 One-Time PIN 保留为登录方式**(默认已开启),除非你已经配置了身份提供方——单作者博客不需要额外的注册服务。
4. **保存应用**,然后找到它的 **AUD 标签**:回到 **Access controls → Applications**,选择你的应用,打开 **Configure**,从 Overview/Additional settings 面板中复制 **Application Audience (AUD) Tag**。
5. **查找你的团队域名**:**Zero Trust → Settings → Custom Pages**(或 **General**)会显示你的 **Team name and domain**,形式为 `https://<your-team>.cloudflareaccess.com`。

至此,两个占位符对应的真实值你都已经拿到了。

### 4. 填入真实值

将第 3 步得到的 AUD 标签和团队域名分别粘贴到 **`wrangler.jsonc`** 中的 `ACCESS_AUD` 和 `ACCESS_TEAM_DOMAIN`,然后将这一改动部署上线:

- **通过按钮部署的?** 你已经有了一个真实的 GitHub 仓库(这正是那个按钮创建出来的)——在本地或直接在 GitHub 的网页编辑器里编辑 `wrangler.jsonc`,并提交到你的生产分支。Workers Builds 会在推送后自动重新部署。
- **手动部署的?** 编辑 `wrangler.jsonc`,然后运行 `npx wrangler deploy`(或 `npm run deploy`)。

不要图省事,直接在 **Settings → Variables and Secrets** 里把这两个值设为明文变量,而不去编辑文件。这看起来是有效的——改动会立即生效——但 Wrangler 每次部署时都会把 Worker 的变量重置为 `wrangler.jsonc` 中的内容。由于文件里仍然是占位符,*下一次*部署(未来的 ftle 更新、依赖升级,或任何触发 Workers Builds 或手动 `wrangler deploy` 的操作)就会悄无声息地把 `ACCESS_AUD`/`ACCESS_TEAM_DOMAIN` 还原,再次破坏 `/admin`,且原因难以察觉。请把 `wrangler.jsonc` 作为这两个值的唯一真实来源,而不是控制台。

现在访问 `/admin` 应该会先跳转到 Cloudflare 托管的登录页面,请求才会到达 Worker。

不需要其他任何密钥——Worker 无需管理客户端密钥、API 令牌或会话 Cookie。

## 配置

所有配置都存放在 `wrangler.jsonc` 的 `vars` 块中——无需密钥,无需 `.env` 文件。

| 变量 | 用途 |
|---|---|
| `SITE_URL` | 规范的站点源地址,例如 `https://example.com`——用于构建绝对 URL、RSS 和站点地图条目 |
| `SITE_TITLE` | 站点名称,显示在导航栏和页面标题中 |
| `SITE_DESCRIPTION` | 默认的元描述(meta description) |
| `SITE_AUTHOR` | 作者名称,用于订阅源/JSON-LD 元数据 |
| `SITE_NAV_LINKS` | 可选的额外导航链接,以 `标签\|URL` 的形式用逗号分隔,例如 `Twig\|https://twig.example.com,Sinv\|https://sinv.example.com`。留空则没有额外链接。 |
| `IMAGE_UPLOAD_URL` | 编辑器上传图片所使用的图床服务基础 URL——参见[图片上传](#图片上传)。默认值为 `https://image.langningchen.com`。 |
| `ACCESS_TEAM_DOMAIN` | 你的 Cloudflare Access 团队域名——见上文 |
| `ACCESS_AUD` | 你的 Access 应用的 AUD 标签——见上文 |

## 图片上传

后台编辑器支持直接从浏览器上传图片——可以通过 "Insert image" 按钮,也可以直接将截图粘贴到源码文本框中。ftle 没有内置的对象存储(没有 R2,也没有 KV),因此上传会直接从浏览器发送到由 `IMAGE_UPLOAD_URL` 配置的外部图床服务。

默认值 `https://image.langningchen.com` 是 [langningchen/Image](https://github.com/langningchen/Image)(GPL-3.0)的一个托管实例——这是一个小型 Cloudflare Worker,将上传的图片存储在一个私有 GitHub 仓库中,并通过 HTTP 提供访问。ftle 仅将其作为托管的 HTTP API 使用(该项目的代码并未被内嵌到本仓库中);非常感谢其作者允许 ftle 的编辑器使用该服务,后台界面上传按钮旁也标注了致谢。

上传的图片会一直保留在该外部主机上——删除文章,或从文章源码中移除图片引用,都不会从主机上删除该图片。如果你不想依赖别人的实例,可以将 `IMAGE_UPLOAD_URL` 指向你自己部署的 [langningchen/Image](https://github.com/langningchen/Image)(或任何暴露相同 `POST /upload` / `GET /:id` API 的兼容主机)。

## 架构

一个 Cloudflare Worker,一个 D1(SQLite)数据库。没有 KV,没有 R2,没有队列,内容也无需构建步骤。

文章在**写入时**渲染,而非读取时:保存文章时会在服务端一次性运行 Markdown 渲染([`marked`](https://github.com/markedjs/marked),原始 HTML 直通)和 KaTeX 渲染,并将原始的 `source` 与预渲染好的 HTML 一并存入 D1。读取路径因此非常简单:边缘缓存命中 → 直接返回;未命中 → 一次带索引的 D1 查询 → 套入布局模板 → 返回并写入缓存。任何内容都不会在读者的请求中即时渲染。

单一可信作者本身就是内容的安全模型:HTML 有意*不做*净化处理(只有你能保存文章,而这一操作由 Cloudflare Access 把关),这正是原始 HTML 和数学公式无需客户端净化器或额外请求即可原样通过的原因。

## 性能预算

由回归测试(`tests/perf/page-weight.test.ts`)强制执行,而不仅仅是一份指导原则:

| 指标 | 预算 |
|---|---|
| 面向读者页面的 JavaScript | 0 字节 |
| 阻塞型外部请求 | 0——CSS 已内联到 HTML 中 |
| 典型文章页面,压缩后 | ≤ 14KB |

后台页面不受此限制——编辑器可以使用少量 JS。

<img src="docs/images/lighthouse-performance-100.png" alt="Lighthouse 性能得分 100 分,首次内容绘制(First Contentful Paint)0.2 秒,最大内容绘制(Largest Contentful Paint)0.4 秒,总阻塞时间(Total Blocking Time)0 毫秒,累积布局偏移(Cumulative Layout Shift)0,速度指数(Speed Index)0.7 秒" width="700">

*一次线上部署的文章页面 Lighthouse 审计结果,采集于 2026-07-12。你自己的数值会随内容和网络状况而变化——[运行你自己的审计](https://pagespeed.web.dev)来查看。*

## 命令

```sh
npm test               # 完整测试套件(vitest + @cloudflare/vitest-pool-workers)
npm run dev             # 使用本地 D1 运行 wrangler dev
npm run typecheck       # tsc --noEmit
npm run migrate:local   # 将 D1 迁移应用到本地开发数据库
npm run migrate:remote  # 将 D1 迁移应用到已部署的数据库
npm run deploy           # 应用待处理的远程迁移,然后执行 wrangler deploy
```

## 重新部署

完成一次[快速开始](#快速开始)之后,后续部署只需运行 `npm run deploy`——它会应用任何待处理的远程 D1 迁移,然后部署 Worker(需要 Wrangler ≥ 4.69.0)。无需任何缓存清除密钥——本项目使用 Cloudflare 原生的 Workers Caching(`wrangler.jsonc` 中的 `"cache": { "enabled": true }`),并通过基于缓存标签的失效机制,在保存/删除/重新渲染时于进程内调用 `ctx.cache.purge()`。

## 已知局限

v1 明确不包含以下功能:评论、搜索、多作者支持。KaTeX 资源已实现自托管,但尚未进行字形子集化(仅在包含数学公式的页面上加载,因此不影响不含公式页面的 14KB 预算)。

## 许可证

[MIT](LICENSE)
