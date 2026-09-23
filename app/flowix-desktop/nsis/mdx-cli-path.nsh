!define MDX_CLI_BIN_DIR "$LOCALAPPDATA\MDX\bin"
!define MDX_CLI_SHIM "${MDX_CLI_BIN_DIR}\mdx.cmd"
!define MDX_LEGACY_CLI_SHIM "${MDX_CLI_BIN_DIR}\mdx-cli.cmd"

!macro MDX_BROADCAST_ENVIRONMENT_CHANGE
  System::Call 'user32::SendMessageTimeout(i 0xffff, i 0x001A, i 0, t "Environment", i 0, i 5000, *i .r0)'
!macroend

!macro MDX_ADD_CLI_TO_USER_PATH
  ; Preserve existing user PATH entries and append only the MDX CLI directory.
  ReadRegStr $0 HKCU "Environment" "Path"
  StrCpy $1 0
  StrCpy $2 1
  ; WordFind indexes PATH entries from 1. A trailing delimiter makes a PATH
  ; containing a single entry participate in the same merge logic.
  StrCpy $4 "$0;"

  ${Do}
    ClearErrors
    ${WordFind} "$4" ";" "E+$2" $3
    ${If} ${Errors}
      ${ExitDo}
    ${EndIf}
    ${If} $3 == "${MDX_CLI_BIN_DIR}"
      StrCpy $1 1
      ${ExitDo}
    ${EndIf}
    IntOp $2 $2 + 1
  ${Loop}

  ${If} $1 == 0
    ${If} $0 == ""
      StrCpy $0 "${MDX_CLI_BIN_DIR}"
    ${Else}
      StrCpy $0 "$0;${MDX_CLI_BIN_DIR}"
    ${EndIf}
    WriteRegExpandStr HKCU "Environment" "Path" "$0"
    !insertmacro MDX_BROADCAST_ENVIRONMENT_CHANGE
  ${EndIf}
!macroend

!macro MDX_STOP_BUNDLED_CLI
  ; The updater normally stops mdx-cli in the desktop process before it
  ; launches NSIS. This hook is the authoritative fallback for manual
  ; installer launches and for CLI processes restarted by an MCP supervisor.
  ; Match the full executable path so another application's mdx-cli.exe is
  ; never terminated.
  FileOpen $0 "$PLUGINSDIR\mdx-stop-cli.ps1" w
  ${If} $0 == ""
    MessageBox MB_ICONSTOP|MB_OK "MDX could not prepare the CLI shutdown script."
    Abort
  ${EndIf}
  FileWrite $0 "$$ErrorActionPreference = 'Stop'$\r$\n"
  FileWrite $0 "try {$\r$\n"
  FileWrite $0 "  $$target = [IO.Path]::GetFullPath($$args[0])$\r$\n"
  FileWrite $0 "  function Get-MDXCliProcesses {$\r$\n"
  FileWrite $0 "    Get-CimInstance Win32_Process | Where-Object { $$_.Name -ieq 'mdx-cli.exe' -and $$_.ExecutablePath -and ([IO.Path]::GetFullPath($$_.ExecutablePath) -ieq $$target) }$\r$\n"
  FileWrite $0 "  }$\r$\n"
  FileWrite $0 "  function Get-MDXCliSupervisors {$\r$\n"
  FileWrite $0 "    $$result = @()$\r$\n"
  FileWrite $0 "    foreach ($$cli in @(Get-MDXCliProcesses)) {$\r$\n"
  FileWrite $0 "      $$parentId = $$cli.ParentProcessId$\r$\n"
  FileWrite $0 "      for ($$level = 0; $$level -lt 8 -and $$parentId -gt 0; $$level++) {$\r$\n"
  FileWrite $0 "        $$parent = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $$parentId)$\r$\n"
  FileWrite $0 "        if ($$null -eq $$parent) { break }$\r$\n"
  FileWrite $0 "        $$isMDXSupervisor = $$parent.Name -ieq 'node.exe' -and (($$parent.CommandLine -match '(?i)dsh-mdx-memory' -and $$parent.CommandLine -match '(?i)launcher' -and $$parent.CommandLine -match '(?i)mdx') -or ($$parent.CommandLine -match '(?i)--profile' -and $$parent.CommandLine -match '(?i)mdx'))$\r$\n"
  FileWrite $0 "        if (-not $$isMDXSupervisor) { break }$\r$\n"
  FileWrite $0 "        $$result += $$parent$\r$\n"
  FileWrite $0 "        $$parentId = $$parent.ParentProcessId$\r$\n"
  FileWrite $0 "      }$\r$\n"
  FileWrite $0 "    }$\r$\n"
  FileWrite $0 "    @($$result | Sort-Object ProcessId -Unique)$\r$\n"
  FileWrite $0 "  }$\r$\n"
  FileWrite $0 "  function Test-MDXCliWritable {$\r$\n"
  FileWrite $0 "    if (-not (Test-Path -LiteralPath $$target)) { return $$true }$\r$\n"
  FileWrite $0 "    $$stream = $$null$\r$\n"
  FileWrite $0 "    try {$\r$\n"
  FileWrite $0 "      $$stream = [IO.File]::Open($$target, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)$\r$\n"
  FileWrite $0 "      return $$true$\r$\n"
  FileWrite $0 "    } catch { return $$false } finally { if ($$null -ne $$stream) { $$stream.Dispose() } }$\r$\n"
  FileWrite $0 "  }$\r$\n"
  ; Give a supervisor enough time to observe the shutdown and stop respawning
  ; the product CLI, then wait until Windows releases the executable image.
  FileWrite $0 "  for ($$attempt = 0; $$attempt -lt 300; $$attempt++) {$\r$\n"
  FileWrite $0 "    $$processes = @(Get-MDXCliProcesses)$\r$\n"
  FileWrite $0 "    $$supervisors = @(Get-MDXCliSupervisors)$\r$\n"
  FileWrite $0 "    foreach ($$process in $$processes) { Stop-Process -Id $$process.ProcessId -Force -ErrorAction SilentlyContinue }$\r$\n"
  FileWrite $0 "    foreach ($$supervisor in $$supervisors) { Stop-Process -Id $$supervisor.ProcessId -Force -ErrorAction SilentlyContinue }$\r$\n"
  FileWrite $0 "    Start-Sleep -Milliseconds 100$\r$\n"
  FileWrite $0 "    if (@(Get-MDXCliProcesses).Count -eq 0 -and (Test-MDXCliWritable)) { exit 0 }$\r$\n"
  FileWrite $0 "  }$\r$\n"
  FileWrite $0 "  exit 1$\r$\n"
  FileWrite $0 "} catch { exit 1 }$\r$\n"
  FileClose $0
  ; nsExec runs the helper without creating a visible console window and
  ; ExecToLog returns the process exit code directly.
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\mdx-stop-cli.ps1" "$INSTDIR\mdx-cli.exe"'
  Pop $1
  Delete "$PLUGINSDIR\mdx-stop-cli.ps1"
  ${If} $1 == "error"
    MessageBox MB_ICONSTOP|MB_OK "MDX could not start the CLI shutdown helper. Close MDX CLI and try the update again."
    Abort
  ${ElseIf} $1 != 0
    MessageBox MB_ICONSTOP|MB_OK "MDX CLI is still running. Close MDX CLI and try the update again."
    Abort
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro MDX_STOP_BUNDLED_CLI
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Always refresh the same desktop shortcut, including GUI installs and
  ; updater installs. The executable owns the current MDX icon resource.
  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
  !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
  CreateDirectory "${MDX_CLI_BIN_DIR}"
  Delete "${MDX_LEGACY_CLI_SHIM}"
  FileOpen $0 "${MDX_CLI_SHIM}" w
  ${If} $0 != ""
    FileWrite $0 "@echo off$\r$\n"
    FileWrite $0 "$\"$INSTDIR\mdx-cli.exe$\" %*$\r$\n"
    FileClose $0
  ${EndIf}
  !insertmacro MDX_ADD_CLI_TO_USER_PATH
  ; Offer MDX in Windows Default apps without changing the user's existing
  ; .md/.markdown choice. Windows requires the user to confirm that choice.
  WriteRegStr HKCU "Software\MDX\Capabilities" "ApplicationName" "MDX"
  WriteRegStr HKCU "Software\MDX\Capabilities" "ApplicationDescription" "Markdown editor and viewer"
  WriteRegStr HKCU "Software\MDX\Capabilities" "ApplicationIcon" "$INSTDIR\MDX.exe,0"
  WriteRegStr HKCU "Software\MDX\Capabilities\FileAssociations" ".md" "MDX.Markdown"
  WriteRegStr HKCU "Software\MDX\Capabilities\FileAssociations" ".markdown" "MDX.Markdown"
  WriteRegStr HKCU "Software\RegisteredApplications" "MDX" "Software\MDX\Capabilities"
  WriteRegStr HKCU "Software\Classes\MDX.Markdown" "AppUserModelID" "com.neko233.mdx"
  ; Tauri's generated command omits quotes around the executable path.
  WriteRegStr HKCU "Software\Classes\MDX.Markdown\shell\open\command" "" '$\"$INSTDIR\MDX.exe$\" $\"%1$\"'
  ; Keep MDX available in Open with even when another editor owns UserChoice.
  WriteRegStr HKCU "Software\Classes\.md\OpenWithProgids" "MDX.Markdown" ""
  WriteRegStr HKCU "Software\Classes\.markdown\OpenWithProgids" "MDX.Markdown" ""
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1003, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Only remove files created by the MDX CLI shim. Do not modify the
  ; user's HKCU\Environment\Path during product uninstall.
  Delete "${MDX_CLI_SHIM}"
  Delete "${MDX_LEGACY_CLI_SHIM}"
  RMDir "${MDX_CLI_BIN_DIR}"
  DeleteRegValue HKCU "Software\RegisteredApplications" "MDX"
  DeleteRegValue HKCU "Software\Classes\MDX.Markdown" "AppUserModelID"
  DeleteRegValue HKCU "Software\Classes\.md\OpenWithProgids" "MDX.Markdown"
  DeleteRegValue HKCU "Software\Classes\.markdown\OpenWithProgids" "MDX.Markdown"
  DeleteRegKey HKCU "Software\MDX\Capabilities"
  DeleteRegKey /ifempty HKCU "Software\MDX"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1003, p 0, p 0)'
!macroend
