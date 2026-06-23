# 快速上手 —— 从零跑通第一个测试

> 完整走一遍：启动服务 → 连上手机 → 用自然语言写一条用例 → 运行 → 看报告。

[English](getting-started.md) · **简体中文**

走完这篇，你就能让 AI Agent 在一台真机上执行一条你用大白话写的测试用例，每一步都带截图和思考过程。

---

## 1. 准备

- 一台 **Android 设备**（真机或模拟器）。
- 至少一个 **大模型 API Key**（OpenAI / Anthropic / Gemini / 智谱 GLM / Groq，或本地 Ollama）。
- 跑服务需要：**Docker**（最省事）*或* Python 3.9+ 和 Node.js 18+。

---

## 2. 启动服务

**Docker（推荐）：**

```bash
git clone https://github.com/rejigtian/Smart-AI-Bot.git
cd Smart-AI-Bot
docker compose up -d
```

**源码启动：**

```bash
git clone https://github.com/rejigtian/Smart-AI-Bot.git
cd Smart-AI-Bot
./start.sh        # 同时起后端 (:8000) 和前端 (:5173)
```

然后打开后台页面：

- 在**同一台电脑**上：<http://localhost:5173>
- 用**同一 WiFi 下的手机**访问：用电脑的**内网 IP** 打开，例如 `http://192.168.1.10:5173`
  —— 真机访问不到 `localhost`。

> 公网部署 / HTTPS / WSS → 见 [部署文档](deployment.zh-CN.md)。

---

## 3. 填大模型 API Key

打开后台的 **Settings（设置）**，粘贴任意一个你有的 provider 的 Key。Agent 靠它思考。每次运行时还能单独切换模型。

---

## 4. 连接手机

下面这些步骤在 **Devices 页也有一个可折叠的引导**，不用记。

**4a. 安装 Portal App。** 在 **Devices** 页点 **📱 安装 App**，用手机浏览器扫码下载并安装 `SmartAgent-<version>.apk`，安装时允许「未知来源」。

**4b. 开启无障碍。** 在手机上：**系统设置 → 无障碍 → 开启 `AgentAccessibilityService`**。出现一个常驻通知，就说明 Portal 在运行了。

**4c. 配对设备。** 回到后台，点 **+ Generate Token** 生成一台设备，再点它的 **Show QR**。在 Portal app 里点 **扫码连接** 扫一下 —— 服务器地址和 token 自动填好，一键连上。

当圆点变绿、状态显示 **online**，右侧就能看到手机屏幕的实时镜像：

![Devices 页与设备实时画面](../assets/devices-live.png)

> 连不上？Devices 页有 **「连不上 / 扫码无法访问？点此排查」** 折叠区，另有完整的 [排错文档](troubleshooting.zh-CN.md)。最常见的原因是 VPN / 虚拟网卡让自动探测选了手机访问不到的 IP —— 改用真实内网 IP 打开本页即可。

---

## 5. 写第一条用例

进 **Test Suites**，新建一个套件，加一条用例。用例就是大白话 —— 做什么、期望什么：

```
Path: 打开设置，进入关于手机，读取版本号
Expected: 显示系统版本信息，无报错弹窗
```

不需要 XPath、不需要元素 ID、不需要录制脚本。也可以从 YAML / Excel / xmind / Markdown **导入**用例。

---

## 6. 运行

选一台 **设备** 和一个 **模型**，点 **Run**。实时看 Agent 干活 —— 它的思考、每一次工具调用（`tap_element`、`screenshot`……）、以及手机实时画面，并排展示：

![运行页：实时 Agent 日志与设备画面](../assets/run-page.png)

---

## 7. 看报告

跑完会给出通过/失败、通过率、token 消耗、运行时长，以及每条用例的判定结果和验证器的推理：

![测试报告](../assets/test-report.png)

每一步都能回放 —— 截图、Agent 的推理、以及它实际调用的工具：

![步骤回放](../assets/step-replay.png)

可以导出**自包含的 HTML 报告**（单文件、截图内嵌）分享给团队。失败用例会自动总结一条「教训」，下次自动回注，让 Agent 不再重蹈覆辙。

---

## 8. 接入 CI（可选）

```bash
cd backend
python cli.py run --suite <id> --device <id> --json
```

退出码 `0` = 全部通过，`1` = 至少一条失败。接进 CI，再通过 webhook 把结果发到飞书 / 钉钉 / Slack。

---

## 接下来看什么

| 想做的事 | 看这里 |
|----------|--------|
| 部署到公网服务器（HTTPS/WSS） | [部署文档](deployment.zh-CN.md) |
| 理解 Agent 怎么决策 | [Agent 架构](agent-architecture.md) |
| 给 Agent 喂 App 专属知识 | [Test KB](../test_knowledge/README.md) |
| 解决连接 / 识别问题 | [排错文档](troubleshooting.zh-CN.md) |
