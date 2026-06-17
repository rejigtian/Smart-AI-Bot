"""
Resilient LLM entry point — one place that wraps ``litellm.acompletion`` with:

  - Exponential-backoff retry on *transient* errors (rate limit, timeout, 5xx,
    connection drops) against the SAME model.
  - Automatic *fallback* to backup models when a model fails terminally
    (auth error, bad request) or exhausts its retries.

Every LLM call in the codebase (agent decision loop, verifier, planner,
perception VLM, summariser, lesson extractor) should go through
``resilient_completion`` so the whole system survives a flaky provider instead
of failing a whole test run on the first 429.
"""
from __future__ import annotations

import asyncio
import logging
import random
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional, Sequence

import litellm

from agent.base import build_model_kwargs

logger = logging.getLogger(__name__)


def _short(exc: BaseException, limit: int = 240) -> str:
    """One-line, truncated exception message for logs."""
    msg = str(exc).replace("\n", " ").strip()
    return msg[:limit] + ("…" if len(msg) > limit else "")


# Optional sampling params some newer models reject (e.g. Bedrock Claude Opus 4.8:
# "`temperature` is deprecated for this model").
_OPTIONAL_PARAMS = ("temperature", "top_p", "top_k")


def _is_unsupported_param_error(exc: BaseException) -> bool:
    m = str(exc).lower()
    return ("deprecated" in m or "not supported" in m or "unsupported" in m
            or "is not supported" in m) and any(p in m for p in _OPTIONAL_PARAMS + ("parameter",))


def _strip_optional_params(kwargs: dict) -> list:
    removed = [p for p in _OPTIONAL_PARAMS if p in kwargs]
    for p in removed:
        kwargs.pop(p, None)
    return removed


# Models that have rejected optional params this process — strip proactively so
# we don't waste a round-trip rediscovering it on every call.
_MODELS_REJECTING_OPTIONAL: set = set()

# Errors where retrying the *same* model may succeed — back off and retry.
_TRANSIENT_EXC = (
    litellm.exceptions.RateLimitError,
    litellm.exceptions.Timeout,
    litellm.exceptions.ServiceUnavailableError,
    litellm.exceptions.APIConnectionError,
    litellm.exceptions.InternalServerError,
    asyncio.TimeoutError,
)

# Errors where retrying the same model is pointless — jump straight to the next
# fallback model (a different provider / key might work).
_TERMINAL_EXC = (
    litellm.exceptions.AuthenticationError,
    litellm.exceptions.BadRequestError,
    litellm.exceptions.ContextWindowExceededError,
    litellm.exceptions.NotFoundError,
)


@dataclass
class ModelTarget:
    """One (provider, model, key, base) destination for an LLM call."""

    provider: str
    model: str
    api_key: str = ""
    api_base: str = ""

    def label(self) -> str:
        return f"{self.provider}/{self.model}" if self.provider else self.model

    def build_kwargs(self, base_kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """Merge this target's model/api_base/api_key into a kwargs dict."""
        model_str, extra = build_model_kwargs(self.provider, self.model, self.api_base)
        kwargs = {**base_kwargs, "model": model_str, **extra}
        if self.api_key:
            kwargs["api_key"] = self.api_key
        return kwargs


async def resilient_completion(
    *,
    primary: ModelTarget,
    base_kwargs: Dict[str, Any],
    fallbacks: Sequence[ModelTarget] = (),
    timeout: float = 120.0,
    max_retries: int = 3,
    backoff_base: float = 1.0,
    log: Optional[Callable[[str], Awaitable[None]]] = None,
) -> Any:
    """Call ``litellm.acompletion`` with retry + fallback.

    Args:
        primary:     the preferred model target.
        base_kwargs: provider-agnostic completion kwargs (messages, tools,
                     temperature, max_tokens, …) — model/api_base/api_key are
                     injected per target, so DON'T put them here.
        fallbacks:   backup targets, tried in order after primary is exhausted.
        timeout:     per-attempt timeout in seconds.
        max_retries: attempts per target before moving on (>=1).
        backoff_base: base seconds for exponential backoff (1, 2, 4, …).
        log:         optional async logger for surfacing retries/fallbacks.

    Returns:
        The litellm ModelResponse from the first successful target.

    Raises:
        The last exception if every target is exhausted.
    """
    targets: List[ModelTarget] = [primary, *[t for t in fallbacks if t]]
    last_exc: Optional[BaseException] = None

    async def _emit(msg: str) -> None:
        if log is not None:
            try:
                await log(msg)
            except Exception:
                pass

    for t_idx, target in enumerate(targets):
        if t_idx > 0:
            await _emit(f"  🔻 Falling back to {target.label()}")
        kwargs = target.build_kwargs(base_kwargs)
        # If this model already rejected optional params earlier, drop them upfront
        # instead of wasting a round-trip rediscovering it.
        if target.label() in _MODELS_REJECTING_OPTIONAL:
            _strip_optional_params(kwargs)
        stripped_params = False

        for attempt in range(max_retries):
            try:
                return await asyncio.wait_for(
                    litellm.acompletion(**kwargs), timeout=timeout
                )
            except _TERMINAL_EXC as exc:
                last_exc = exc
                # Newer models may reject an optional sampling param (e.g. Opus 4.8:
                # "temperature is deprecated"). Strip it and retry the SAME model
                # before giving up on it.
                if not stripped_params and _is_unsupported_param_error(exc):
                    removed = _strip_optional_params(kwargs)
                    if removed:
                        stripped_params = True
                        _MODELS_REJECTING_OPTIONAL.add(target.label())
                        await _emit(f"  ↻ {target.label()} rejected {removed} — retrying without it (won't resend)")
                        continue
                # Retrying the same model won't help — break to next fallback.
                await _emit(f"  ⚠ {target.label()} terminal error ({type(exc).__name__}): {_short(exc)} — switching model")
                break
            except _TRANSIENT_EXC as exc:
                last_exc = exc
                if attempt < max_retries - 1:
                    delay = backoff_base * (2 ** attempt) + random.uniform(0, 0.5)
                    await _emit(
                        f"  ⚠ {target.label()} {type(exc).__name__}: {_short(exc)} — retry "
                        f"{attempt + 1}/{max_retries - 1} in {delay:.1f}s"
                    )
                    await asyncio.sleep(delay)
                else:
                    await _emit(f"  ⚠ {target.label()} exhausted {max_retries} attempts: {_short(exc)}")
            except Exception as exc:  # unknown — treat as terminal, try next
                last_exc = exc
                await _emit(f"  ⚠ {target.label()} unexpected error ({type(exc).__name__}): {_short(exc)} — switching model")
                break

    assert last_exc is not None
    raise last_exc
