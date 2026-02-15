# We source this file with -NoExit -File
$env:PATH = {{.WSHBINDIR_PWSH}} + "{{.PATHSEP}}" + $env:PATH

# Source dynamic script from wsh token
$slterm_swaptoken_output = wsh token $env:SLTERM_SWAPTOKEN pwsh 2>$null | Out-String
if ($slterm_swaptoken_output -and $slterm_swaptoken_output -ne "") {
    Invoke-Expression $slterm_swaptoken_output
}
Remove-Variable -Name slterm_swaptoken_output
Remove-Item Env:SLTERM_SWAPTOKEN

# Load Wave completions
wsh completion powershell | Out-String | Invoke-Expression

if ($PSVersionTable.PSVersion.Major -lt 7) {
    return  # skip OSC setup entirely
}

$Global:_SLTERM_SI_FIRSTPROMPT = $true

# shell integration
function Global:_slterm_si_blocked {
    # Check if we're in tmux or screen
    return ($env:TMUX -or $env:STY -or $env:TERM -like "tmux*" -or $env:TERM -like "screen*")
}

function Global:_slterm_si_osc7 {
    if (_slterm_si_blocked) { return }
    
    # Percent-encode the raw path as-is (handles UNC, drive letters, etc.)
    $encoded_pwd = [System.Uri]::EscapeDataString($PWD.Path)
    
    # OSC 7 - current directory
    Write-Host -NoNewline "`e]7;file://localhost/$encoded_pwd`a"
}

function Global:_slterm_si_prompt {
    if (_slterm_si_blocked) { return }
    
    if ($Global:_SLTERM_SI_FIRSTPROMPT) {
		# not sending uname
		       $shellversion = $PSVersionTable.PSVersion.ToString()
		       Write-Host -NoNewline "`e]16162;M;{`"shell`":`"pwsh`",`"shellversion`":`"$shellversion`",`"integration`":false}`a"
        $Global:_SLTERM_SI_FIRSTPROMPT = $false
    }
    
    _slterm_si_osc7
}

# Add the OSC 7 call to the prompt function
if (Test-Path Function:\prompt) {
    $global:_slterm_original_prompt = $function:prompt
    function Global:prompt {
        _slterm_si_prompt
        & $global:_slterm_original_prompt
    }
} else {
    function Global:prompt {
        _slterm_si_prompt
        "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) "
    }
}