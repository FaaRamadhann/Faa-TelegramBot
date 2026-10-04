import os
import sys
import json
import time
import glob
import shutil
import argparse
from pathlib import Path

import yt_dlp


MAX_DURATION_SECONDS = 10 * 60
MAX_FILE_MB = 50
AUDIO_QUALITIES = {"64", "128", "192", "256", "320"}
VIDEO_HEIGHTS = {360, 480, 720, 1080}


def safe_print(data):
    # ensure_ascii=True: semua non-ASCII jadi escape \uXXXX (murni ASCII).
    # Wajib di Windows karena stdout pipe sering bukan UTF-8 (cp1252)
    # sehingga judul CJK/emoji bikin UnicodeEncodeError (charmap).
    print(json.dumps(data, ensure_ascii=True), flush=True)


def get_ffmpeg_available():
    return shutil.which("ffmpeg") is not None


class QuietLogger:
    def debug(self, msg):
        pass

    def warning(self, msg):
        pass

    def error(self, msg):
        pass


def get_cookies_file():
    candidate = Path(__file__).resolve().parent / "cookies.txt"
    return str(candidate) if candidate.is_file() else None


def build_common_opts(outtmpl):
    opts = {
        "outtmpl": outtmpl,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "logger": QuietLogger(),
        "noplaylist": True,
        "restrictfilenames": True,
        "windowsfilenames": True,
        "socket_timeout": 30,
        "retries": 3,
        "fragment_retries": 3,
        "concurrent_fragment_downloads": 3,
    }

    cookies = get_cookies_file()
    if cookies:
        opts["cookiefile"] = cookies

    return opts

def validate_info(info):
    duration = info.get("duration") or 0

    if duration > MAX_DURATION_SECONDS:
        raise RuntimeError(f"Video terlalu panjang: {duration}s. Max {MAX_DURATION_SECONDS}s.")

    return duration


def find_latest_file(download_dir, before_files):
    after_files = set(glob.glob(str(Path(download_dir) / "*")))
    new_files = list(after_files - before_files)

    if not new_files:
        files = list(after_files)
        if not files:
            raise RuntimeError("Output file tidak ditemukan.")
        return max(files, key=os.path.getmtime)

    return max(new_files, key=os.path.getmtime)


def check_size(path):
    size_mb = os.path.getsize(path) / (1024 * 1024)

    if size_mb > MAX_FILE_MB:
        try:
            os.remove(path)
        except Exception:
            pass
        raise RuntimeError(f"File terlalu besar: {size_mb:.2f} MB. Max {MAX_FILE_MB} MB.")

    return size_mb


def get_version():
    return {
        "ytdlp": yt_dlp.version.__version__,
        "ffmpeg": get_ffmpeg_available(),
        "cookies": get_cookies_file() is not None,
    }


def get_info(url):
    opts = build_common_opts("%(title)s.%(ext)s")

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)

    duration = validate_info(info)

    return {
        "title": info.get("title") or "Unknown",
        "duration": duration,
        "uploader": info.get("uploader") or "-",
        "webpage_url": info.get("webpage_url") or url,
        "extractor": info.get("extractor") or "-",
        "view_count": info.get("view_count") or 0,
        "thumbnail": info.get("thumbnail") or "",
    }


def download_audio(url, download_dir, quality="192"):
    if quality not in AUDIO_QUALITIES:
        quality = "192"

    if not get_ffmpeg_available():
        raise RuntimeError("FFmpeg tidak ditemukan. Install FFmpeg dulu.")

    Path(download_dir).mkdir(parents=True, exist_ok=True)

    outtmpl = str(Path(download_dir) / "%(title).80s.%(ext)s")
    before_files = set(glob.glob(str(Path(download_dir) / "*")))

    opts = build_common_opts(outtmpl)
    opts.update({
        "format": "bestaudio/best",
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": quality,
            }
        ],
    })

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        validate_info(info)

    output = find_latest_file(download_dir, before_files)
    size_mb = check_size(output)

    return {
        "path": output,
        "title": info.get("title") or Path(output).stem,
        "duration": info.get("duration") or 0,
        "size_mb": size_mb,
        "quality": quality,
        "type": "audio",
    }


def download_video(url, download_dir, height=720):
    try:
        height = int(height)
    except (TypeError, ValueError):
        height = 720

    if height not in VIDEO_HEIGHTS:
        height = 720

    if not get_ffmpeg_available():
        raise RuntimeError("FFmpeg tidak ditemukan. Install FFmpeg dulu.")

    Path(download_dir).mkdir(parents=True, exist_ok=True)

    outtmpl = str(Path(download_dir) / "%(title).80s.%(ext)s")
    before_files = set(glob.glob(str(Path(download_dir) / "*")))

    opts = build_common_opts(outtmpl)
    opts.update({
        "format": (
            f"bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/"
            f"best[height<={height}][ext=mp4]/best"
        ),
        "merge_output_format": "mp4",
    })

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        validate_info(info)

    output = find_latest_file(download_dir, before_files)
    size_mb = check_size(output)

    return {
        "path": output,
        "title": info.get("title") or Path(output).stem,
        "duration": info.get("duration") or 0,
        "size_mb": size_mb,
        "height": height,
        "type": "video",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", required=True, choices=["audio", "video", "info", "version"])
    parser.add_argument("--url", default="")
    parser.add_argument("--dir", default=".")
    parser.add_argument("--quality", default="")

    args = parser.parse_args()

    try:
        if args.mode == "version":
            result = get_version()
        elif args.mode == "info":
            if not args.url:
                raise RuntimeError("URL wajib diisi untuk mode info.")
            result = get_info(args.url)
        elif args.mode == "audio":
            if not args.url:
                raise RuntimeError("URL wajib diisi untuk mode audio.")
            result = download_audio(args.url, args.dir, args.quality or "192")
        else:
            if not args.url:
                raise RuntimeError("URL wajib diisi untuk mode video.")
            result = download_video(args.url, args.dir, args.quality or 720)

        safe_print({
            "ok": True,
            "result": result
        })
    except Exception as e:
        safe_print({
            "ok": False,
            "error": str(e)
        })
        sys.exit(1)


if __name__ == "__main__":
    main()