# 图片挑战 · hb-image-challenge

一个可复用的图片挑战判定器和作者自建服务。玩家上传图片，AI 判断它与挑战描述的匹配度；分数落在作者设定的区间，再由红包站判定器核验和发奖。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/LeUKi/hb-image-challenge)

[使用图片挑战发红包](https://hb.lafi.sh/new?judge=0f06222c-e8b2-4683-89d9-ae8900e66cea) · [判定器代码](judge/judge.js) · [配套测试](judge/tests.json)

先部署自己的 Cloudflare 服务，应用参数只需填写 `OWNER_ID`（你的 LINUX DO 数字用户 ID）。部署后点击“使用图片挑战发红包”，填入服务根地址和挑战规则即可，无需自行发布判定器。

## 部署到自己的 Cloudflare

1. 点击上面的按钮，登录 Cloudflare 并连接自己的 GitHub。模板会声明 AI、R2 和 D1 绑定，由官方部署流程创建、绑定资源。首次使用 R2 时可能需要先完成 Cloudflare 的账户开通流程。
2. 只需填写一个应用参数：`OWNER_ID`，值为自己的 **LINUX DO 数字用户 ID**。服务默认连接 `https://hb.lafi.sh`，空 ID 的服务拒绝上传。
3. 如果 Cloudflare 默认勾选了 **启用预览构建（Enable Preview Builds）**，请取消；**使用 Cloudflare Access 保护**无需启用。高级设置里的构建和部署命令保持默认，然后开始部署。
4. 点击[使用图片挑战发红包](https://hb.lafi.sh/new?judge=0f06222c-e8b2-4683-89d9-ae8900e66cea)，已选好图片挑战判定器。在“服务地址”中填入部署得到的根地址，例如 `https://你的服务.workers.dev/`，再设置挑战描述、最低/最高匹配度、每人次数（1–10，默认 3）、是否保存图片和成功奖励。

模板只声明 `OWNER_ID` 这一个普通应用变量，不要求填写 AI Token、R2 密钥或站点地址。AI、R2、D1 由部署流程创建并绑定；部署命令会构建 SSR、发布 Worker 并执行数据库迁移。`database_id` 的全零值是模板占位，官方部署流程会替换为实际资源 ID。

模板显式设置了 `preview_urls: false`，关闭版本预览地址。但 Cloudflare 的“启用预览构建”是平台的分支构建开关，当前没有公开的 Deploy Button 模板设置可将它默认取消；上面的第 3 步仍需在 Cloudflare 表单中完成。二者不能互相替代。官方说明：[部署按钮](https://developers.cloudflare.com/workers/platform/deploy-buttons/)、[预览构建开关](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/#configure-preview-builds)。

正式的 `workers.dev` 地址已通过 `workers_dev: true` 显式开启，构建后的部署配置也保留此值，正常完成部署后无需逐个手动启用。Cloudflare 的 **Settings → Domains & Routes** 中，版本预览地址关闭是预期行为；若正式 `workers.dev` 一行仍显示禁用，请检查这次部署是否成功、采用的提交和配置是否正确。首次使用 Workers 的账户可能还需按提示注册账户级 `workers.dev` 子域名。详见 [workers.dev 官方说明](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)。

本地配置示例放在 `docs/local-worker-config.example`。仅开发联调需要时，可在本地 `.dev.vars` 用 `HB_SITE` 指向官方模拟器；它不在默认部署表单中展示。不要为普通变量添加根目录 `.dev.vars.example` 或 `.env.example` 声明，否则 Deploy to Cloudflare 会将同名变量再次识别为 secrets。

通过 CLI 部署时，需要先创建资源并填写数据库 ID：

```sh
npx wrangler login
npx wrangler r2 bucket create hb-image-challenge-images
npx wrangler d1 create hb-image-challenge
# 将命令返回的真实 database_id 填入 wrangler.jsonc，并设置 OWNER_ID。
npm run deploy
```

上面的发红包链接使用已发布的公共判定器。需要自行修改和发布判定器时，使用 [judge/judge.js](judge/judge.js) 和 [judge/tests.json](judge/tests.json)；更新 Cloudflare 服务不会自动更新红包站保存的判定器代码。这个仓库的代码准备和本地验证，不代表生产 AI、R2、红包领取或官方部署按钮已经端到端实测。

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

实现与验证记录见 [docs/VALIDATION.md](docs/VALIDATION.md)。本地已通过 25 项后端测试、22 项官方判定器测试、SSR 构建和 1440/390/320px 浏览器检查；官方模拟器的 SDK 与三种布局截图也已通过。

实际 Cloudflare 模型精度、免费档 CPU、Cloudflare 首次资源开通、红包站生产 JWT/领取和一键部署流程，需要在真实账号上单独验证。当前官方模拟器不提供服务端读取规则所需的公开活动接口，因此模拟器截图不等于图片上传、真实 AI 和发奖的完整联调；后端不会为模拟器放宽可信规则校验。

官方参考：[TanStack Start on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)、[Deploy buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)、[Clef Omni](https://developers.cloudflare.com/workers-ai/models/clef-omni/)、[红包站开发文档](https://hb.lafi.sh/help/code)。
