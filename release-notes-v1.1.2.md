# Smart-AI-Bot v1.1.2

记忆可治理：运行记录可删、经验可清，加用例更顺手。
Curatable memory: prune run records & lessons, smoother case editing.

> 安装包：`SmartAgent-1.1.2.apk`（debug 签名，可直接安装）
> APK: `SmartAgent-1.1.2.apk` (debug-signed, installable as-is)
> sha256: `d3d98e8fd13035b20c1c0d7f613c5884a540e703641efe1c179d33d4c2c35014`

---

## English

### ✨ Added
- **Memory hygiene** — the agent's cross-run memory (reference paths + learned
  lessons) is derived entirely from run records, so records are now curatable:
  - Per-case **run-history panel** ("记录") listing every past result — status,
    date, model, steps, tokens.
  - Delete a single result, **clear all**, or **delete only failed** for a case.
  - A per-suite **run-history list** under the trend chart; delete a whole run.
  - Every delete cascades to the result's step logs **and the lessons distilled
    from it**, so discarded experience stops priming the next run.
- **Add a sibling check (子用例) to a scenario** — a folder/scenario row, and the
  collapsed root breadcrumb, gain a **+ 子用例** action. Keep the path and just
  fill Expected to add another verification under the same scenario; append
  `> 子场景` for a deeper level.
- **Pass-rate trend redesign** — gradient area chart with gridlines, a highlighted
  latest value, and per-point hover details.

### 🐛 Fixed
- **Lessons were silently disabled** — the `lessons_learned` table predated its
  `suite_id` / `task_keyword` columns and the auto-migration missed them, so every
  lesson load/save threw and was swallowed. Cross-run lessons now persist and load.
- **Couldn't add a sub-case to a single-case scenario** — the add form forced a
  deeper node and blocked same-path siblings; both fixed.

---

## 简体中文

### ✨ 新增
- **记忆治理** —— Agent 的跨运行记忆(参考路径 + 经验教训)全部来自运行记录，现在记录可人工干预：
  - 每条用例的「记录」面板：列出历次结果（状态/时间/模型/步数/token）。
  - 删单条、**清空**、或**只删失败**。
  - 趋势图下方新增本套件的**运行历史列表**，可删除整次运行。
  - 删除会**级联清理** step logs **和由它提炼的经验**，丢弃的经验不再影响下次运行。
- **给场景加同级子用例** —— 文件夹/场景行（及折叠后的根面包屑）新增 **+ 子用例**：
  不改路径只填预期 = 加同级验证；末尾加 `> 子场景` = 建子层级。
- **通过率趋势重做** —— 渐变面积图、网格、最新值高亮、逐点悬停详情。

### 🐛 修复
- **经验记忆此前一直失效** —— `lessons_learned` 表缺少后加的 `suite_id` / `task_keyword`
  两列、且自动迁移漏了它，导致每次读写都报错被吞掉。现在跨运行经验真正生效。
- **单用例场景无法加子用例** —— 旧表单强制下沉、且挡住同路径同级；均已修复。
