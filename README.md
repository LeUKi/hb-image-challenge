# 图片挑战 · hb-image-challenge

一个可复用的图片挑战判定器和作者自建服务。玩家上传图片，AI 判断它与挑战描述的匹配度；分数落在作者设定的区间，再由红包站判定器核验和发奖。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/LeUKi/hb-image-challenge)

## 技术栈

- **TanStack Start + Router**：React 服务端渲染、文件路由，Cloudflare Workers 官方 Vite adapter。
- **TanStack Query**：服务端数据缓存与上传 mutation；**TanStack Form**：类型安全表单。
- **Tailwind CSS 4**：简约响应式界面；**Motion**：遵循减少动画偏好；**Jotai**：交互状态，每次 SSR 请求隔离。
- **Workers AI**：固定 `@cf/cloudflare/clef-omni` 模型，使用 AI binding。
- **R2**：私有图片存储，所有部署均包含；红包作者可按红包关闭实际图片保存。
- **D1**：结果、一次性 nonce、幂等键和原子次数限制。

不需要作者把 Cloudflare AI Token 或 R2 密钥交给判定器作者。每位红包作者把整套服务部署到自己的 Cloudflare 账户；自己的用量、图片和数据库由自己管理。

## 本地运行

需要 Node.js **22.12+**。

```sh
npm ci
cp docs/local-worker-config.example .dev.vars
# 将 .dev.vars 里的 OWNER_ID 填为自己的 LINUX DO 数字 ID。
npm run db:local
npm run dev
```

访问 `http://127.0.0.1:5173/`。独立打开时显示玩法预览，可选择本地图片；真正上传需要红包站的签名身份，不提供假的分数或身份绕过。`/setup` 提供作者部署说明。

```sh
npm run check
```

检查包括 ESLint、TypeScript、服务端边界测试和实际 Worker SSR 构建。测试中的 AI 是接口替身，不产生真实模型调用。

## 部署到自己的 Cloudflare

1. 点击上面的按钮，登录 Cloudflare 并连接自己的 GitHub。模板会声明 AI、R2 和 D1 绑定，由官方部署流程创建、绑定资源。首次使用 R2 时可能需要先完成 Cloudflare 的账户开通流程。
2. 在部署配置或 Worker 的 **Settings → Variables and Secrets** 设置 `OWNER_ID` 为自己的 **LINUX DO 数字用户 ID**，保持 `HB_SITE=https://hb.lafi.sh`。空 ID 的服务拒绝上传。
3. 部署命令会构建 SSR 应用、发布 Worker，再执行 D1 migrations。`database_id` 的全零值是模板占位；官方部署流程会用实际资源 ID 替换。自己用 CLI 部署时，请先创建数据库并替换为实际 ID。
4. 在红包站使用 `judge/judge.js` 和对应的测试文件，填入部署得到的服务地址。设置挑战描述、最低/最高匹配度、每人次数（1–10，默认 3）和是否保存图片。

`OWNER_ID` 和 `HB_SITE` 都是普通运行变量，统一在 `wrangler.jsonc.vars` 声明。不要把它们再放入根目录的 `.dev.vars.example` 或 `.env.example`：Deploy to Cloudflare 会把这两类文件里的键识别为 secrets，导致部署表单重复出现一组遮罩输入。本地配置示例放在 `docs/local-worker-config.example`，不会作为部署 secrets 读取。

CLI 首次部署：

```sh
npx wrangler login
npx wrangler r2 bucket create hb-image-challenge-images
npx wrangler d1 create hb-image-challenge
# 将命令返回的真实 database_id 填入 wrangler.jsonc，并设置 OWNER_ID。
npm run deploy
```

部署网页与发布红包站判定器是两个操作。这个仓库的代码准备和本地验证，不代表生产 AI、R2、红包领取或官方部署按钮已经端到端实测。

## 数据流与边界

1. 附带网页通过 `hb.identity({ nonce })` 获取签名 JWT。
2. 浏览器把原始图片传到同源 Worker，Worker 验证 JWT、公钥、issuer、audience、到期时间、作者、红包、玩家和一次性 nonce。
3. Worker 从红包站公开接口获取真实挑战规则。客户端不能提高作者的尝试上限或替换挑战描述。
4. D1 原子预占尝试次数，按“红包 + 玩家”最多 10 次。同一幂等键绑定图片哈希，重试不重复调用 AI。
5. R2 保存与 AI 推理并行进行，只有所需步骤都成功、真实结果持久化后才返回结果编号。
6. 网页把短结果编号交给 `hb.submit()`；判定器用 `X-Hb-Token` 请求 Worker 核验，核对玩家、红包和挑战参数后决定奖励。

已接受并开始处理的失败请求会保守计入一次尝试，因为 AI 调用可能已产生用量。查询已保存结果、幂等重放不会新增推理。`unconfirmed` 的红包提交不自动重试。

图片支持 JPEG、PNG、WebP，最多 **4 MiB、1600 万像素**。服务端验证实际文件头和尺寸；模型接收嵌入图片，不读取图片外链。R2 默认不公开，读取图片同样校验玩家身份。

## 当前范围

实现与验证记录见 [docs/VALIDATION.md](docs/VALIDATION.md)。本地已通过 18 项后端测试、22 项官方判定器测试、SSR 构建和 1440/390/320px 浏览器检查；官方模拟器的 SDK 与三种布局截图也已通过。

实际 Cloudflare 模型精度、免费档 CPU、Cloudflare 首次资源开通、红包站生产 JWT/领取和一键部署流程，需要在真实账号上单独验证。当前官方模拟器不提供服务端读取规则所需的公开活动接口，因此模拟器截图不等于图片上传、真实 AI 和发奖的完整联调；后端不会为模拟器放宽可信规则校验。

官方参考：[TanStack Start on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)、[Deploy buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)、[Clef Omni](https://developers.cloudflare.com/workers-ai/models/clef-omni/)、[红包站开发文档](https://hb.lafi.sh/help/code)。
