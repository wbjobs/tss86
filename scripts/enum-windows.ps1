[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public class WinEnum {
    public struct RECT { public int Left, Top, Right, Bottom; }

    delegate bool EWP(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] static extern bool EnumWindows(EWP cb, IntPtr lp);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern int GetWindowTextLengthW(IntPtr hWnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT r);

    public static string List() {
        var sb = new StringBuilder();
        EnumWindows((hWnd, lp) => {
            if (!IsWindowVisible(hWnd)) return true;
            int len = GetWindowTextLengthW(hWnd);
            if (len == 0) return true;
            var title = new StringBuilder(len + 1);
            GetWindowTextW(hWnd, title, title.Capacity);
            string t = title.ToString().Trim();
            if (string.IsNullOrEmpty(t)) return true;
            uint pid; GetWindowThreadProcessId(hWnd, out pid);
            RECT r; GetWindowRect(hWnd, out r);
            int w = r.Right - r.Left; int h = r.Bottom - r.Top;
            if (w <= 0 || h <= 0) return true;
            t = t.Replace("|","_").Replace("\n"," ").Replace("\r"," ");
            sb.AppendLine(hWnd.ToInt64() + "|" + pid + "|" + w + "|" + h + "|" + r.Left + "|" + r.Top + "|" + t);
            return true;
        }, IntPtr.Zero);
        return sb.ToString();
    }
}
"@
[WinEnum]::List()
