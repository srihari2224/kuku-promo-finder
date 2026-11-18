"""Transcribes an uploaded video/audio file with faster-whisper and turns
the result into the same cue shape captions.py produces from a VTT file,
so both paths feed the scorer identically.

Mirrors ClipCut's flow (clipcut/app/media.py), which is the version that
reliably worked on phone/WhatsApp footage: extract the audio to a clean
16 kHz mono WAV with ffmpeg FIRST, then transcribe the WAV — never hand the
raw .mp4 straight to faster-whisper. Raw-container decoding (variable phone
codecs, odd audio layouts) is exactly where the "0 lines transcribed"
failures came from; a normalized WAV sidesteps all of it.

Needs faster-whisper + imageio-ffmpeg installed — real weights + real CPU
work, which a Vercel serverless function can't host. Runs only against
backend/dev_server.py locally.
"""
import os
import shutil
import subprocess
import tempfile

MAX_DURATION_S = 20 * 60  # 20 min — past this, faster-whisper's VAD pass
# alone was enough to OOM a modest dev machine (confirmed: a 3-hour file
# pushed one process to 4GB RSS before the kernel killed it). The promos
# this tool looks for are 20-60s anyway.

_model = None
_ffmpeg = None


def _ffmpeg_exe():
    """Resolve an ffmpeg binary — system first, then imageio-ffmpeg's bundled
    one (the same resolution ClipCut uses)."""
    global _ffmpeg
    if _ffmpeg:
        return _ffmpeg
    path = os.pathsep.join([os.environ.get("PATH", ""), "/opt/homebrew/bin", "/usr/local/bin"])
    exe = shutil.which("ffmpeg", path=path)
    if not exe:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
    _ffmpeg = exe
    return exe


def _get_model(model_size):
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        _model = WhisperModel(model_size, device="cpu", compute_type="int8")
    return _model


def _extract_audio(src, wav):
    """ffmpeg: strip video, downmix to mono 16 kHz PCM WAV — the format
    faster-whisper is happiest with. This is the step our old code skipped."""
    subprocess.run(
        [_ffmpeg_exe(), "-y", "-hide_banner", "-loglevel", "error",
         "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav],
        check=True,
    )


def _duration_s(path):
    try:
        import av
        with av.open(path) as c:
            return (c.duration / 1_000_000) if c.duration else 0
    except Exception:
        return 0


def _transcribe_wav(model, wav, vad):
    segments, _info = model.transcribe(
        wav, beam_size=3, vad_filter=vad, condition_on_previous_text=False,
    )
    cues = []
    for seg in segments:
        text = seg.text.strip()
        if text:
            cues.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": text})
    return cues


def transcribe_file(path, model_size="small"):
    """Returns a list of {start, end, text} cues, same shape as parse_vtt().

    Raises ValueError with a clear message if the video is too long or has no
    transcribable speech, so the UI can say what happened instead of silently
    showing an empty result.
    """
    duration = _duration_s(path)
    if duration > MAX_DURATION_S:
        raise ValueError(
            f"That video is {duration / 60:.0f} minutes long — this only accepts up to "
            f"{MAX_DURATION_S // 60} minutes to keep transcription from exhausting memory "
            "on a non-GPU machine. Trim it and try again."
        )

    wav = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    try:
        try:
            _extract_audio(path, wav)
        except subprocess.CalledProcessError:
            raise ValueError("Couldn't read the audio from that file — is it a valid video with an audio track?")

        model = _get_model(model_size)
        # VAD on first (cleaner cues); if it strips everything — common on
        # quiet or music-bedded phone audio — retry with VAD off.
        cues = _transcribe_wav(model, wav, vad=True)
        if not cues:
            cues = _transcribe_wav(model, wav, vad=False)
        if not cues:
            raise ValueError(
                "No speech could be transcribed from that video — it may be silent, music-only, "
                "or not in English. Try a clip with clear spoken dialogue."
            )
        return cues
    finally:
        if os.path.exists(wav):
            os.unlink(wav)
