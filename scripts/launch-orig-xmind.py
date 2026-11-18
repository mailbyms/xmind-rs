"""Launch the shipped XMind with CDP 9222 in a clean, detached Windows process.

Why this exists: the WorkBuddy host is itself Electron and exports
ELECTRON_RUN_AS_NODE=1 globally, which makes XMind.exe start as plain Node and
exit immediately. Git-Bash/PowerShell wrappers also carry a Path/PATH duplicate
that breaks Start-Process, and a launcher that exits in 300ms gets its whole
child tree reaped when the background task is considered finished.

Fix: build a minimal, explicit environment (no ELECTRON_RUN_AS_NODE, no
NODE_OPTIONS, no case-duplicate keys) and start with DETACHED_PROCESS so the
XMind main process survives independently of this script.

Usage: python scripts/launch-orig-xmind.py [file.xmind]
"""
import os
import subprocess
import sys
import time
import urllib.request

EXE = r"C:\Users\DM\AppData\Local\Programs\Xmind\Xmind.exe"
DEFAULT_FILE = r"C:\Users\DM\Documents\workspace\github\xmind-rs\example.xmind"
PORT = 9222

doc = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_FILE
# XMind resolves the argument against its own cwd (the install dir), so a
# relative path silently opens nothing and leaves the canvas on "加载中".
doc = os.path.abspath(doc)
if not os.path.exists(doc):
    sys.exit(f"no such file: {doc}")


def env_value(name):
    """Read a var case-insensitively, returning the first defined value."""
    for k in os.environ:
        if k.lower() == name.lower():
            return os.environ[k]
    return None


# Only the vars a Windows GUI/Electron app genuinely needs. Explicitly excludes
# ELECTRON_RUN_AS_NODE / NODE_OPTIONS and guarantees exactly one spelling per key.
WANTED = [
    "SystemRoot", "windir", "ComSpec", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
    "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "USERNAME", "USERDOMAIN",
    "USERDOMAIN_ROAMINGPROFILE", "PROGRAMDATA", "ProgramFiles",
    "ProgramFiles(x86)", "CommonProgramFiles", "CommonProgramFiles(x86)",
    "CommonProgramW6432", "ProgramW6432", "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "OS", "PATHEXT",
    "SESSIONNAME", "LOGONSERVER", "COMPUTERNAME", "ALLUSERSPROFILE",
    "PUBLIC", "SystemDrive",
]
clean = {}
for name in WANTED:
    v = env_value(name)
    if v is not None:
        clean[name] = v
# Exactly one PATH, rebuilt from the system + user path (avoid dup keys).
path = env_value("PATH") or clean.get("SystemRoot", r"C:\Windows")
clean["PATH"] = path
# Keep DPI/session hints harmless; explicitly force Electron OUT of node mode.
clean.pop("ELECTRON_RUN_AS_NODE", None)
clean.pop("NODE_OPTIONS", None)

args = [
    EXE,
    f"--remote-debugging-port={PORT}",
    "--allow-file-access-from-files",
    doc,
]
flags = (
    subprocess.DETACHED_PROCESS
    | subprocess.CREATE_NEW_PROCESS_GROUP
    | subprocess.CREATE_NO_WINDOW
)
proc = subprocess.Popen(
    args,
    env=clean,
    creationflags=flags,
    stdin=subprocess.DEVNULL,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    close_fds=True,
)
print(f"launched pid={proc.pid} port={PORT} doc={doc}", flush=True)

# Wait for CDP to come up (cold start can take ~60s).
deadline = time.time() + 120
while time.time() < deadline:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=2) as r:
            body = r.read().decode("utf-8", "replace")
        print("CDP_UP", body[:200], flush=True)
        sys.exit(0)
    except Exception:
        pass
    # Stop early if the launcher died without leaving an instance.
    proc.poll()
    time.sleep(3)
print("CDP_NOT_UP within 120s (XMind may still be starting)", flush=True)
sys.exit(1)
