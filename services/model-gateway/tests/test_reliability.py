import asyncio
import time

import pytest

from gateway.reliability import CircuitBreaker, QueueAdmission, QueueOverloaded, RateLimitExceeded, SlidingWindowRateLimiter, TurnBudget, retry_delay_seconds


def test_rate_limiter_returns_a_bounded_retry_after() -> None:
    async def run() -> None:
        limiter = SlidingWindowRateLimiter(1, window_seconds=60)
        await limiter.acquire(TurnBudget(time.time() + 1))
        with pytest.raises(RateLimitExceeded) as error:
            await limiter.acquire(TurnBudget(time.time() + 0.01))
        assert error.value.retry_after > 0

    asyncio.run(run())


def test_circuit_breaker_opens_and_allows_one_probe() -> None:
    async def run() -> None:
        breaker = CircuitBreaker(failure_threshold=2, cooldown_seconds=0.1)
        assert breaker.allow()
        breaker.failure()
        assert breaker.allow()
        breaker.failure()
        assert not breaker.allow()
        await asyncio.sleep(0.11)
        assert breaker.allow()
        assert not breaker.allow()
        breaker.success()
        assert breaker.allow()

    asyncio.run(run())


def test_queue_admission_rejects_when_conversation_volume_is_high() -> None:
    async def run() -> None:
        admission = QueueAdmission(max_concurrency=1, max_queue=0)
        await admission.acquire(TurnBudget(time.time() + 1))
        try:
            with pytest.raises(QueueOverloaded) as error:
                await admission.acquire(TurnBudget(time.time() + 1))
            assert error.value.retry_after == 3.0
        finally:
            admission.release()

    asyncio.run(run())


def test_retry_delay_is_three_second_exponential_backoff() -> None:
    assert [retry_delay_seconds(index) for index in range(3)] == [3.0, 6.0, 12.0]
