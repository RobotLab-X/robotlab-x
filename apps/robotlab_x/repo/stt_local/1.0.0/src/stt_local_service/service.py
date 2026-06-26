"""SttLocalService — fully-offline streaming speech-to-text with sherpa-onnx.

The whole control surface (listen / start / stop / select_input / set_model /
list_models / mute), the source subscription, the recognizer loop, and the
utterance queue that bridges it to ``listen()`` are inherited from
``rlx_audio.SttServiceBase``. This file implements ONLY the four engine hooks:

  _ensure_model(model_id)            download + cache a model tarball → its dir
  _create_recognizer(model_dir, sr)  build a sherpa-onnx OnlineRecognizer + stream
  _feed(handle, pcm)                 accept one frame → partial / final result
  _list_models()                     curated models + whatever's on disk

sherpa-onnx ships a streaming Zipformer transducer with built-in endpoint
detection, so an utterance finalizes on trailing silence with no external VAD.
A model is a directory of ``encoder/decoder/joiner`` ONNX files + ``tokens.txt``.
``sherpa_onnx`` + ``numpy`` are imported lazily so the module loads without
them (unit tests patch ``_create_recognizer`` / ``_ensure_model``).
"""
from __future__ import annotations

import logging
import shutil
import tarfile
import threading
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

from rlx_audio import SttServiceBase

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "streaming-zipformer-en"
_RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models"

# Curated streaming (online) models surfaced in the picker. Each entry is a
# release tarball whose top-level directory holds the encoder/decoder/joiner
# ONNX files + tokens.txt. Any other model dir dropped under <data>/stt/models/
# (containing tokens.txt) is listed too.
_MODELS: Dict[str, Dict[str, str]] = {
    "streaming-zipformer-en": {
        "label": "Streaming Zipformer (English, int8)",
        "dir": "sherpa-onnx-streaming-zipformer-en-2023-06-26",
        "url": f"{_RELEASE}/sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2",
    },
    "streaming-zipformer-bilingual-zh-en": {
        "label": "Streaming Zipformer (Chinese+English, int8)",
        "dir": "sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20",
        "url": f"{_RELEASE}/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2",
    },
}
_DOWNLOAD_TIMEOUT_S = 600


class SttLocalService(SttServiceBase):
    """Cross-platform offline streaming ASR. See module docstring."""

    source = "local"
    DEFAULT_MODEL = DEFAULT_MODEL

    def __init__(self, proxy_id, bus) -> None:
        super().__init__(proxy_id, bus)
        self._dl_lock = threading.Lock()

    # ─── engine hooks ─────────────────────────────────────────────────
    def _list_models(self) -> List[Dict[str, Any]]:
        on_disk = self._on_disk_models()
        out: List[Dict[str, Any]] = []
        seen = set()
        for mid, m in _MODELS.items():
            out.append({"id": mid, "label": m["label"], "downloaded": mid in on_disk})
            seen.add(mid)
        for mid in sorted(on_disk - seen):
            out.append({"id": mid, "label": mid, "downloaded": True})
        return out

    def _on_disk_models(self) -> set:
        """Model ids whose directory exists + has a tokens.txt."""
        found = set()
        for mid, m in _MODELS.items():
            if (self.models_dir / m["dir"] / "tokens.txt").is_file():
                found.add(mid)
        # Bare model dirs the user dropped in (id == dir name).
        if self.models_dir.is_dir():
            for d in self.models_dir.iterdir():
                if d.is_dir() and (d / "tokens.txt").is_file():
                    found.add(d.name)
        return found

    def _model_dir(self, model_id: str) -> Path:
        spec = _MODELS.get(model_id)
        return self.models_dir / (spec["dir"] if spec else model_id)

    def _ensure_model(self, model_id: str) -> Path:
        """Path to the model dir, downloading + extracting the tarball if absent."""
        self.models_dir.mkdir(parents=True, exist_ok=True)
        model_dir = self._model_dir(model_id)
        if (model_dir / "tokens.txt").is_file():
            return model_dir
        spec = _MODELS.get(model_id)
        if spec is None:
            raise RuntimeError(f"unknown model {model_id!r} (and no {model_dir}/tokens.txt on disk)")
        with self._dl_lock:
            if (model_dir / "tokens.txt").is_file():   # another caller won the race
                return model_dir
            self._download_and_extract(spec["url"])
        if not (model_dir / "tokens.txt").is_file():
            raise RuntimeError(f"model {model_id} missing tokens.txt after download")
        return model_dir

    def _download_and_extract(self, url: str) -> None:
        logger.info("stt_local %s: downloading model %s", self.proxy_id, url)
        tmp = self.models_dir / "_download.tar.bz2"
        try:
            with urllib.request.urlopen(url, timeout=_DOWNLOAD_TIMEOUT_S) as resp, open(tmp, "wb") as fh:  # noqa: S310
                shutil.copyfileobj(resp, fh)
            with tarfile.open(tmp, "r:bz2") as tar:
                # filter="data" blocks path traversal / unsafe members, but the
                # keyword only exists on Python 3.12+ (gated by data_filter);
                # on 3.10/3.11 fall back to a plain extract of the trusted
                # k2-fsa release tarball.
                extra = {"filter": "data"} if hasattr(tarfile, "data_filter") else {}
                tar.extractall(self.models_dir, **extra)
        finally:
            try:
                tmp.unlink()
            except OSError:
                pass

    def _create_recognizer(self, model_dir, sample_rate: int) -> Dict[str, Any]:
        import sherpa_onnx  # noqa: PLC0415 — lazy so the module imports without sherpa
        model_dir = Path(model_dir)
        sil = max(0.1, self.config.endpoint_silence_ms / 1000.0)
        recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
            tokens=str(model_dir / "tokens.txt"),
            encoder=self._pick(model_dir, "encoder"),
            decoder=self._pick(model_dir, "decoder"),
            joiner=self._pick(model_dir, "joiner"),
            num_threads=1,
            sample_rate=sample_rate,
            feature_dim=80,
            decoding_method="greedy_search",
            enable_endpoint_detection=True,
            rule1_min_trailing_silence=max(sil + 0.8, 1.6),   # silence with no speech yet
            rule2_min_trailing_silence=sil,                   # silence after speech → finalize
            rule3_min_utterance_length=300,
        )
        stream = recognizer.create_stream()
        return {"recognizer": recognizer, "stream": stream, "sample_rate": sample_rate}

    @staticmethod
    def _pick(model_dir: Path, kind: str) -> str:
        """Prefer the int8 quantized model file for ``kind`` (encoder/decoder/
        joiner); fall back to the full-precision one."""
        for pat in (f"*{kind}*.int8.onnx", f"*{kind}*.onnx"):
            hits = sorted(model_dir.glob(pat))
            if hits:
                return str(hits[0])
        raise RuntimeError(f"no {kind} .onnx in {model_dir}")

    def _feed(self, handle: Dict[str, Any], pcm: bytes) -> Optional[Dict[str, Any]]:
        import numpy as np  # noqa: PLC0415
        recognizer = handle["recognizer"]
        stream = handle["stream"]
        samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        if samples.size == 0:
            return None
        stream.accept_waveform(handle["sample_rate"], samples)
        while recognizer.is_ready(stream):
            recognizer.decode_stream(stream)
        text = recognizer.get_result(stream)
        if recognizer.is_endpoint(stream):
            recognizer.reset(stream)
            return {"text": text, "final": True}
        return {"text": text, "final": False}

    def _reset_recognizer(self, handle: Dict[str, Any]) -> None:
        """Drop any partial decode state by starting a fresh stream, so a new
        utterance after a stop/source-switch doesn't carry residue from an
        aborted one."""
        recognizer = handle.get("recognizer")
        if recognizer is not None:
            handle["stream"] = recognizer.create_stream()

    def _free_recognizer(self, handle: Dict[str, Any]) -> None:
        """Release the native recognizer + stream refs so they're freed
        promptly on shutdown rather than at interpreter teardown."""
        handle["stream"] = None
        handle["recognizer"] = None
