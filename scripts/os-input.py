"""OS-level input helpers for driving XMind's native Win32 menus (ctypes only).

Usage:
  python scripts/os-input.py focus [title-substring]
  python scripts/os-input.py key <vk-or-name> [times]   # e.g. DOWN 2 / ENTER / ESC
  python scripts/os-input.py click <x> <y>              # physical screen pixels
"""
import ctypes
import ctypes.wintypes as w
import sys
import time

u32 = ctypes.WinDLL("user32", use_last_error=True)
WNDENUMPROC = ctypes.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
EnumWindows = u32.EnumWindows
EnumWindows.argtypes = [WNDENUMPROC, w.LPARAM]
GetWindowText = u32.GetWindowTextW
GetWindowText.argtypes = [w.HWND, w.LPWSTR, ctypes.c_int]
GetWindowTextLength = u32.GetWindowTextLengthW
IsWindowVisible = u32.IsWindowVisible
SetForegroundWindow = u32.SetForegroundWindow
ShowWindow = u32.ShowWindow
BringWindowToTop = u32.BringWindowToTop
GetForegroundWindow = u32.GetForegroundWindow
GetWindowThreadProcessId = u32.GetWindowThreadProcessId
AttachThreadInput = u32.AttachThreadInput
SetCursorPos = u32.SetCursorPos
mouse_event = u32.mouse_event
keybd_event = u32.keybd_event
GetWindowRect = u32.GetWindowRect

VK = {
    "DOWN": 0x28, "UP": 0x26, "LEFT": 0x25, "RIGHT": 0x27,
    "ENTER": 0x0D, "ESC": 0x1B, "TAB": 0x09, "MENU": 0x12,
    "CTRL": 0x11, "SHIFT": 0x10, "Z": 0x5A, "A": 0x41,
}
KEYUP = 0x0002
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004


def focus(substr="example"):
    found = []

    @WNDENUMPROC
    def cb(hwnd, _):
        if not IsWindowVisible(hwnd):
            return True
        n = GetWindowTextLength(hwnd)
        if n:
            buf = ctypes.create_unicode_buffer(n + 1)
            GetWindowText(hwnd, buf, n + 1)
            if substr.lower() in buf.value.lower():
                found.append((hwnd, buf.value))
        return True

    EnumWindows(cb, 0)
    if not found:
        print("NO_WINDOW")
        return False
    hwnd, title = found[0]
    ShowWindow(hwnd, 9)
    BringWindowToTop(hwnd)
    keybd_event(VK["MENU"], 0, 0, 0)
    keybd_event(VK["MENU"], 0, KEYUP, 0)
    fg = GetForegroundWindow()
    a = u32.GetWindowThreadProcessId(fg, None)
    b = u32.GetWindowThreadProcessId(hwnd, None)
    if a != b:
        AttachThreadInput(a, b, True)
        SetForegroundWindow(hwnd)
        AttachThreadInput(a, b, False)
    else:
        SetForegroundWindow(hwnd)
    time.sleep(0.35)
    ok = GetForegroundWindow() == hwnd
    print(f"focus={ok} hwnd={hwnd} title={title}")
    return ok


def key(name, times=1):
    vk = VK.get(name.upper()) if not name.startswith("0x") else int(name, 16)
    if vk is None:
        raise SystemExit(f"unknown key {name}")
    for _ in range(times):
        keybd_event(vk, 0, 0, 0)
        keybd_event(vk, 0, KEYUP, 0)
        time.sleep(0.09)
    print(f"key {name} x{times}")


def click(x, y):
    x, y = int(x), int(y)
    SetCursorPos(x, y)
    time.sleep(0.1)
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    time.sleep(0.06)
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    print(f"click {x},{y}")


def rect(substr="example"):
    found = []

    @WNDENUMPROC
    def cb(hwnd, _):
        if not IsWindowVisible(hwnd):
            return True
        n = GetWindowTextLength(hwnd)
        if n:
            buf = ctypes.create_unicode_buffer(n + 1)
            GetWindowText(hwnd, buf, n + 1)
            if substr.lower() in buf.value.lower():
                found.append(hwnd)
        return True

    EnumWindows(cb, 0)
    if not found:
        print("NO_WINDOW")
        return
    r = w.RECT()
    GetWindowRect(found[0], ctypes.byref(r))
    print(f"rect {r.left},{r.top},{r.right},{r.bottom}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "focus"
    if cmd == "focus":
        focus(sys.argv[2] if len(sys.argv) > 2 else "example")
    elif cmd == "key":
        key(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 1)
    elif cmd == "click":
        click(sys.argv[2], sys.argv[3])
    elif cmd == "rect":
        rect(sys.argv[2] if len(sys.argv) > 2 else "example")
    else:
        raise SystemExit("unknown command")
