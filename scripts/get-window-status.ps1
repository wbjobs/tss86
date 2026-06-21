param([long]$handle)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinStatus {
    public struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
}
"@
$h = [IntPtr]$handle
$visible = [WinStatus]::IsWindowVisible($h) | Out-Null
$minimized = [WinStatus]::IsIconic($h) | Out-Null

if (-not [WinStatus]::IsWindowVisible($h)) { Write-Output "invisible"; exit }
if ([WinStatus]::IsIconic($h)) { Write-Output "minimized"; exit }

$rc = New-Object WinStatus+RECT
[WinStatus]::GetWindowRect($h, [ref]$rc) | Out-Null
$w = $rc.Right - $rc.Left
$hgt = $rc.Bottom - $rc.Top
if ($w -le 0 -or $hgt -le 0) { Write-Output "invisible"; exit }

Write-Output "ok|$($rc.Left),$($rc.Top),$($rc.Right),$($rc.Bottom)"
