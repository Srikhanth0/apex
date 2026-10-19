"""Durable storage as JSON files in the repo. Writes are atomic (temp file + rename)."""
import json
import os
import tempfile

from . import config


def load(name, default):
    path = config.STORE / f"{name}.json"
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except json.JSONDecodeError:
        os.replace(path, path.with_suffix(".corrupt.json"))  # keep the evidence, start clean
        return default


def save(name, data, folder=None):
    folder = folder or config.STORE
    path = folder / f"{name}.json" if not str(name).endswith(".json") else folder / name
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":") if folder == config.API or "api" in str(folder) else (",", ": "), indent=None if "api" in str(folder) else 1)
    os.replace(tmp, path)


def load_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default
