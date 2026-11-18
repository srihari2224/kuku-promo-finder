"""Transcribes an uploaded video/audio file with faster-whisper and turns
the result into the same cue shape captions.py produces from a VTT file,
so both paths feed the scorer identically.

Needs faster-whisper + av installed — real weights, real CPU work, which
is exactly what a Vercel serverless function can't host (no persistent
disk for the model, no time budget for a cold download + CPU transcribe).
This only runs against backend/dev_server.py locally.
"""
MAX_DURATION_S = 20 * 60  # 20 min — past this, faster-whisper's VAD pass
# alone was enough to OOM a modest dev machine (confirmed: a 3-hour file
# pushed one process to 4GB RSS before the kernel killed it). The promos
# this tool looks for are 20-60s anyway, so there's no reason to accept
# anything episode-length or longer.

_model = None


def _get_model(model_size="tiny"):
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        _model = WhisperModel(model_size, device="cpu", compute_type="int8")
    return _model


def transcribe_file(path, model_size="tiny"):
    """Returns a list of {start, end, text} cues, same shape as parse_vtt()."""
    import av
    with av.open(path) as container:
        duration = container.duration / 1_000_000 if container.duration else 0
    if duration > MAX_DURATION_S:
        raise ValueError(
            f"That video is {duration / 60:.0f} minutes long — this only accepts up to "
            f"{MAX_DURATION_S // 60} minutes to keep transcription from exhausting memory "
            "on a non-GPU machine. Trim it and try again."
        )

    model = _get_model(model_size)
    segments, _info = model.transcribe(path, beam_size=1, vad_filter=True)
    cues = []
    for seg in segments:
        text = seg.text.strip()
        if text:
            cues.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": text})
    return cues
