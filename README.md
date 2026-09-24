
# dsh-canvas

跑在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 上的**通用创作画布插件**：把一个项目铺成一张无限画布，通过创建不同的卡片类型，来配合完成大型复杂的任务，比如产品设计、应用开发等。同时，通过连线**引用**，基于已有的卡片，进行多方向的探索创作，比如基于同一份产品文档，生成多种风格的设计稿，更好保留你的探索过程。

![功能速览](docs/Dsh_Canvas_Tutorial.mp4)

---

## 安装插件

### 环境要求

| 项 | 要求 |
|----|------|
| Node | `^22.19 \|\| >=24` |
| 包管理器 | pnpm `>=9`（本仓库锁定 `pnpm@10.17.0`） |
| Harness | `dsh >= 0.1.0-rc.6` |

### 从源码安装

```sh
# 1. 拉取源码并构建（prepare 脚本会自动跑 build）
git clone https://github.com/ljcoder2015/dsh-canvas.git
cd dsh-canvas && pnpm install && pnpm run build

# 2. 从本地目录安装进 web profile
dsh plugin --profile web add .
```

也可以直接从 Git 安装：

```sh
dsh plugin --profile web add https://github.com/ljcoder2015/dsh-canvas
```

> 包的安装名是 scoped 的 **`@ljcoder2015/dsh-canvas`**：裸名 `dsh-canvas` 在 npm 上已被他人占位（2026-08-19 发布的 0.0.1 占位包），所以本仓库走 scope，`dsh plugin --profile web add dsh-canvas` 装到的是别人的包。**目前尚未发布到 npm**，请用上面的本地路径或 Git 地址安装；发布后 `dsh plugin --profile web add @ljcoder2015/dsh-canvas` 即可。

> pnpm ≥10 会拦截安装期的 `prepare` 构建。按 `dsh` 的提示在该 profile 的 `pnpm-workspace.yaml` 里加 `allowBuilds: { '@ljcoder2015/dsh-canvas': true }` —— **该授权允许包在安装时执行代码，只对可信来源开放并锁定 commit**。

### 启动

```sh
dsh web --no-open                                     # 终端首行打印访问地址与 token（token 每次重启都会变）
dsh plugin --profile web remove @ljcoder2015/dsh-canvas # 卸载
```

---

## 路线图

### 已实现

| 能力 | 现状 |
|------|------|
| **文本** | Markdown 与纯文本文档：全屏预览渲染、原地编辑、停手自动落盘、未保存拦关闭；数据图表（CSV / JSON）按表格呈现 |
| **设计** | `.design` 矢量设计文档——多画板场景图（基于 OpenPencil 底座），画布内直接渲染，Agent 可读结构、可按 `ops` 精确改图层 |
| **应用** | 新建应用即建一个文件夹并写入 web 应用脚手架（清单 + 入口 + shadcn 设计令牌 + Web Components），沙箱 iframe 全屏真跑、可点选元素让会话改代码；HTML Deck 与站点同属这一族 |

### 后续

| 能力 | 计划 |
|------|------|
| **图片** | 图片产物接入生成与编辑闭环，与文本、设计共用同一套卡片与引用关系 |
| **视频** | 视频产物的生成与预览 |
| **音频** | 音频产物的生成与预览 |

---

## 许可

[MIT](LICENSE) © 2026 ljcoder2015
