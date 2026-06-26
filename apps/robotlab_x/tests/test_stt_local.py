# unmanaged
"""SttLocalService unit tests — the sherpa-onnx backend hooks with sherpa
mocked. The real subprocess venv has sherpa-onnx; this venv doesn't, so we
patch the recognizer + download. We test model listing (curated + on-disk),
model dir resolution, the download-on-miss path, and that _feed translates a
sherpa endpoint into a finalized result. The shared control surface + queue +
streaming are covered by test_rlx_audio's FakeStt.
"""
from __future__ import annotations

import io
import sys
import tarfile
from array import array
from pathlib import Path
from typing import Any, List

import pytest

_SRC = Path(__file__).resolve().parents[1] / "repo" / "stt_local" / "1.0.0" / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from stt_local_service import service as stt_service  # noqa: E402


class FakeBus:
    def __init__(self) -> None:
        self.published: List[tuple] = []

    async def publish(self, topic: str, payload: Any, *, retained: bool = False, **_: Any) -> None:
        self.published.append((topic, payload, retained))


def _svc(tmp_path, monkeypatch) -> stt_service.SttLocalService:
    monkeypatch.setenv("ROBOTLAB_X_DATA_DIR_ABS", str(tmp_path))
    return stt_service.SttLocalService("stt-1", FakeBus())


def test_list_models_marks_downloaded_and_includes_on_disk(tmp_path, monkeypatch):
    svc = _svc(tmp_path, monkeypatch)
    # The curated default model present on disk + a bare user-dropped model.
    d = svc.models_dir / "sherpa-onnx-streaming-zipformer-en-2023-06-26"
    d.mkdir(parents=True)
    (d / "tokens.txt").write_text("x")
    custom = svc.models_dir / "my-model"
    custom.mkdir()
    (custom / "tokens.txt").write_text("x")
    models = svc._list_models()
    by_id = {m["id"]: m for m in models}
    assert by_id["streaming-zipformer-en"]["downloaded"] is True
    assert by_id["streaming-zipformer-bilingual-zh-en"]["downloaded"] is False
    assert "my-model" in by_id and by_id["my-model"]["downloaded"] is True


def test_ensure_model_returns_existing_without_download(tmp_path, monkeypatch):
    svc = _svc(tmp_path, monkeypatch)
    d = svc.models_dir / "sherpa-onnx-streaming-zipformer-en-2023-06-26"
    d.mkdir(parents=True)
    (d / "tokens.txt").write_text("x")
    called = []
    monkeypatch.setattr(svc, "_download_and_extract", lambda url: called.append(url))
    out = svc._ensure_model("streaming-zipformer-en")
    assert out == d and called == []                 # already present → no download


def test_ensure_model_downloads_when_absent(tmp_path, monkeypatch):
    svc = _svc(tmp_path, monkeypatch)

    def fake_dl(url: str) -> None:
        d = svc.models_dir / "sherpa-onnx-streaming-zipformer-en-2023-06-26"
        d.mkdir(parents=True, exist_ok=True)
        (d / "tokens.txt").write_text("x")

    monkeypatch.setattr(svc, "_download_and_extract", fake_dl)
    out = svc._ensure_model("streaming-zipformer-en")
    assert (out / "tokens.txt").is_file()


def test_ensure_model_unknown_id_without_disk_raises(tmp_path, monkeypatch):
    svc = _svc(tmp_path, monkeypatch)
    with pytest.raises(RuntimeError):
        svc._ensure_model("does-not-exist")


def test_pick_prefers_int8(tmp_path):
    d = tmp_path / "m"
    d.mkdir()
    (d / "encoder-epoch-99.onnx").write_text("x")
    (d / "encoder-epoch-99.int8.onnx").write_text("x")
    (d / "decoder-epoch-99.onnx").write_text("x")
    assert stt_service.SttLocalService._pick(d, "encoder").endswith(".int8.onnx")
    assert stt_service.SttLocalService._pick(d, "decoder").endswith("decoder-epoch-99.onnx")
    with pytest.raises(RuntimeError):
        stt_service.SttLocalService._pick(d, "joiner")


class FakeRecognizer:
    def __init__(self, endpoint: bool) -> None:
        self._ready = True
        self._endpoint = endpoint
        self.reset_called = False

    def is_ready(self, stream):
        r, self._ready = self._ready, False   # ready once per feed
        return r

    def decode_stream(self, stream):
        pass

    def get_result(self, stream):
        return "hello world"

    def is_endpoint(self, stream):
        return self._endpoint

    def reset(self, stream):
        self.reset_called = True


def test_feed_translates_endpoint_to_final(tmp_path, monkeypatch):
    pytest.importorskip("numpy")
    svc = _svc(tmp_path, monkeypatch)
    reco = FakeRecognizer(endpoint=True)
    handle = {"recognizer": reco, "stream": object(), "sample_rate": 16000}
    res = svc._feed(handle, array("h", [1000] * 320).tobytes())
    assert res == {"text": "hello world", "final": True}
    assert reco.reset_called is True
    # Empty PCM → no result.
    assert svc._feed(handle, b"") is None


def test_feed_partial_branch_no_reset(tmp_path, monkeypatch):
    pytest.importorskip("numpy")
    svc = _svc(tmp_path, monkeypatch)
    reco = FakeRecognizer(endpoint=False)
    handle = {"recognizer": reco, "stream": object(), "sample_rate": 16000}
    res = svc._feed(handle, array("h", [1000] * 320).tobytes())
    assert res == {"text": "hello world", "final": False}   # partial
    assert reco.reset_called is False                       # no reset mid-utterance


def test_reset_recognizer_recreates_stream(tmp_path, monkeypatch):
    svc = _svc(tmp_path, monkeypatch)

    class Rec:
        def create_stream(self):
            return "fresh-stream"

    handle = {"recognizer": Rec(), "stream": "old-stream", "sample_rate": 16000}
    svc._reset_recognizer(handle)
    assert handle["stream"] == "fresh-stream"               # partial decode state dropped
    svc._free_recognizer(handle)
    assert handle["recognizer"] is None and handle["stream"] is None


def _make_tarball(member_path: str, payload: bytes) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:bz2") as tar:
        info = tarfile.TarInfo(member_path)
        info.size = len(payload)
        tar.addfile(info, io.BytesIO(payload))
    return buf.getvalue()


def test_download_and_extract_real(tmp_path, monkeypatch):
    svc = _svc(tmp_path, monkeypatch)
    svc.models_dir.mkdir(parents=True, exist_ok=True)
    data = _make_tarball("sherpa-onnx-streaming-zipformer-en-2023-06-26/tokens.txt", b"x\n")
    monkeypatch.setattr(stt_service.urllib.request, "urlopen", lambda url, timeout=None: io.BytesIO(data))
    svc._download_and_extract("http://example/model.tar.bz2")
    assert (svc.models_dir / "sherpa-onnx-streaming-zipformer-en-2023-06-26" / "tokens.txt").is_file()
    assert not (svc.models_dir / "_download.tar.bz2").exists()   # temp cleaned up


def test_ensure_model_missing_tokens_after_download_raises(tmp_path, monkeypatch):
    svc = _svc(tmp_path, monkeypatch)
    monkeypatch.setattr(svc, "_download_and_extract", lambda url: None)   # downloads nothing
    with pytest.raises(RuntimeError, match="missing tokens.txt after download"):
        svc._ensure_model("streaming-zipformer-en")
