# Miao-MBT-MLY-Plugin

Yunzai（TRSS-Yunzai）插件：为 `miao-plugin` 提供 **MBT 仓库面板图** 的取图、分级管理与 Web 管理端。

- 三个游戏用符号前缀取图：`#` 原神 / `*` 崩铁 / `%` 绝区零
- **R / R17 / R18** 分级，R18 可按「无人 / 主人 / 所有人」控制可见范围
- 内置 **Web 管理端（端口 11001）**：图库预览、分级开关、从 Gamewiki 同步图片
- 可**接管 miao 面板默认立绘**，优先使用 MBT 仓库图

---

## 快速开始

在 **Yunzai 根目录**执行这一行命令，即可直接下载到插件目录：

```bash
git clone https://github.com/Miuchenlanyu/Miao-MBT-MLY-Plugin.git ./plugins/Miao-MBT-MLY-Plugin
```

然后**重启 Yunzai** 即可生效。

> 已存在该目录时，用更新：
> ```bash
> cd plugins/Miao-MBT-MLY-Plugin && git pull
> ```

### 手动安装

下载仓库 ZIP，解压后放到：

```
Yunzai/plugins/Miao-MBT-MLY-Plugin/
```

目录里应包含 `index.js`、`apps/`、`resources/`，然后重启 Yunzai。

---

## 指令

| 命令 | 说明 |
|---|---|
| `#MLY <角色> [序号\|all]` | **原神**：取该角色面板图 |
| `*MLY <角色> [序号\|all]` | **崩铁**：取该角色面板图 |
| `%MLY <角色> [序号\|all]` | **绝区零**：取该角色面板图 |
| `#MLY面板帮助` / `#MLY面板图帮助` | 显示帮助图 |
| `#MLY面板设置` / `#MLY面板图设置` | 显示当前分级开关与权限 |
| `#Web登录` / `#Web登入` | 开启 Web 管理端（**仅主人**） |

- 不带序号 = 第 1 张；`2` = 第 2 张；`all` = 全部发送
- 例：`#MLY 刻晴`、`*MLY 黄泉 all`、`%MLY 艾莲 2`

> R / R17 / R18 开关、R18 可见人群、是否接管 miao 立绘 —— 这些配置**一律在 Web 管理端修改**，不再提供聊天指令。

---

## Web 管理端（11001）

发送 `#Web登录` 开启，浏览器打开 `http://localhost:11001`
（局域网其他设备改用本机 IP）。

### 图库预览
- 顶部按游戏切换：原神 / 崩坏：星穹铁道 / 绝区零
- 搜索角色名、按元素分组、按星级子分组展示
- **R / R17 / R18 勾选**（默认只勾 R）决定查看哪些分级的图
- 点击卡片可查看该角色大图

### 管理设置
- R / R17 / R18 三个分级开关
- R18 可见人群：无人 / 主人 / 所有人
- 是否接管 miao 面板立绘（拦截原图）
- **从 Gamewiki（11002）同步仓库图片**：填写 IP 与端口，一键把图片拉到本插件仓库

---

## 图片放在哪

```
resources/MLY-MBT/<游戏>/<分级>/normal-character/<角色>/
```

- `<游戏>`：`genshin` / `starrail` / `zzz`
- `<分级>`：`R` / `R17` / `R18`
- 例：`resources/MLY-MBT/genshin/R/normal-character/刻晴/`

> 仓库默认只带 R 级示例图。**R17 / R18 目录已被 `.gitignore` 排除**，不会随仓库发布。

---

## 与 Gamewiki（11002）联动

Gamewiki 提供同步接口（`/api/sync`、`/api/sync/files`、`/repo-img`）。
在 11001 的「管理设置」页填入 Gamewiki 的 IP 与端口即可同步图片。

跨机访问时 Gamewiki 需监听 `0.0.0.0`：

```bash
python server.py --host 0.0.0.0 --port 11002
```

同步会跳过同名且大小相同的文件，可重复执行（增量）。

---

## 配置

首次保存后自动生成 `data/mly-config.json`：

| 字段 | 说明 |
|---|---|
| `r` / `r17` / `r18` | 三个分级开关 |
| `r18_view` | R18 可见人群：无人 / 主人 / 所有人 |
| `intercept` | 是否接管 miao 面板立绘 |
| `syncHost` / `syncPort` | Gamewiki 同步地址 |

---

## 版本

**V1.1.0**

- 取图指令精简为符号前缀（`#` / `*` / `%`）
- 配置类聊天指令移除，统一迁移到 Web 管理端
- 新增 Web 图库预览（游戏 Tab / 元素分组 / 星级子分组 / 分级勾选 / 大图查看）
- 新增从 Gamewiki 同步仓库图片
- 新增 Web 管理设置页（分级开关 / R18 权限 / 接管立绘）

---

Created By TRSS-Yunzai
