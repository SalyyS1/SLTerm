# Remove the pre-rename per-user install before installing SL-ADE. Both builds
# use the legacy profile alias during this release, so leaving both installed
# would leave two shortcuts competing for the same data-dir lock.
!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $0 HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SLTerm" "UninstallString"
  StrCmp $0 "" check_machine
  Goto ask_uninstall

check_machine:
  ReadRegStr $0 HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SLTerm" "UninstallString"
  StrCmp $0 "" done

ask_uninstall:
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "SLTerm is still installed. Remove it before installing SL-ADE?" \
    IDYES uninstall IDNO abort_install
  Goto done

uninstall:
  ExecWait '$0 /S' $1
  IntCmp $1 0 done uninstall_failed uninstall_failed

uninstall_failed:
  MessageBox MB_OK|MB_ICONSTOP \
    "SLTerm could not be removed. Cancel this installation and uninstall SLTerm manually."
  Abort

abort_install:
  Abort

done:
!macroend
