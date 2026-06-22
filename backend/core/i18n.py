"""Language / localization for AI output and the HTML report.

The UI has a main language (Settings → language, default zh). The agent's
thoughts / reasons / verdicts / plans and the report should follow it. We don't
translate after the fact — we instruct the LLM to write in the chosen language,
and localize the report's static labels.
"""
from __future__ import annotations

import json
from pathlib import Path

_SETTINGS_PATH = Path(__file__).resolve().parent.parent / "data" / "settings.json"


def current_language() -> str:
    """The configured main language ('zh' or 'en'), default 'zh'."""
    try:
        lang = (json.loads(_SETTINGS_PATH.read_text(encoding="utf-8")).get("language") or "").strip()
    except Exception:
        lang = ""
    return "en" if lang == "en" else "zh"


def lang_directive(language: str = "") -> str:
    """Instruction appended to LLM system prompts so all free-text output (thought,
    reason, verdict, plan) is in the chosen language. Tool argument *values* that
    get typed into the device must stay verbatim, never translated."""
    language = language or current_language()
    if language == "en":
        return "\n\nAlways write your thought, reason and conclusions in English."
    return (
        "\n\n始终用简体中文书写你的思考(thought)、理由(reason)和结论(包括 mark_done 的 reason、"
        "校验结论、计划)。但工具参数里要输入到设备的文本(如 input_text 的 text、搜索词)必须按"
        "任务/界面要求原样填写,不要翻译。"
    )


# Static report labels, keyed by language.
_REPORT_LABELS = {
    "zh": {
        "report_title": "测试报告", "pass": "通过", "fail": "失败", "error": "错误",
        "skip": "跳过", "total": "总计", "pass_rate": "通过率", "step": "步骤",
        "replay": "步骤回放", "case": "用例", "expected": "预期", "reason": "结论",
        "generated_at": "生成于", "run_id": "运行 ID", "no_log": "(无日志)",
        "auto_play": "自动播放", "close": "关闭",
    },
    "en": {
        "report_title": "Test Report", "pass": "Pass", "fail": "Fail", "error": "Error",
        "skip": "Skip", "total": "Total", "pass_rate": "Pass Rate", "step": "Step",
        "replay": "Step Replay", "case": "Case", "expected": "Expected", "reason": "Reason",
        "generated_at": "Generated", "run_id": "Run ID", "no_log": "(no log)",
        "auto_play": "Auto-play", "close": "Close",
    },
}


def report_labels(language: str = "") -> dict:
    return _REPORT_LABELS["en" if (language or current_language()) == "en" else "zh"]
