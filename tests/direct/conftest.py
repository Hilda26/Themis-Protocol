"""
Shared fixtures/workarounds for Themis direct-mode tests.
"""

import os
import sys

# --- Windows workaround -------------------------------------------------
# gltest's direct-mode loader writes the encoded message to a temp file,
# dup2's it onto fd 0, then unlinks the temp path while the dup'd handle is
# still open. On Windows this raises PermissionError ("used by another
# process") even though the unlink is harmless to ignore -- the file is
# cleaned up by the OS once all handles close. Patch os.unlink to swallow
# exactly this failure mode so tests can run on Windows.
_orig_unlink = os.unlink


def _safe_unlink(path, *args, **kwargs):
    try:
        _orig_unlink(path, *args, **kwargs)
    except PermissionError:
        pass


os.unlink = _safe_unlink


def warp_to(direct_vm, iso: str) -> None:
    """
    Advance the VM clock everywhere the contract can read it.
    """
    direct_vm.warp(iso)
    gl = sys.modules.get("genlayer.gl")
    if gl is None:
        return
    raw = getattr(gl, "message_raw", None)
    if isinstance(raw, dict):
        raw["datetime"] = iso
    nested = getattr(getattr(gl, "message", None), "raw", None)
    if isinstance(nested, dict):
        nested["datetime"] = iso
