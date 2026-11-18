""" Bring the shipped XMind window to the OS foreground.

Electron native menus (the 插入 dropdown) require the owner window to be the
real OS foreground window; CDP Page.bringToFront only affects the renderer.
Uses ctypes + user32 only (no Add-Type, no COM).
"""
import ctypes
import ctypes.wintypes as w
import sys

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
GetWindowThreadProcessId = u32.GetWindowThreadProcessId
GetForegroundWindow = u32.GetForegroundWindow
AttachThreadInput = u32.AttachThreadInput
keybd_event = u32.keybd_event

target = sys.argv[1] if len(sys.argv) > 1 else "example"
found = []

@WNDENUMPROC
def cb(hwnd, _):
    if not IsWindowVisible(hwnd):
        return True
    n = GetWindowTextLength(hwnd)
    if n == 0:
        return True
    buf = ctypes.create_unicode_buffer(n + 1)
    GetWindowText(hwnd, buf, n + 1)
    title = buf.value
    if target.lower() in title.lower():
        pid = w.DWORD()
        GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        found.append((hwnd, title, pid.value))
    return True

EnumWindows(cb, 0)
print("candidates:", [(h, t, p) for h, t, p in found])
if not found:
    print("NO_WINDOW")
    sys.exit(1)

# Prefer the largest/main window with a real title.
hwnd, title, pid = found[0]
SW_RESTORE = 9
ShowWindow(hwnd, SW_RESTORE)
BringWindowToTop(hwnd)

# Break the foreground lock by synthesizing an ALT press, then attach threads.
VK_MENU = 0x12
KEYEVENTF_KEYUP = 0x0002
keybd_event(VK_MENU, 0, 0, 0)
keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0)

fg = GetForegroundWindow()
tid_fg = u32.GetWindowThreadProcessId(fg, None)
tid_target = u32.GetWindowThreadProcessId(hwnd, None)
if tid_fg != tid_target:
    AttachThreadInput(tid_fg, tid_target, True)
    SetForegroundWindow(hwnd)
    AttachThreadInput(tid_fg, tid_target, False)
else:
    SetForegroundWindow(hwnd)

import time
time.sleep(0.5)
fg2 = GetForegroundWindow()
print("target_hwnd", hwnd, "foreground_now", fg2, "match", fg2 == hwnd)
sys.exit(0 if fg2 == hwnd else 2)
