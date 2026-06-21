param([long]$handle)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinRect {
    public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
}
"@
$h = [IntPtr]$handle
if (-not [WinRect]::IsWindowVisible($h)) { Write-Output "INVISIBLE"; exit }
$rc = New-Object WinRect+RECT
[WinRect]::GetWindowRect($h, [ref]$rc)
Write-Output "$($rc.Left),$($rc.Top),$($rc.Right),$($rc.Bottom)"
