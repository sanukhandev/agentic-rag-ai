from __future__ import annotations

import asyncio
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone


class BudgetExceeded(Exception):
    pass


class RateLimitExceeded(Exception):
    def __init__(self, retry_after: float) -> None:
        super().__init__("model rate limit exceeded")
        self.retry_after = retry_after


class TurnBudget:
    def __init__(self, deadline: float) -> None:
        self.deadline = deadline

    @classmethod
    def from_deadline(cls, deadline_at: str | None, default_seconds: float) -> "TurnBudget":
        if deadline_at:
            try:
                deadline = datetime.fromisoformat(deadline_at.replace("Z", "+00:00")).astimezone(timezone.utc).timestamp()
            except ValueError as error:
                raise BudgetExceeded("invalid deadline") from error
        else:
            deadline = time.time() + default_seconds
        return cls(deadline)

    def remaining(self) -> float:
        return self.deadline - time.time()

    async def sleep(self, seconds: float) -> None:
        if seconds <= 0:
            return
        if self.remaining() < seconds:
            raise BudgetExceeded("turn deadline exceeded")
        await asyncio.sleep(seconds)


class SlidingWindowRateLimiter:
    def __init__(self, limit: int, window_seconds: float = 60.0) -> None:
        self.limit = max(1, limit)
        self.window_seconds = max(1.0, window_seconds)
        self._calls: deque[float] = deque()
        self._lock = asyncio.Lock()

    async def acquire(self, budget: TurnBudget) -> None:
        del budget
        async with self._lock:
            now = time.monotonic()
            while self._calls and self._calls[0] <= now - self.window_seconds:
                self._calls.popleft()
            if len(self._calls) >= self.limit:
                raise RateLimitExceeded(self._calls[0] + self.window_seconds - now)
            self._calls.append(now)


@dataclass
class CircuitBreaker:
    failure_threshold: int = 3
    cooldown_seconds: float = 30.0
    failures: int = 0
    opened_until: float = 0.0
    probe_in_flight: bool = False

    def allow(self) -> bool:
        now = time.monotonic()
        if self.opened_until <= now:
            if self.opened_until and self.probe_in_flight:
                return False
            if self.opened_until:
                self.probe_in_flight = True
            return True
        return False

    def success(self) -> None:
        self.failures = 0
        self.opened_until = 0.0
        self.probe_in_flight = False

    def failure(self) -> None:
        self.probe_in_flight = False
        self.failures += 1
        if self.failures >= max(1, self.failure_threshold):
            self.opened_until = time.monotonic() + max(0.1, self.cooldown_seconds)
