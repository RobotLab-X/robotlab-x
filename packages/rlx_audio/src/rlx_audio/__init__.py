"""rlx_audio — shared audio-device capabilities for robotlab_x services.

    AudioDeviceServiceBase  common control interface (list/select/connect/
                            disconnect/mute/unmute/set_params + state).
    MicrophoneServiceBase   input device: capture → frames + save-to-file.
    SpeakerServiceBase      output device: play frames arriving on the bus.
    SpeechServiceBase       text-to-speech producer: synthesize (cached) →
                            frames on /speech/{id}/audio, interruptible.
    SttServiceBase          speech-to-text consumer: transcribe mic frames →
                            partials/finals on /stt/{id}/text + listen().
    *Config                 persisted config (device/rate/channels/frame +
                            last_connected_source/connected/muted).
    encode_frame/decode_frame/level_rms   the audio-frame wire schema.
    read_wav_pcm/remix_channels/resample_s16le   PCM conditioning helpers.
"""
from .base import (
    AudioDeviceConfig,
    AudioDeviceServiceBase,
    MicrophoneConfig,
    MicrophoneServiceBase,
    SpeakerConfig,
    SpeakerServiceBase,
    SpeechConfig,
    SpeechServiceBase,
    SttConfig,
    SttServiceBase,
)
from .frames import (
    FORMAT,
    decode_frame,
    encode_frame,
    level_rms,
    read_wav_pcm,
    remix_channels,
    resample_s16le,
)

__all__ = [
    "AudioDeviceServiceBase",
    "AudioDeviceConfig",
    "MicrophoneServiceBase",
    "MicrophoneConfig",
    "SpeakerServiceBase",
    "SpeakerConfig",
    "SpeechServiceBase",
    "SpeechConfig",
    "SttServiceBase",
    "SttConfig",
    "FORMAT",
    "encode_frame",
    "decode_frame",
    "level_rms",
    "read_wav_pcm",
    "remix_channels",
    "resample_s16le",
]
__version__ = "0.4.0"
