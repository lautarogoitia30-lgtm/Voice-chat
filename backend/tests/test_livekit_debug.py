import os
from fastapi.testclient import TestClient
import pytest

from backend.main import app


client = TestClient(app)


def test_token_debug_not_enabled_returns_404(monkeypatch):
    # Ensure debug not enabled
    monkeypatch.delenv('LIVEKIT_DEBUG_ENABLED', raising=False)
    r = client.get('/livekit/token_debug?channel_id=1')
    assert r.status_code == 404


def test_token_debug_enabled_but_secret_mismatch_returns_403(monkeypatch):
    monkeypatch.setenv('LIVEKIT_DEBUG_ENABLED', 'true')
    monkeypatch.setenv('LIVEKIT_DEBUG_SECRET', 'expected-secret')
    # Provide wrong secret
    r = client.get('/livekit/token_debug?channel_id=1&debug_secret=wrong')
    assert r.status_code == 403
