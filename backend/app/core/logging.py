"""Structured logging with secret redaction."""
import json
import logging
import re

_PATTERNS = [
    (re.compile(r"nx_[A-Za-z0-9_\-]{8}_[A-Za-z0-9_\-]{20,}"), "nx_[REDACTED]"),
    (re.compile(r"sk-[A-Za-z0-9_\-]{16,}"), "sk-[REDACTED]"),
    (re.compile(r"tvly-[A-Za-z0-9_\-]{12,}"), "tvly-[REDACTED]"),
    (re.compile(r"(?i)(authorization|bearer)\s*[:=]?\s*[A-Za-z0-9._\-]{12,}"), r"\1 [REDACTED]"),
    (re.compile(r"(?i)(password|secret|token|api[_-]?key)(\"?\s*[:=]\s*\"?)[^\s\",}]+"), r"\1\2[REDACTED]"),
]


def redact(text: str) -> str:
    for pattern, repl in _PATTERNS:
        text = pattern.sub(repl, text)
    return text


class RedactingFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "message": redact(record.getMessage()),
        }
        if record.exc_info:
            payload["exception"] = redact(self.formatException(record.exc_info))
        return json.dumps(payload)


def setup_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(RedactingFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())