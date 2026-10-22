"""Render service-wide status without touching persisted action state."""

from collections.abc import Iterable, Mapping

from social_automation.core.models import Platform
from social_automation.core.redaction import redact_error
from social_automation.platforms.base import PlatformAdapter
from social_automation.scheduling import PlatformQueue


def service_status(
    adapters: Mapping[Platform, PlatformAdapter],
    queues: Mapping[Platform, PlatformQueue],
    results: Iterable[object],
) -> dict[str, object]:
    platforms = {
        platform.value: _status_result(result)
        for platform, result in zip(adapters, results, strict=True)
    }
    return {
        "name": "social",
        "platforms": platforms,
        "queues": {platform.value: queue.snapshot() for platform, queue in queues.items()},
    }


def authentication_status(
    adapters: Mapping[Platform, PlatformAdapter], results: Iterable[object]
) -> dict[str, object]:
    return {
        "platforms": {
            platform.value: _authentication_result(result)
            for platform, result in zip(adapters, results, strict=True)
        }
    }


def _status_result(result: object) -> object:
    if isinstance(result, BaseException):
        return {"available": False, "error": redact_error(result)}
    return result


def _authentication_result(result: object) -> object:
    if isinstance(result, BaseException):
        return {"authenticated": None, "error": redact_error(result)}
    return result
