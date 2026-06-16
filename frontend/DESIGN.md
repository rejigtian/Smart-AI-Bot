---
version: alpha
name: smart-ai-bot-design-language
description: Smart-AI-Bot 管理后台的设计语言。一个面向开发者 / QA 的 AI Android 测试平台 —— 大量日志、JSON-RPC 调用、a11y 树、步骤回放。视觉基调是「亮底 · 电青终端」：冷白干净画布承载报告与截图，单一电青（electric cyan）作为唯一主操作色，等宽字体承载技术数据，深色终端块承载日志 / 代码 / 命令。整体克制、精确、有工程与科技氛围，而非千篇一律的通用蓝色后台。

colors:
  primary: "#06B6D4"
  primary-deep: "#0891B2"
  primary-soft: "#ECFEFF"
  primary-bright: "#22D3EE"
  ink: "#0F172A"
  ink-secondary: "#334155"
  ink-mute: "#64748B"
  ink-faint: "#94A3B8"
  on-primary: "#ffffff"
  canvas: "#ffffff"
  canvas-soft: "#F8FAFC"
  canvas-cool: "#F1F5F9"
  hairline: "#E2E8F0"
  hairline-strong: "#CBD5E1"
  terminal-bg: "#0B1120"
  terminal-line: "#1E293B"
  terminal-text: "#E2E8F0"
  terminal-mute: "#94A3B8"
  ok: "#10B981"
  warning: "#F59E0B"
  danger: "#EF4444"

typography:
  font-sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
  font-mono: "ui-monospace, 'JetBrains Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
  display-lg: { size: 26px, weight: 600, lineHeight: 1.2 }
  display-md: { size: 20px, weight: 600, lineHeight: 1.25 }
  heading:    { size: 16px, weight: 600, lineHeight: 1.4 }
  body-md:    { size: 14px, weight: 400, lineHeight: 1.5 }
  button:     { size: 14px, weight: 500, lineHeight: 1.0 }
  caption:    { size: 12px, weight: 400, lineHeight: 1.45 }
  data:       { size: 13px, weight: 400, lineHeight: 1.5, font: font-mono }  # IDs / models / tokens / numbers
  code:       { size: 12px, weight: 400, lineHeight: 1.5, font: font-mono }  # logs / commands

rounded:
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  full: 9999px

spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
---

## Overview

Smart-AI-Bot 后台的设计语言以**精确**与**工程感**为核心。页面坐落在冷白画布 `{colors.canvas}`（纯白卡片）与 `{colors.canvas-soft}`（`#F8FAFC` 冷灰页底）之上，正文使用 `{colors.ink}`（`#0F172A` 近黑石板色，带极轻冷调，绝不用纯黑）。整个系统唯一稳定的彩色事件是**电青主色**（`{colors.primary}` — `#06B6D4`）—— 用作主操作按钮、激活态、关键数据高亮、链接。其余一切都是从 `#E2E8F0` 发丝线到 `#0F172A` 近黑的精校冷灰阶。

技术氛围由三件事承载，而非靠铺满霓虹：
1. **等宽字体承载数据** —— 设备 ID、模型名、token、坐标、index、耗时一律用 `{typography.font-mono}`，让"机器可读"的内容看起来就像机器输出。
2. **深色终端块承载日志** —— agent 思考、JSON-RPC 调用、命令、diff 一律放进深色块 `{colors.terminal-bg}`（`#0B1120`），等宽 + 电青高亮，像一个嵌在亮底页面里的控制台。
3. **冷白 + 发丝线 + 留白** —— 报告、截图、步骤回放需要干净可读的亮底；层级靠 1px 发丝线和轻阴影，不堆重阴影、不上深色背景。

电青克制使用：**一个视口通常只出现一个填充电青按钮**，电青是强调，不是底色。

**核心特征：**
- 单一电青（`{colors.primary}` `#06B6D4`）作为唯一主色事件；其余为冷中性灰阶。
- 冷白 / 冷灰画布（slate 色阶），灰阶从 `{colors.hairline}` 到 `{colors.ink}`。
- 6px 标准圆角（按钮、输入框），8px 卡片 —— 比通用后台更利落一点，工程感。
- 数据 / 标识 / 数值用等宽字体；日志 / 命令用深色终端块。
- 状态色克制：成功=绿 `{colors.ok}`，警告=橙 `{colors.warning}`，危险=红 `{colors.danger}`，信息=电青。

## Colors

### 品牌与强调
- **电青 / Primary**（`{colors.primary}` — `#06B6D4`）：主操作按钮、激活菜单、链接、关键指标。页面签名色。
- **深青 / Primary Deep**（`{colors.primary-deep}` — `#0891B2`）：按钮 hover / pressed 态。
- **浅青 / Primary Soft**（`{colors.primary-soft}` — `#ECFEFF`）：选中行背景、青色 Tag 底、信息提示底。
- **亮青 / Primary Bright**（`{colors.primary-bright}` — `#22D3EE`）：**仅用于深色终端块内**的高亮（亮底上对比不足，深底上才用）。

### 状态
- **成功绿**（`{colors.ok}` — `#10B981`）：pass、在线、成功。
- **警告橙**（`{colors.warning}` — `#F59E0B`）：警告、跳过、待定。
- **危险红**（`{colors.danger}` — `#EF4444`）：fail、error、删除、离线红点。

### 表面
- **Canvas**（`#ffffff`）：卡片、主内容区背景。
- **Canvas Soft**（`#F8FAFC`）：页面整体冷灰底。
- **Canvas Cool**（`#F1F5F9`）：浅色次级块、表头、hover 行。
- **Hairline**（`#E2E8F0`）：卡片、表格 1px 边框分割线。
- **Hairline Strong**（`#CBD5E1`）：强调边框、次级按钮描边。

### 终端（深色块）
- **Terminal BG**（`#0B1120`）：日志 / 代码 / 命令块底色。
- **Terminal Line**（`#1E293B`）：终端块内分割线 / 边框。
- **Terminal Text**（`#E2E8F0`）：终端块内主文字。
- **Terminal Mute**（`#94A3B8`）：终端块内次级 / 注释。
- 终端内高亮用 `{colors.primary-bright}`（`#22D3EE`），成功/失败用 `{colors.ok}` / `{colors.danger}`。

### 文字
- **Ink**（`#0F172A`）：正文主文字。
- **Ink Secondary**（`#334155`）：次级正文。
- **Ink Mute**（`#64748B`）：辅助、说明、占位。
- **Ink Faint**（`#94A3B8`）：禁用态。

## Typography

系统字体栈做正文，无需 webfont。**等宽字体是这套设计的技术信号** —— 凡是"机器产出 / 机器可读"的内容（ID、模型名、包名、token、坐标、index、耗时、JSON）一律 `{typography.font-mono}`。

| Token | Size | Weight | 用途 |
|---|---|---|---|
| `display-lg` | 26px | 600 | 页面主标题 |
| `display-md` | 20px | 600 | 卡片 / 区块标题 |
| `heading` | 16px | 600 | 小标题 |
| `body-md` | 14px | 400 | 默认正文 / 表格 |
| `button` | 14px | 500 | 按钮文字 |
| `caption` | 12px | 400 | 辅助、脚注、Tag |
| `data` (mono) | 13px | 400 | ID / 模型 / 数值 / 坐标 |
| `code` (mono) | 12px | 400 | 日志 / 命令 / diff |

## Layout

- **基准单位** 8px（含 2 / 4 / 12 子档）。
- **卡片内边距** 20px；**区块垂直间距** 16px；**主内容区边距** 24px。
- 顶部导航固定高度（约 56px），主内容区居中、最大宽度约 1152px。

## Elevation

| Level | 处理 | 用途 |
|---|---|---|
| 0 | 1px `{colors.hairline}` 发丝线，无阴影 | 默认卡片 / 表格 |
| 1 | `0 1px 3px rgba(15,23,42,0.06)` | 卡片轻微抬升 |
| 2 | `0 4px 16px rgba(15,23,42,0.08)` | 下拉、悬浮、模态 |

发丝线 + 轻阴影承载层级，保持清爽。

## Shapes

| Token | 值 | 用途 |
|---|---|---|
| `sm` | 4px | 小 Tag、徽标 |
| `md` | 6px | 按钮、输入框、终端块（签名圆角）|
| `lg` | 8px | 卡片 |
| `xl` | 12px | 大容器 |
| `full` | 9999px | 胶囊 Tag、状态点 |

6px 是工程感签名圆角 —— 利落但不生硬。

## Components

### 按钮
**`button-primary`** —— 电青主操作按钮：背景 `{colors.primary}`，白字，6px 圆角，padding 8px 16px，hover → `{colors.primary-deep}`。前缀可带 `▶` / `+` 等工程化图标。

**`button-secondary`** —— 白底描边：背景 `{colors.canvas}`，文字 `{colors.ink}`，1px `{colors.hairline-strong}` 边框。

### 卡片
**`card`** —— 背景 `{colors.canvas}`，内边距 20px，圆角 `lg`(8px)，1px `{colors.hairline}` 边框，可选 Level 1 阴影。

### 输入 / 下拉
**`text-input`** —— 背景 `{colors.canvas}`，圆角 `md`(6px)，1px `{colors.hairline}` 边框，聚焦时边框 + ring 转 `{colors.primary}`。承载技术值的输入用等宽字体。

### Tag / 状态
- **info / primary**：底 `{colors.primary-soft}`，字 `{colors.primary-deep}`，圆角 `full`。
- **pass**：底 `#ECFDF5`，字 `{colors.ok}`。**fail**：底 `#FEF2F2`，字 `{colors.danger}`。**warn**：底 `#FFFBEB`，字 `{colors.warning}`。
- 在线 / 离线：实心圆点 `{colors.ok}` / `{colors.ink-faint}`。

### 导航
**`nav`** —— 顶部白底 + 底部发丝线。品牌名用等宽字体。激活项：文字 `{colors.primary}` + 2px 电青下划线；未激活 `{colors.ink-mute}`，hover → `{colors.ink}`。

### 终端块（高频）
**`terminal-block`** —— 日志 / JSON-RPC / 命令 / diff：背景 `{colors.terminal-bg}`，等宽字体 `{typography.code}`，文字 `{colors.terminal-text}`，圆角 `md`，内边距 12px。结构高亮：工具名 / 关键值用 `{colors.primary-bright}`，✓/成功用 `{colors.ok}`，✗/失败用 `{colors.danger}`，注释 / 时间戳用 `{colors.terminal-mute}`。

## Do's and Don'ts

### Do
- 把电青留给主操作按钮、激活态、关键指标 —— 克制，一个视口一个填充电青按钮。
- 机器可读的数据一律等宽字体；日志 / 命令一律放深色终端块。
- 按钮 / 输入 6px、卡片 8px 圆角 —— 利落工程感。
- 表格、卡片用 1px 发丝线 + 至多 Level 1 轻阴影。
- 报告 / 截图 / 步骤回放保持亮底干净，不受装饰干扰。

### Don't
- 不要回到通用蓝（`blue-600`）或紫色后台调性 —— 电青是新的签名色。
- 不要用纯黑文字（用 `#0F172A`）或纯黑阴影。
- 不要满屏铺青，也不要把整页做成深色 —— 深色只属于终端块。
- 不要用 `{colors.primary-bright}` 亮青做亮底上的文字（对比不足，仅限深底）。
- 不要堆重阴影。

## Iteration Guide

1. 一次只改一个组件 / 一个页面。
2. 直接用 Tailwind token：`bg-primary` `text-ink` `border-hairline` `bg-terminal` `font-mono` `rounded-md`。
3. 保持电青稀缺 —— 每个视口一个填充电青按钮。
4. 冷白画布是基调；深色仅限终端块。
