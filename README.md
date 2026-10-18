# dsh-boot-custom

DSH **鲸鱼娘星云启动动画**：星云背景 + **Canvas 逐帧动画的 DeepSeek 品牌**（左侧）+ **拟人鲸鱼娘**（右侧）+ 启动进度可见 + 点击/Esc 放行 + **失败有兜底**，片尾鲸鱼娘说「欢迎回来」。与 `dsh-boot-animation` 并存，各自独立开关，**不改 DSH 本体源码**。

## 界面组成

| 元素 | 来源 | 说明 |
|---|---|---|
| 星云背景 | 内置 CSS/SVG | 多层径向渐变呼吸 + 8 颗漂移粒子 + 旋转星图网格 |
| **DeepSeek 品牌（左）** | **Canvas 逐帧绘制** | "DeepSeek" 渐变大字 + 一道光横扫；官方鲸鱼 logo 用流动虚线光逐段描边（`Path2D` + `setLineDash`） |
| **鲸鱼娘（右）** | **Canvas 逐帧绘制** | **拟人少女形象**（参考蓝发女仆装鲸鱼娘）：蓝色长发 + 呆毛 + 侧辫 + **鲸鳍耳** + 大蓝眼 + 深蓝裙白围裙 + 挥手。程序化动画：从右侧游入 → 呼吸浮动 → 眨眼（每 4.2s）→ 挥手 → 张嘴说话；**无任何素材文件、无气泡** |
| 「欢迎回来」 | Canvas 绘制 + **真人声** | 动画结束前 2.5s 弹出对话气泡（带小尾巴），随退场一起溶解；同一时刻用**真人声**轻声说出「欢迎回来」——这句从 `dsh-boot-animation` 的 `1.mp4` 音轨里提取（ASR 复核），与短片同源同音色。素材被浏览器自动播放策略挡住时保持安静（与短片"点击才出声"一致），素材缺失时才回退系统语音 |
| **片尾品牌字卡（视频主题）** | **全屏暗晕 + Canvas** | 视频进入最后 3.8s 时淡入：一块以水印区为中心的**不透明暗角** + 金属质感 "DeepSeek / HARNESS" 字卡 + 流动描边的鲸鱼 logo。**用来盖住素材自带的烧录水印**（详见「去水印」） |
| 底部 UI | 内置 | 标题 + 真实进度条 + 提示行 |

> 两侧都是 `requestAnimationFrame` 驱动的逐帧绘制，**不是 CSS 关键帧，也不引用任何插件立绘**。视频主题下素材一揭示首帧，品牌/鲸鱼娘 Canvas 即淡出（素材自带画面），仅片尾字卡会再出现。

## 机制（为什么能抢在内核前面）

DSH 内核的启动页由 shell 模块脚本同步构建。本插件在 Host 侧订阅内核官方的 `webserver/index-inject` 事件，往 `<head>` 注入**两行解析阻塞脚本**（一行配置全局、一行屏幕脚本），因此覆盖层在**内核 boot 页出现之前**就占住视口——与已装好的 `dsh-boot-animation` 是同一套经过验证的机制，只是入口 id / 路由 / 命名空间全部独立（`boot-custom`），两插件互不干扰。

三半结构：

| 半侧 | 文件 | 职责 |
|---|---|---|
| Host | `entry.js` | 素材/清单/优化路由 + `webserver/index-inject` 注入 + `Config`（schemastery，全 volatile） |
| 屏幕 | `src/boot-screen.js` | 纯脚本（非模块），星云动画 / 可选视频，观察内核 `--dsh-boot-arc` 进度，交接与兜底 |
| 客户端 | `src/client.js` → `lib/client.js` | ①`clientReady()` 无条件最先调用 ②设置卡片（`plugins.item` 槽） |

## 设置在哪里

**设置 → 插件 → 插件配置** → 「星云启动动画」：

| 项 | 作用 |
|---|---|
| 开启启动动画 | 总开关。关=完全不注入（0 行），回到原生 boot 页 |
| 动画主题 | **星云（内置）**：纯 CSS/SVG，零素材；**视频素材池**：随机播 mp4，池空自动回退星云 |
| 淡入时长 | 1 / 1.5 / 2 / 3 / 4 秒 |
| 进入方式 | 片尾交叉溶解（默认）/ 放完再淡 / 点击才进 |
| 播放影片声音 | 仅视频主题有意义；关=彻底静音 |
| 片尾语音「欢迎回来」 | 开=结束时**真人声**说一句「欢迎回来」（与短片同源音色，跟随上面的声音开关）；关=只出气泡文字 |
| 点鼠标直接进入 | 第一下点击就进，不再先开声音 |
| 显示底部提示 | 只隐藏提示行 |
| 素材池 | 勾选参与随机；逐条真实播放探时长；`未优化` 徽章 + 无损 `优化` 按钮 |

改设置**刷新页面生效**（改了 `src/boot-screen.js` 也只需刷新——Host 每次渲染 index 都重读它；改了 `entry.js` 需重启 DSH，改了 `src/client.js` 需重跑 `build-client.mjs`）。

## 安装（已完成：路线二正式接线）

本插件已按**路线二（正式依赖）**接好：

1. `dsh-home/profiles/desktop/package.json` → 依赖 `"dsh-boot-custom": "link:E:/DeepSeek/dsh-plugins/dsh-boot-custom"` + `bundles` 追加 `dsh-boot-custom`
2. `dsh-home/profiles/desktop/node_modules/dsh-boot-custom` → 指向插件目录的 junction
3. 插件目录内 `node_modules/@deepseek-ai/schemastery`（→ profile 的 3.18.5）+ `cosmokit` + `@standard-schema/spec` 链接（ESM 从真实路径解析所必需）
4. `pnpm install --lockfile-only` 已同步 lockfile
5. 安装前备份在 `E:\DeepSeek\downloads\rollback-boot-custom-<时间戳>\`（含 package.json / cordis.patch.yml / pnpm-lock.yaml / pnpm-workspace.yaml）

**重启 DSH 后生效。** 验证：重启后打开 DSH，看到星云开屏 + 标题 + 进度条 + 「播完自动进入 · 点一下提前进」即成功；若仍看到原生 boot 页，说明客户端模块图需要重启补齐（这是预期，重启一次即可）。

## 放视频（可选）

把 mp4 / webm 丢进 `assets/videos/`，在设置里把主题切成「视频素材池」，刷新页面即生效（Host 每次请求清单实时扫目录）。素材规范（沿用验证过的约束）：

| 项 | 建议 |
|---|---|
| **编码** | **必须 H.264（`libx264`）**。Chromium/Electron 不带 HEVC(H.265) 软解，Windows 的 HEVC 扩展只在部分机器上可用——**HEVC 素材在这里会黑屏不播**。手机/AI 站导出的 mp4 常是 HEVC，先转：`ffmpeg -i in.mp4 -c:v libx264 -crf 19 -pix_fmt yuv420p -c:a aac -movflags +faststart out.mp4` |
| 画幅 | 16:9（1280×720 即可） |
| 时长 | 8–15s（片长就是进入前的等待时间） |
| 容器 | `moov` 必须在文件最前（否则整段下完才出画面；卡片里有「优化」按钮可无损前移） |
| 轨道 | 带 AAC 音轨 |
| 构图 | 主体别顶满、四边留深色（蒙版会渐隐边缘） |
| 文字 | 不要出现文字/水印（自带的也没关系，见下） |

## 去水印（参考素材 `dsh-boot-whale.mp4`）

参考开屏视频（抖音/AI 站导出）带**两种水印**，都已处理：

1. **元数据水印**：容器 tags 里的 `comment: vid:v0269cg…`（抖音视频 id）与 `AIGC` 出品标签。入池时已用 `ffmpeg -map_metadata -1` 清除（无损，不重编码画面）。
2. **烧录水印**：片尾约 **6.8s 起淡入**的 AI 字卡「DeepSeek / *Professional Mast*」（注意是 AI 拼错的假品牌字），占据画面左侧 x≈11–63%、y≈35–63%。像素级修补（delogo）在该区域（网格光点+光弧+发丝背景）会留下明显条纹伪影，故改用**品牌字卡覆盖**：屏幕脚本在片尾 3.8s 淡入一层以水印区为中心的全屏暗角（`rgba(3,8,18,1)`，水印文字亮度实测从 249/255 压到 9/255）+ 我们自己的金属 "DeepSeek / HARNESS" 字卡 + 流动描边鲸鱼 logo——把"别人的假字卡"换成"我们自己的真字卡"，片尾观感是**有意的品牌收尾**而非修补痕迹。

> 覆盖层几何与不透明度由 `tools/verify-geometry.mjs` 断言：水印 bbox 四角处暗角不透明度 ≥ 0.95；时序由 `verify-timing.mjs` 断言：仅在片段最后 `CARD_LEAD_MS`（3.8s）内出现。换别的带片尾水印的素材时，若水印位置不同需同步调整 `.dshbc-card` 渐变中心与 `WM` 断言框。

## 素材池现状

`assets/videos/dsh-boot-whale.mp4` = 参考视频去元数据水印 + 转 H.264/AAC/faststart 后的成品（10.1s、1280×720、4.3MB）。默认主题即「视频素材池」；池空时自动回退星云。

## 交接与兜底（每条都验证过）

| 卡在哪 | 谁来放开 |
|---|---|
| 星云动画放完（`NEBULA_MS`=8s 计时） | 就绪即进（tail/end 模式） |
| 视频片段放完但内核未就绪 | 停最后一帧等 `clientReady` |
| 素材清单挂住 | 10 秒后按无素材处理，就绪即进 |
| 素材池空（视频主题） | 自动回退星云动画 |
| 某片段 6 秒无画面 | 换下一段；全失败就绪即进 |
| 片段时长未知 | 20 秒兜底 |
| 内核启动失败 | 琥珀色「启动失败，点击查看」 |
| 内核一直不就绪 | 15 秒「启动较慢，点击继续」 |
| 以上全部失效 | Esc / 空格 / 回车 随时直接进 |

## 自检（离线、零系统改动）

```bash
node tools/verify-all.mjs               # 静态 + 时序 + 路由，全部离线
node tools/verify-install-rehearsal.mjs # 安装预演：依赖/bundles/链接/patch/导入/产物
```

覆盖：注入行在 shell 前、两半命名空间一致、Config volatile 与默认值、客户端产物契约、`ctx.get` 禁用手卫生、属性值引号、星云/视频/click 三种时序兜底、路由（manifest/404/穿越/405/400/Range 解析）。

## 目录

```
dsh-boot-custom/
├── package.json          # 声明 schemastery^3.18.4；dsh.client.platform=web；bundle.patch
├── cordis.patch.yml      # - insert: id: boot-custom（命名空间契约）
├── entry.js              # Host 半侧
├── build-client.mjs      # src/client.js → lib/client.js
├── src/
│   ├── boot-screen.js    # 屏幕脚本（星云 + 视频 + 交接/兜底）
│   ├── client.js         # 客户端半侧源码
│   └── remux.js          # 无损 moov 前移（优化按钮）
├── lib/client.js         # 构建产物
├── locale/               # zh / en
├── assets/videos/        # 可选素材池（子目录不入池）
└── tools/verify-*.mjs    # 离线自检
```

## 回滚

把 `E:\DeepSeek\downloads\rollback-boot-custom-<时间戳>\` 里的 `package.json.bak` / `cordis.patch.yml.bak` / `pnpm-lock.yaml.bak` 覆盖回 profile，删除 `node_modules/dsh-boot-custom` junction，重启 DSH。
