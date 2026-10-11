"""Remove credential material from errors returned through MCP."""

import os
import re

_SENSITIVE_HEADER = re.compile(r"(?i)\b(authorization|cookie|set-cookie)\s*[:=]\s*[^\r\n]+")
_BEARER_TOKEN = re.compile(r"(?i)\bbearer\s+[a-z0-9._~+/=-]+")


def redact_error(error: BaseException | str) -> str:
    text = str(error)
    for name in ("X_COOKIES", "XACTIONS_SESSION_COOKIE"):
        value = os.getenv(name)
        if value:
            text = text.replace(value, "[redacted]")
    text = _SENSITIVE_HEADER.sub(lambda match: f"{match.group(1)}=[redacted]", text)
    return _BEARER_TOKEN.sub("Bearer [redacted]", text)
