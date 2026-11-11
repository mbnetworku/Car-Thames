<#
  Car Theme Studio - local web UI for building "variety theme" plugin APKs
  for Android car head units.

  Started by Start-ThemeStudio.bat (runs as Administrator).
  Serves http://localhost:8765/ and only listens on localhost.

  Works with Windows PowerShell 5.1 and PowerShell 7+.
#>
param(
    [int]$Port = 8765,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root      = Split-Path -Parent $MyInvocation.MyCommand.Path
$WebDir    = Join-Path $Root 'web'
$ToolsDir  = Join-Path $Root 'tools'
$WorkDir   = Join-Path $Root 'workspace'
$SrcDir    = Join-Path $WorkDir 'src'
$OutDir    = Join-Path $Root 'output'
$Template  = Join-Path $WorkDir 'template.apk'
$KeyStore  = Join-Path $WorkDir 'theme-release.jks'
$KeyPass   = Join-Path $WorkDir 'keystore.pass'
$OrigDir   = Join-Path $WorkDir 'originals'
$DesignFile = Join-Path $WorkDir 'designer.json'
$PluginPrefix = 'launcher.variety.theme.plugin.'
$LauncherApk = Join-Path $Root 'launcher\CarLauncher.apk'

$ApktoolUrl = 'https://github.com/iBotPeaches/Apktool/releases/download/v2.10.0/apktool_2.10.0.jar'
$SignerUrl  = 'https://github.com/patrickfav/uber-apk-signer/releases/download/v1.3.0/uber-apk-signer-1.3.0.jar'
$ApktoolJar = Join-Path $ToolsDir 'apktool.jar'
$SignerJar  = Join-Path $ToolsDir 'uber-apk-signer.jar'

foreach ($d in @($ToolsDir, $WorkDir, $OutDir)) { if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null } }

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# ---------------------------------------------------------------- helpers

function Write-Log([string]$msg) { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg) }

function Test-IsAdmin {
    try {
        $id = [Security.Principal.WindowsIdentity]::GetCurrent()
        return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch { return $false }
}

function Get-JavaExe {
    $cmd = Get-Command java -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @()
    foreach ($base in @("$env:ProgramFiles\Eclipse Adoptium", "$env:ProgramFiles\Java", "$env:ProgramFiles\Microsoft")) {
        if (Test-Path $base) { $candidates += Get-ChildItem $base -Recurse -Filter java.exe -ErrorAction SilentlyContinue }
    }
    if ($candidates.Count -gt 0) { return $candidates[0].FullName }
    return $null
}

function Get-KeytoolExe {
    $java = Get-JavaExe
    if (-not $java) { return $null }
    $kt = Join-Path (Split-Path $java) 'keytool.exe'
    if (Test-Path $kt) { return $kt }
    $cmd = Get-Command keytool -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Invoke-Native([string]$exe, [string[]]$argv) {
    # Runs a program and returns @{ code; output } without PowerShell stderr quirks.
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $exe
    $psi.Arguments = ($argv | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $errTask = $p.StandardError.ReadToEndAsync()
    $out = $p.StandardOutput.ReadToEnd()
    $p.WaitForExit()
    $all = ($out + "`n" + $errTask.Result) -split "`r?`n" | Where-Object { $_ -and $_ -notmatch '^Picked up JAVA_TOOL_OPTIONS' }
    return @{ code = $p.ExitCode; output = ($all -join "`n") }
}

function Invoke-Java([string[]]$argv) {
    $java = Get-JavaExe
    if (-not $java) { throw 'Java is not installed. Click "Install Java" first.' }
    return Invoke-Native $java $argv
}

function Get-SafePath([string]$rel) {
    # Resolve a path inside workspace\src and refuse anything that escapes it.
    if ([string]::IsNullOrWhiteSpace($rel)) { throw 'Missing path' }
    $sep = [IO.Path]::DirectorySeparatorChar
    $full = [IO.Path]::GetFullPath([IO.Path]::Combine($SrcDir, ($rel -replace '[\\/]', $sep)))
    $rootFull = [IO.Path]::GetFullPath($SrcDir).TrimEnd($sep) + $sep
    if (-not $full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) { throw 'Path outside workspace' }
    return $full
}

function Get-RelPath([string]$full) {
    $sep = [IO.Path]::DirectorySeparatorChar
    $rootFull = [IO.Path]::GetFullPath($SrcDir).TrimEnd($sep) + $sep
    return $full.Substring($rootFull.Length) -replace '\\', '/'
}

function Test-JsonText([string]$text) {
    # Validates JSON. Theme files use empty "" keys, which ConvertFrom-Json in PowerShell 5.1 rejects.
    $jd = 'System.Text.Json.JsonDocument' -as [type]
    if ($jd) { $doc = $jd::Parse($text); $doc.Dispose(); return }
    Add-Type -AssemblyName System.Web.Extensions
    $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $ser.MaxJsonLength = 67108864
    $null = $ser.DeserializeObject($text)
}

function Backup-Original([string]$full) {
    # Keep the first version of every file we overwrite, so effects (like opacity) can be re-applied or undone.
    $rel = Get-RelPath $full
    $dst = Join-Path $OrigDir $rel
    if ((Test-Path $full) -and -not (Test-Path $dst)) {
        $dir = Split-Path $dst
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Copy-Item $full $dst
    }
}

function Read-Text([string]$path) { [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8) }
function Write-Text([string]$path, [string]$text) { [IO.File]::WriteAllText($path, $text, $Utf8NoBom) }

# ---------------------------------------------------------------- theme info

function Get-ThemeInfo {
    if (-not (Test-Path (Join-Path $SrcDir 'AndroidManifest.xml'))) { return $null }
    $manifest = Read-Text (Join-Path $SrcDir 'AndroidManifest.xml')
    $info = [ordered]@{ package = ''; suffix = ''; themeId = ''; oemId = ''; themeName = ''; versionCode = ''; versionName = '' }
    if ($manifest -match 'package="([^"]+)"') { $info.package = $Matches[1] }
    if ($info.package.StartsWith($PluginPrefix)) { $info.suffix = $info.package.Substring($PluginPrefix.Length) }
    $cfg = Join-Path $SrcDir 'assets\import_theme_info_config.json'
    if (Test-Path $cfg) {
        $t = Read-Text $cfg
        if ($t -match '"themeId"\s*:\s*"([^"]*)"') { $info.themeId = $Matches[1] }
        if ($t -match '"oemId"\s*:\s*"([^"]*)"')   { $info.oemId = $Matches[1] }
    }
    $strings = Join-Path $SrcDir 'res\values\strings.xml'
    if (Test-Path $strings) {
        if ((Read-Text $strings) -match '<string name="theme_name">([^<]*)</string>') { $info.themeName = $Matches[1] }
    }
    $yml = Join-Path $SrcDir 'apktool.yml'
    if (Test-Path $yml) {
        $y = Read-Text $yml
        if ($y -match "versionCode:\s*'?(\d+)") { $info.versionCode = $Matches[1] }
        if ($y -match "versionName:\s*(\S+)")   { $info.versionName = $Matches[1] }
    }
    return $info
}

function Set-ThemeIdentity($suffix, $themeName, $themeId, $versionCode, $versionName) {
    if ($suffix -notmatch '^[a-z][a-z0-9_]{1,40}$') { throw 'Theme ID name must be lowercase letters, digits or _ (start with a letter).' }
    $mf = Join-Path $SrcDir 'AndroidManifest.xml'
    $m = Read-Text $mf
    $m = [regex]::Replace($m, 'package="[^"]+"', "package=""$PluginPrefix$suffix""")
    $m = [regex]::Replace($m, '(android:name="launcher\.variety\.theme\.plugin"\s+android:value=")[^"]*(")', "`${1}$suffix`${2}")
    Write-Text $mf $m

    if ($themeId) {
        if ($themeId -notmatch '^\d{6,20}$') { throw 'Theme number must be digits only (e.g. 20261111000001).' }
        $cfg = Join-Path $SrcDir 'assets\import_theme_info_config.json'
        if (Test-Path $cfg) {
            $t = Read-Text $cfg
            $t = [regex]::Replace($t, '("themeId"\s*:\s*")[^"]*(")', "`${1}$themeId`${2}")
            Write-Text $cfg $t
        }
    }

    if ($themeName) {
        $safe = [Security.SecurityElement]::Escape($themeName)
        Get-ChildItem (Join-Path $SrcDir 'res') -Directory -Filter 'values*' | ForEach-Object {
            $s = Join-Path $_.FullName 'strings.xml'
            if (Test-Path $s) {
                $t = Read-Text $s
                if ($t -match 'name="theme_name"') {
                    $t = [regex]::Replace($t, '(<string name="theme_name">)[^<]*(</string>)', "`${1}$safe`${2}")
                    Write-Text $s $t
                }
            }
        }
    }

    $yml = Join-Path $SrcDir 'apktool.yml'
    $y = Read-Text $yml
    if ($versionCode) {
        if ($versionCode -notmatch '^\d{1,9}$') { throw 'Version code must be a number.' }
        $y = [regex]::Replace($y, "versionCode:\s*'?\d+'?", "versionCode: $versionCode")
    }
    if ($versionName) {
        if ($versionName -notmatch '^[A-Za-z0-9._-]{1,40}$') { throw 'Version name may contain letters, digits, . _ -' }
        $y = [regex]::Replace($y, 'versionName:\s*\S+', "versionName: $versionName")
    }
    Write-Text $yml $y
}

# ---------------------------------------------------------------- actions

function Install-Tools {
    $log = @()
    if (-not (Test-Path $ApktoolJar)) { $log += 'Downloading apktool...'; Invoke-WebRequest -Uri $ApktoolUrl -OutFile $ApktoolJar -UseBasicParsing }
    if (-not (Test-Path $SignerJar))  { $log += 'Downloading uber-apk-signer...'; Invoke-WebRequest -Uri $SignerUrl -OutFile $SignerJar -UseBasicParsing }
    $log += 'Tools ready.'
    return ($log -join "`n")
}

function Install-Java {
    if (Get-JavaExe) { return 'Java is already installed.' }
    if (-not (Test-IsAdmin)) { throw 'Installing Java needs Administrator. Start the tool with Start-ThemeStudio.bat.' }
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) { throw 'winget not found. Install Java 17 manually from https://adoptium.net and restart the tool.' }
    $r = Invoke-Native $winget.Source @('install', '--id', 'EclipseAdoptium.Temurin.17.JDK', '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--scope', 'machine')
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    return $r.output + "`nDone. If Java is still not detected, restart the tool."
}

function Import-Template([byte[]]$bytes) {
    if ($bytes.Length -lt 4 -or $bytes[0] -ne 0x50 -or $bytes[1] -ne 0x4B) { throw 'That file is not an APK (zip).' }
    [IO.File]::WriteAllBytes($Template, $bytes)
    if (-not (Test-Path $ApktoolJar)) { Install-Tools | Out-Null }
    if (Test-Path $SrcDir) { Remove-Item $SrcDir -Recurse -Force }
    if (Test-Path $OrigDir) { Remove-Item $OrigDir -Recurse -Force }
    if (Test-Path $DesignFile) { Remove-Item $DesignFile -Force }
    $r = Invoke-Java @('-jar', $ApktoolJar, 'd', '-f', '-o', $SrcDir, $Template)
    if ($r.code -ne 0) { throw "apktool decode failed:`n$($r.output)" }
    if (-not (Test-Path (Join-Path $SrcDir 'assets\import_theme_info_config.json'))) {
        $r.output += "`nWARNING: this APK has no import_theme_info_config.json - it may not be a variety theme plugin."
    }
    return $r.output
}

function Initialize-KeyStore {
    if (Test-Path $KeyStore) { return }
    $kt = Get-KeytoolExe
    if (-not $kt) { throw 'keytool not found (it comes with the Java JDK).' }
    $pass = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 20 | ForEach-Object { [char]$_ })
    Write-Text $KeyPass $pass
    $r = Invoke-Native $kt @('-genkeypair', '-keystore', $KeyStore, '-alias', 'cartheme', '-keyalg', 'RSA', '-keysize', '2048',
        '-validity', '10000', '-storepass', $pass, '-keypass', $pass, '-dname', 'CN=Car Theme Studio, O=Local, C=US')
    if ($r.code -ne 0) { throw "keytool failed:`n$($r.output)" }
}

function Build-Theme($body) {
    if (-not (Test-Path (Join-Path $SrcDir 'AndroidManifest.xml'))) { throw 'Load a template APK first.' }
    if (-not (Test-Path $ApktoolJar) -or -not (Test-Path $SignerJar)) { Install-Tools | Out-Null }
    Set-ThemeIdentity $body.suffix $body.themeName $body.themeId $body.versionCode $body.versionName

    $log = @()
    $unsigned = Join-Path $WorkDir 'unsigned.apk'
    if (Test-Path $unsigned) { Remove-Item $unsigned -Force }
    $r = Invoke-Java @('-jar', $ApktoolJar, 'b', $SrcDir, '-o', $unsigned)
    $log += $r.output
    if ($r.code -ne 0 -or -not (Test-Path $unsigned)) { throw "Build failed:`n$($log -join "`n")" }

    Initialize-KeyStore
    $pass = (Read-Text $KeyPass).Trim()
    $signDir = Join-Path $WorkDir 'signed'
    if (Test-Path $signDir) { Remove-Item $signDir -Recurse -Force }
    $r = Invoke-Java @('-jar', $SignerJar, '-a', $unsigned, '-o', $signDir, '--ks', $KeyStore, '--ksAlias', 'cartheme', '--ksPass', $pass, '--ksKeyPass', $pass)
    $log += $r.output
    $signed = Get-ChildItem $signDir -Filter '*.apk' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($r.code -ne 0 -or -not $signed) { throw "Signing failed:`n$($log -join "`n")" }

    $name = '{0}_{1}.apk' -f $body.suffix, (Get-Date -Format 'yyyyMMdd_HHmmss')
    Move-Item $signed.FullName (Join-Path $OutDir $name) -Force
    $log += "OK: output\$name"
    return @{ file = $name; log = ($log -join "`n") }
}

function Get-ImageList {
    if (-not (Test-Path $SrcDir)) { return @() }
    $items = foreach ($top in @('res', 'assets')) {
        $p = Join-Path $SrcDir $top
        if (Test-Path $p) {
            Get-ChildItem $p -Recurse -File -Include *.png, *.jpg, *.jpeg, *.webp | ForEach-Object {
                [ordered]@{ path = (Get-RelPath $_.FullName); size = $_.Length }
            }
        }
    }
    return @($items)
}

function Get-JsonList {
    $p = Join-Path $SrcDir 'assets'
    if (-not (Test-Path $p)) { return @() }
    return @(Get-ChildItem $p -Recurse -File -Filter *.json | ForEach-Object { Get-RelPath $_.FullName })
}

function Get-AdbExe {
    $cmd = Get-Command adb -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $local = Join-Path $ToolsDir 'platform-tools\adb.exe'
    if (Test-Path $local) { return $local }
    return $null
}

function Install-ToCar([string]$file) {
    $adb = Get-AdbExe
    if (-not $adb) { throw 'adb not found. Install Android platform-tools or put them in windows\tools\platform-tools.' }
    if ($file -eq '@launcher') { $apk = $LauncherApk } else { $apk = Join-Path $OutDir ([IO.Path]::GetFileName($file)) }
    if (-not (Test-Path $apk)) { throw 'APK not found.' }
    $r = Invoke-Native $adb @('install', '-r', $apk)
    return $r.output
}

# ---------------------------------------------------------------- http

function Send-Response($ctx, [int]$status, [byte[]]$bytes, [string]$type) {
    $res = $ctx.Response
    $res.StatusCode = $status
    $res.ContentType = $type
    $res.Headers.Add('Cache-Control', 'no-store')
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.OutputStream.Close()
}

function Send-Json($ctx, $obj, [int]$status = 200) {
    $json = ConvertTo-Json -InputObject $obj -Depth 6 -Compress
    Send-Response $ctx $status ([Text.Encoding]::UTF8.GetBytes($json)) 'application/json; charset=utf-8'
}

function Read-BodyBytes($req) {
    $ms = New-Object IO.MemoryStream
    $req.InputStream.CopyTo($ms)
    return $ms.ToArray()
}

function Read-BodyJson($req) {
    $text = [Text.Encoding]::UTF8.GetString((Read-BodyBytes $req))
    if ([string]::IsNullOrWhiteSpace($text)) { return @{} }
    return ConvertFrom-Json $text
}

$MimeTypes = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript'; '.css' = 'text/css'; '.png' = 'image/png';
                '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.webp' = 'image/webp'; '.json' = 'application/json'; '.apk' = 'application/vnd.android.package-archive' }

function Invoke-Route($ctx) {
    $req = $ctx.Request
    $path = $req.Url.AbsolutePath
    $q = $req.QueryString
    $method = $req.HttpMethod

    # Simple CSRF guard: API writes must come from our own page.
    if ($method -eq 'POST') {
        $origin = $req.Headers['Origin']
        if ($origin -and $origin -ne "http://localhost:$Port" -and $origin -ne "http://127.0.0.1:$Port") { Send-Json $ctx @{ error = 'Forbidden origin' } 403; return }
    }

    switch -Regex ($path) {
        '^/$' {
            Send-Response $ctx 200 ([IO.File]::ReadAllBytes((Join-Path $WebDir 'index.html'))) $MimeTypes['.html']; return
        }
        '^/api/status$' {
            Send-Json $ctx ([ordered]@{
                admin = (Test-IsAdmin); java = [bool](Get-JavaExe); adb = [bool](Get-AdbExe)
                tools = ((Test-Path $ApktoolJar) -and (Test-Path $SignerJar)); template = (Test-Path $Template)
                launcher = (Test-Path $LauncherApk)
                info = (Get-ThemeInfo); outputs = @(Get-ChildItem $OutDir -Filter *.apk -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | ForEach-Object { $_.Name })
            }); return
        }
        '^/api/install-java$'  { Send-Json $ctx @{ log = (Install-Java) }; return }
        '^/api/install-tools$' { Send-Json $ctx @{ log = (Install-Tools) }; return }
        '^/api/template$' {
            if ($method -ne 'POST') { break }
            Send-Json $ctx @{ log = (Import-Template (Read-BodyBytes $req)); info = (Get-ThemeInfo) }; return
        }
        '^/api/images$' { Send-Json $ctx @(Get-ImageList); return }
        '^/api/jsons$'  { Send-Json $ctx @(Get-JsonList); return }
        '^/api/file$' {
            $full = Get-SafePath $q['path']
            $ext = [IO.Path]::GetExtension($full).ToLower()
            if ($method -eq 'POST') {
                # Optional "replace": the file being superseded (same folder and name, other extension, e.g. jpg -> png).
                $old = $null
                if ($q['replace']) {
                    $old = Get-SafePath $q['replace']
                    if ((Split-Path $old) -ne (Split-Path $full) -or
                        [IO.Path]::GetFileNameWithoutExtension($old) -ne [IO.Path]::GetFileNameWithoutExtension($full)) { throw 'replace must be the same image with another extension' }
                    if (-not (Test-Path $old)) { $old = $null }
                }
                if (-not (Test-Path $full) -and -not $old) { throw 'File does not exist' }
                $bytes = Read-BodyBytes $req
                if ($ext -eq '.json') {
                    $text = [Text.Encoding]::UTF8.GetString($bytes)
                    try { Test-JsonText $text } catch { throw "Invalid JSON: $($_.Exception.Message)" }
                    Backup-Original $full
                    Write-Text $full $text
                } elseif ($MimeTypes.ContainsKey($ext) -and $ext -ne '.apk') {
                    Backup-Original $full
                    if ($old -and $old -ne $full) { Backup-Original $old; Remove-Item $old -Force }
                    [IO.File]::WriteAllBytes($full, $bytes)
                } else { throw 'Only images and JSON can be replaced.' }
                Send-Json $ctx @{ ok = $true }; return
            }
            if (-not (Test-Path $full)) { Send-Json $ctx @{ error = 'Not found' } 404; return }
            $type = $MimeTypes[$ext]; if (-not $type) { $type = 'application/octet-stream' }
            Send-Response $ctx 200 ([IO.File]::ReadAllBytes($full)) $type; return
        }
        '^/api/original$' {
            # The untouched version of a file (falls back to the current one).
            $cur = Get-SafePath $q['path']
            $orig = Join-Path $OrigDir (Get-RelPath $cur)
            $f = if (Test-Path $orig) { $orig } elseif (Test-Path $cur) { $cur } else { $null }
            if (-not $f) { Send-Json $ctx @{ error = 'Not found' } 404; return }
            $type = $MimeTypes[[IO.Path]::GetExtension($f).ToLower()]; if (-not $type) { $type = 'application/octet-stream' }
            Send-Response $ctx 200 ([IO.File]::ReadAllBytes($f)) $type; return
        }
        '^/api/designer$' {
            # Designer settings (opacity per image, preview apps). Stored only in the workspace, not in the APK.
            if ($method -eq 'POST') {
                $text = [Text.Encoding]::UTF8.GetString((Read-BodyBytes $req))
                Test-JsonText $text
                Write-Text $DesignFile $text
                Send-Json $ctx @{ ok = $true }; return
            }
            $t = if (Test-Path $DesignFile) { Read-Text $DesignFile } else { '{}' }
            Send-Response $ctx 200 ([Text.Encoding]::UTF8.GetBytes($t)) 'application/json; charset=utf-8'; return
        }
        '^/(designer\.js)$' {
            Send-Response $ctx 200 ([IO.File]::ReadAllBytes((Join-Path $WebDir $Matches[1]))) 'text/javascript; charset=utf-8'; return
        }
        '^/api/build$' {
            if ($method -ne 'POST') { break }
            Send-Json $ctx (Build-Theme (Read-BodyJson $req)); return
        }
        '^/api/download$' {
            $name = [IO.Path]::GetFileName($q['name'])
            $f = Join-Path $OutDir $name
            if (-not (Test-Path $f)) { Send-Json $ctx @{ error = 'Not found' } 404; return }
            $ctx.Response.Headers.Add('Content-Disposition', "attachment; filename=""$name""")
            Send-Response $ctx 200 ([IO.File]::ReadAllBytes($f)) $MimeTypes['.apk']; return
        }
        '^/api/launcher$' {
            if (-not (Test-Path $LauncherApk)) { Send-Json $ctx @{ error = 'CarLauncher.apk is missing from windows\launcher' } 404; return }
            $ctx.Response.Headers.Add('Content-Disposition', 'attachment; filename="CarLauncher.apk"')
            Send-Response $ctx 200 ([IO.File]::ReadAllBytes($LauncherApk)) $MimeTypes['.apk']; return
        }
        '^/api/open-output$' { Start-Process explorer.exe $OutDir; Send-Json $ctx @{ ok = $true }; return }
        '^/api/adb-install$' {
            if ($method -ne 'POST') { break }
            $b = Read-BodyJson $req
            Send-Json $ctx @{ log = (Install-ToCar $b.file) }; return
        }
    }
    Send-Json $ctx @{ error = 'Not found' } 404
}

# ---------------------------------------------------------------- main

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
try { $listener.Start() } catch { Write-Host "Could not start on port $Port : $($_.Exception.Message)" -ForegroundColor Red; Read-Host 'Press Enter to exit'; exit 1 }

$url = "http://localhost:$Port/"
Write-Host ''
Write-Host '  Car Theme Studio is running' -ForegroundColor Green
Write-Host "  Open: $url"
Write-Host "  Administrator: $(Test-IsAdmin)"
Write-Host '  Close this window (or press Ctrl+C) to stop.'
Write-Host ''
if (-not $NoBrowser) { Start-Process $url }

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        try {
            Write-Log "$($ctx.Request.HttpMethod) $($ctx.Request.Url.PathAndQuery)"
            Invoke-Route $ctx
        } catch {
            Write-Log "ERROR: $($_.Exception.Message)"
            try { Send-Json $ctx @{ error = $_.Exception.Message } 500 } catch {}
        }
    }
} finally {
    $listener.Stop()
}
