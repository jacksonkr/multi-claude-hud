' Restart the Multi-Claude HUD, with no visible console window.
'
' Stops any overlay running from THIS checkout, then (re)starts the hub and the
' overlay. Safe to run any time:
'   - at login (nothing running yet) it simply starts both;
'   - double-clicked later it restarts the overlay cleanly.
'
' The Startup and Desktop shortcuts point here (via wscript.exe). Portable: it
' finds the repo root from its own location (<root>\scripts\restart-hud.vbs),
' so it needs no editing on another machine or checkout.

Set fso = CreateObject("Scripting.FileSystemObject")
scriptsDir = fso.GetParentFolderName(WScript.ScriptFullName)
root = fso.GetParentFolderName(scriptsDir)

Set wmi = GetObject("winmgmts:\\.\root\cimv2")

' Stop the overlay only. Its Electron binary lives under this repo
' (<root>\node_modules\electron\...\electron.exe), so its command line always
' contains "multi-claude-hud" — no other app matches. The hub is left running;
' the overlay reconnects to it on start, and the start below is a harmless no-op
' if a hub already owns the port.
For Each p In wmi.ExecQuery("Select ProcessId,CommandLine From Win32_Process Where Name='electron.exe'")
  If Not IsNull(p.CommandLine) Then
    If InStr(1, p.CommandLine, "multi-claude-hud", vbTextCompare) > 0 Then
      On Error Resume Next
      p.Terminate()
      On Error Goto 0
    End If
  End If
Next

' Let the killed overlay's window fully release before the fresh one appears.
WScript.Sleep 500

Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = root
' 0 = hidden window, False = don't wait. (A second hub start when one is already
' running just fails to bind its port and exits — no duplicate survives.)
sh.Run "cmd /c npm run hub", 0, False
sh.Run "cmd /c npm run overlay", 0, False
