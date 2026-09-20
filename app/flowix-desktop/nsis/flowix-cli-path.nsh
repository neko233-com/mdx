!define FLOWIX_CLI_BIN_DIR "$LOCALAPPDATA\Flowix\bin"
!define FLOWIX_CLI_SHIM "${FLOWIX_CLI_BIN_DIR}\flowix.cmd"
!define FLOWIX_LEGACY_CLI_SHIM "${FLOWIX_CLI_BIN_DIR}\flowix-cli.cmd"

!macro FLOWIX_BROADCAST_ENVIRONMENT_CHANGE
  System::Call 'user32::SendMessageTimeout(i 0xffff, i 0x001A, i 0, t "Environment", i 0, i 5000, *i .r0)'
!macroend

!macro FLOWIX_ADD_CLI_TO_USER_PATH
  ; Preserve existing user PATH entries and append only the Flowix CLI directory.
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
    ${If} $3 == "${FLOWIX_CLI_BIN_DIR}"
      StrCpy $1 1
      ${ExitDo}
    ${EndIf}
    IntOp $2 $2 + 1
  ${Loop}

  ${If} $1 == 0
    ${If} $0 == ""
      StrCpy $0 "${FLOWIX_CLI_BIN_DIR}"
    ${Else}
      StrCpy $0 "$0;${FLOWIX_CLI_BIN_DIR}"
    ${EndIf}
    WriteRegExpandStr HKCU "Environment" "Path" "$0"
    !insertmacro FLOWIX_BROADCAST_ENVIRONMENT_CHANGE
  ${EndIf}
!macroend

!macro FLOWIX_STOP_BUNDLED_CLI
  ; The updater normally stops flowix-cli in the desktop process before it
  ; launches NSIS. This hook is the authoritative fallback for manual
  ; installer launches and for CLI processes restarted by an MCP supervisor.
  ; Match the full executable path so another application's flowix-cli.exe is
  ; never terminated.
  FileOpen $0 "$PLUGINSDIR\flowix-stop-cli.ps1" w
  ${If} $0 == ""
    MessageBox MB_ICONSTOP|MB_OK "Flowix could not prepare the CLI shutdown script."
    Abort
  ${EndIf}
  FileWrite $0 "$$ErrorActionPreference = 'Stop'$\r$\n"
  FileWrite $0 "try {$\r$\n"
  FileWrite $0 "  $$target = [IO.Path]::GetFullPath($$args[0])$\r$\n"
  FileWrite $0 "  function Get-FlowixCliProcesses {$\r$\n"
  FileWrite $0 "    Get-CimInstance Win32_Process | Where-Object { $$_.Name -ieq 'flowix-cli.exe' -and $$_.ExecutablePath -and ([IO.Path]::GetFullPath($$_.ExecutablePath) -ieq $$target) }$\r$\n"
  FileWrite $0 "  }$\r$\n"
  FileWrite $0 "  function Get-FlowixCliSupervisors {$\r$\n"
  FileWrite $0 "    $$result = @()$\r$\n"
  FileWrite $0 "    foreach ($$cli in @(Get-FlowixCliProcesses)) {$\r$\n"
  FileWrite $0 "      $$parentId = $$cli.ParentProcessId$\r$\n"
  FileWrite $0 "      for ($$level = 0; $$level -lt 8 -and $$parentId -gt 0; $$level++) {$\r$\n"
  FileWrite $0 "        $$parent = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $$parentId)$\r$\n"
  FileWrite $0 "        if ($$null -eq $$parent) { break }$\r$\n"
  FileWrite $0 "        $$isFlowixSupervisor = $$parent.Name -ieq 'node.exe' -and (($$parent.CommandLine -match '(?i)dsh-flowix-memory' -and $$parent.CommandLine -match '(?i)launcher' -and $$parent.CommandLine -match '(?i)flowix') -or ($$parent.CommandLine -match '(?i)--profile' -and $$parent.CommandLine -match '(?i)flowix'))$\r$\n"
  FileWrite $0 "        if (-not $$isFlowixSupervisor) { break }$\r$\n"
  FileWrite $0 "        $$result += $$parent$\r$\n"
  FileWrite $0 "        $$parentId = $$parent.ParentProcessId$\r$\n"
  FileWrite $0 "      }$\r$\n"
  FileWrite $0 "    }$\r$\n"
  FileWrite $0 "    @($$result | Sort-Object ProcessId -Unique)$\r$\n"
  FileWrite $0 "  }$\r$\n"
  FileWrite $0 "  function Test-FlowixCliWritable {$\r$\n"
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
  FileWrite $0 "    $$processes = @(Get-FlowixCliProcesses)$\r$\n"
  FileWrite $0 "    $$supervisors = @(Get-FlowixCliSupervisors)$\r$\n"
  FileWrite $0 "    foreach ($$process in $$processes) { Stop-Process -Id $$process.ProcessId -Force -ErrorAction SilentlyContinue }$\r$\n"
  FileWrite $0 "    foreach ($$supervisor in $$supervisors) { Stop-Process -Id $$supervisor.ProcessId -Force -ErrorAction SilentlyContinue }$\r$\n"
  FileWrite $0 "    Start-Sleep -Milliseconds 100$\r$\n"
  FileWrite $0 "    if (@(Get-FlowixCliProcesses).Count -eq 0 -and (Test-FlowixCliWritable)) { exit 0 }$\r$\n"
  FileWrite $0 "  }$\r$\n"
  FileWrite $0 "  exit 1$\r$\n"
  FileWrite $0 "} catch { exit 1 }$\r$\n"
  FileClose $0
  ; Use NSIS' built-in synchronous runner so the helper's exit code cannot be
  ; confused with captured stdout or an nsExec stack value.
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\flowix-stop-cli.ps1" "$INSTDIR\flowix-cli.exe"' $1 SW_HIDE
  Delete "$PLUGINSDIR\flowix-stop-cli.ps1"
  ${If} $1 == "error"
    MessageBox MB_ICONSTOP|MB_OK "Flowix could not start the CLI shutdown helper. Close Flowix CLI and try the update again."
    Abort
  ${ElseIf} $1 != 0
    MessageBox MB_ICONSTOP|MB_OK "Flowix CLI is still running. Close Flowix CLI and try the update again."
    Abort
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro FLOWIX_STOP_BUNDLED_CLI
!macroend

!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "${FLOWIX_CLI_BIN_DIR}"
  Delete "${FLOWIX_LEGACY_CLI_SHIM}"
  FileOpen $0 "${FLOWIX_CLI_SHIM}" w
  ${If} $0 != ""
    FileWrite $0 "@echo off$\r$\n"
    FileWrite $0 "$\"$INSTDIR\flowix-cli.exe$\" %*$\r$\n"
    FileClose $0
  ${EndIf}
  !insertmacro FLOWIX_ADD_CLI_TO_USER_PATH
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Only remove files created by the Flowix CLI shim. Do not modify the
  ; user's HKCU\Environment\Path during product uninstall.
  Delete "${FLOWIX_CLI_SHIM}"
  Delete "${FLOWIX_LEGACY_CLI_SHIM}"
  RMDir "${FLOWIX_CLI_BIN_DIR}"
!macroend
