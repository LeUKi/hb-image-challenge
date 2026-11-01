# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-11-01
- Primary product surfaces: 玩家图片挑战 `/`；红包作者部署说明 `/setup`。
- Evidence reviewed: 本线程约定；官方红包站 09477c5 的作者自建服务文档。新仓库没有旧界面或既有素材。

## Brand
- 名称：见图。简约、平静、直接；清晰展示一张图片、一项挑战、一次真实评分。
- Trust signals: 身份来源明确；图片区分是否保存；AI 结果与红包最终判定区分。
- Avoid: 渐变大标题、霓虹、玻璃效果、虚假实时数据、假进度、假评分、与玩法无关的技术标签。

## Product goals
- Goals: 让玩家选择图片、评分、提交结果；让红包作者把整套服务部署到自己的账户。
- Non-goals: 通用图片托管、模型切换、共享代理、无限次数、浏览器直接发奖。
- Success signals: SSR 首屏有完整内容；上传状态清晰；手机和桌面无横向溢出；失败时不显示可兑奖结果。

## Personas and jobs
- 玩家：从红包页进入，理解规则，上传并判断是否值得提交。
- 红包作者：部署自己的 Worker/AI/R2/D1，配置一次，复用到多个红包。
- 判定器作者：维护公共模板和判定器，不接触作者的 Cloudflare 密钥。

## Information architecture
- Primary navigation: 首页品牌链接、部署服务链接。
- Core routes: `/` 图片挑战；`/setup` 自建说明；`/api/*` 鉴权服务。
- Hierarchy: 挑战简介 → 图片选择与操作 → 真实结果；桌面右栏承载挑战规则和玩法引导。

## Design principles
- 单次只聚焦一张图片、一项主要操作。
- 默认约定完整，红包参数只暴露影响玩法的选项。
- 前端只展示和提交结果编号，额度和发奖由可信服务决定。

## Visual language
- Color: 页面 #f7f8fa；白卡片；文字 #20262e；强调 #3e61dd；边框 #e5e8ee。
- Typography: 系统中文无衬线；正文 12–14px；标题 30–38px；分数用等宽数字。
- Spacing: 4px 基础节奏；卡片内边距 20–28px；桌面容器最大 1120px。
- Shape: 主要卡片 20–24px；按钮 11–12px；轻微阴影，不叠加装饰层。
- Motion: Motion；结果淡入和 6px 位移；150–220ms；遵循 reduced motion。
- Icons: Lucide，同一描边风格；不引入装饰图片资源。

## Components
- Layout 管理页眉/页脚；首页管理上传、预览、状态、结果和引导。
- Tailwind theme 与 styles.css 是设计 token 来源。
- Variants: 主操作、次操作；信息、失败、成功提示；连接/未连接状态。

## Accessibility
- 目标 WCAG AA；语义化标题/表单；可见焦点；原生键盘文件选择。
- aria-live 宣告状态；错误使用 alert；拖放有可点击替代。
- 图标不代替按钮文字；图片预览有 alt；颜色之外提供状态文字。

## Responsive behavior
- 320px 起可用；768px 以下单列；桌面为主视图 + 300px 规则侧栏。
- 移动端按钮可占满一行；文件名可截断；长地址可换行。
- 不依赖 hover 完成任何操作。

## Interaction states
- Loading: 验证身份、保存与评分、提交结果分别给出真实状态；不伪造百分比。
- Empty: 选择/拖放图片和示例规则；独立打开不做虚假身份或打分。
- Error: 保留本次图片与幂等键，明确错误；不自动重复 AI 或钱款提交。
- Success: 显示真实分数、剩余次数、保存状态；需要玩家点击提交。
- Disabled: 无文件、未接红包、未配置作者、次数耗尽、红包未开放、处理中。
- Offline: 显示连接问题；未确认的红包提交只引导查看记录。

## Content voice
- 简体中文，短句；使用“上传并评分”“提交这次结果”“怎么玩”。
- 玩家页不显示部署细节；作者页解释资源、费用归属和配置。
- AI 给出的匹配度不描述成准确率或像素面积占比。

## Implementation constraints
- TanStack Start SSR、Router、Query、Form；Tailwind CSS；Motion；Jotai。
- Cloudflare 官方 Vite adapter；不使用 Nitro；Query/Jotai 状态按请求隔离。
- 文件最多 4 MiB / 1600 万像素；后台复核 MIME、像素、JWT、规则和原子限额。
- 需验证 lint/typecheck/测试/build、SSR HTML 与实际 CSS 资源、桌面与手机布局。

## Open questions
- [ ] 真实 Cloudflare 账号的首次 R2 开通/部署按钮表单流程需首次部署验证。
- [ ] 真实模型分数分布与免费 CPU 使用需部署后测量，不用假数据声称已完成。
