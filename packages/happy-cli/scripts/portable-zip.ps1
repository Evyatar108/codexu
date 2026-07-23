[CmdletBinding(DefaultParameterSetName = 'Extract')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Create')]
    [Parameter(Mandatory = $true, ParameterSetName = 'Extract')]
    [string]$ArchivePath,

    [Parameter(Mandatory = $true, ParameterSetName = 'Extract')]
    [string]$ManifestPath,

    [Parameter(Mandatory = $true, ParameterSetName = 'Extract')]
    [string]$ExtractionRoot,

    [Parameter(Mandatory = $true, ParameterSetName = 'Create')]
    [switch]$Create,

    [Parameter(Mandatory = $true, ParameterSetName = 'Create')]
    [string]$PayloadRoot,

    [Parameter(Mandatory = $true, ParameterSetName = 'Create')]
    [string]$FileListPath,

    [Parameter(Mandatory = $true, ParameterSetName = 'Create')]
    [Parameter(Mandatory = $true, ParameterSetName = 'Extract')]
    [string]$ConfinementRoot,

    [Parameter(Mandatory = $true, ParameterSetName = 'Create')]
    [Parameter(Mandatory = $true, ParameterSetName = 'Extract')]
    [string]$ExpectedTimestampUtc,

    [Parameter(Mandatory = $true, ParameterSetName = 'Test')]
    [switch]$TestPaths
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Test-PathInside {
    param(
        [Parameter(Mandatory = $true)][string]$Candidate,
        [Parameter(Mandatory = $true)][string]$Root,
        [switch]$AllowRoot
    )
    $candidateFull = [IO.Path]::GetFullPath($Candidate).TrimEnd('\')
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    return ($AllowRoot -and $candidateFull.Equals($rootFull, [StringComparison]::OrdinalIgnoreCase)) -or
        $candidateFull.StartsWith($rootFull + '\', [StringComparison]::OrdinalIgnoreCase)
}

function Assert-SafeOwnedFilesystemPath {
    param(
        [Parameter(Mandatory = $true)][string]$TargetPath,
        [Parameter(Mandatory = $true)][string]$RootPath,
        [switch]$AllowRoot
    )
    $full = [IO.Path]::GetFullPath($TargetPath)
    $root = [IO.Path]::GetFullPath($RootPath)
    if (-not (Test-PathInside -Candidate $full -Root $root -AllowRoot:$AllowRoot)) {
        throw "Path escapes its confinement root: $full"
    }
    $volume = [IO.Path]::GetPathRoot($full)
    $current = $volume
    if (Test-Path -LiteralPath $current) {
        $item = Get-Item -Force -LiteralPath $current
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Reparse path component is forbidden: $current"
        }
    }
    foreach ($segment in $full.Substring($volume.Length).Split('\', [StringSplitOptions]::RemoveEmptyEntries)) {
        $current = Join-Path $current $segment
        if (-not (Test-Path -LiteralPath $current)) {
            break
        }
        $item = Get-Item -Force -LiteralPath $current
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Reparse path component is forbidden: $current"
        }
    }
    $existing = $full
    while (-not (Test-Path -LiteralPath $existing)) {
        $parent = [IO.Path]::GetDirectoryName($existing)
        if ([string]::IsNullOrEmpty($parent) -or $parent -eq $existing) {
            throw "Unable to resolve an existing parent for: $full"
        }
        $existing = $parent
    }
    $resolvedRoot = (Resolve-Path -LiteralPath $root).Path
    $resolvedExisting = (Resolve-Path -LiteralPath $existing).Path
    $suffix = $full.Substring($existing.TrimEnd('\').Length).TrimStart('\')
    $resolved = if ([string]::IsNullOrEmpty($suffix)) {
        $resolvedExisting
    } else {
        [IO.Path]::GetFullPath((Join-Path $resolvedExisting $suffix))
    }
    if (-not (Test-PathInside -Candidate $resolved -Root $resolvedRoot -AllowRoot:$AllowRoot)) {
        throw "Resolved path escapes its confinement root: $resolved"
    }
    return $full
}

function Assert-SafeZipPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$EntryName,
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [Collections.Generic.HashSet[string]]$Seen
    )

    if ([string]::IsNullOrWhiteSpace($EntryName) -or $EntryName.Contains('\')) {
        throw "ZIP entry has an empty name or backslash: $EntryName"
    }
    if ($EntryName.StartsWith('/') -or $EntryName.StartsWith('//') -or
        $EntryName -match '^[A-Za-z]:') {
        throw "ZIP entry is rooted: $EntryName"
    }
    $isDirectory = $EntryName.EndsWith('/')
    $segments = @($EntryName.Split('/'))
    if ($isDirectory) {
        $segments = @($segments[0..($segments.Count - 2)])
    }
    if ($segments.Count -eq 0) {
        throw "ZIP entry has no content path: $EntryName"
    }
    foreach ($segment in $segments) {
        if ([string]::IsNullOrEmpty($segment) -or $segment -eq '.' -or $segment -eq '..' -or
            $segment.Contains(':') -or $segment -match '[ .]$' -or
            $segment -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$') {
            throw "ZIP entry has an unsafe segment: $EntryName"
        }
    }
    if (-not $Seen.Add($EntryName)) {
        throw "ZIP entry collides case-insensitively: $EntryName"
    }
}

if ($TestPaths) {
    $accepted = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    Assert-SafeZipPath -EntryName 'payload/happy/dist/index.mjs' -Seen $accepted
    foreach ($unsafe in @(
        '../escape',
        '/rooted',
        '//server/share',
        'C:/drive',
        'payload/a:b',
        'payload//empty',
        'payload/./dot',
        'payload/../up',
        'payload/trailing. ',
        'payload/CON',
        'payload/lpt1.txt',
        'payload\backslash'
    )) {
        $failed = $false
        try {
            Assert-SafeZipPath -EntryName $unsafe -Seen (
                [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
            )
        } catch {
            $failed = $true
        }
        if (-not $failed) {
            throw "Unsafe ZIP path fixture was accepted: $unsafe"
        }
    }
    $duplicates = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    Assert-SafeZipPath -EntryName 'payload/A.txt' -Seen $duplicates
    $failed = $false
    try {
        Assert-SafeZipPath -EntryName 'payload/a.txt' -Seen $duplicates
    } catch {
        $failed = $true
    }
    if (-not $failed) {
        throw 'Case-colliding ZIP fixture was accepted.'
    }
    Write-Host 'PowerShell ZIP path fixtures passed.'
    return
}

if ($Create) {
    $ConfinementRoot = (Resolve-Path -LiteralPath $ConfinementRoot).Path
    $PayloadRoot = Assert-SafeOwnedFilesystemPath -TargetPath $PayloadRoot `
        -RootPath $ConfinementRoot
    $ArchivePath = Assert-SafeOwnedFilesystemPath -TargetPath $ArchivePath `
        -RootPath $ConfinementRoot
    $FileListPath = Assert-SafeOwnedFilesystemPath -TargetPath $FileListPath `
        -RootPath $ConfinementRoot
    $timestamp = [DateTimeOffset]::Parse(
        $ExpectedTimestampUtc,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AssumeUniversal
    ).ToUniversalTime()
    if ($timestamp.Year -lt 1980 -or $timestamp.Year -gt 2107) {
        throw "ZIP source timestamp is out of range: $ExpectedTimestampUtc"
    }
    $fileNames = @(Get-Content -LiteralPath $FileListPath | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_)
    })
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    if (Test-Path -LiteralPath $ArchivePath) {
        Remove-Item -Force -LiteralPath $ArchivePath
    }
    $archiveStream = [IO.File]::Open(
        $ArchivePath,
        [IO.FileMode]::CreateNew,
        [IO.FileAccess]::ReadWrite,
        [IO.FileShare]::None
    )
    try {
        $zip = [IO.Compression.ZipArchive]::new(
            $archiveStream,
            [IO.Compression.ZipArchiveMode]::Create,
            $false
        )
        try {
            foreach ($entryName in $fileNames) {
                Assert-SafeZipPath -EntryName $entryName -Seen $seen
                if (-not $entryName.StartsWith('payload/', [StringComparison]::Ordinal)) {
                    throw "ZIP file is outside payload/: $entryName"
                }
                $relativeSource = $entryName.Substring('payload/'.Length).Replace(
                    '/',
                    [IO.Path]::DirectorySeparatorChar
                )
                $sourcePath = [IO.Path]::GetFullPath((Join-Path $PayloadRoot $relativeSource))
                if (-not (Test-PathInside -Candidate $sourcePath -Root $PayloadRoot)) {
                    throw "ZIP source escapes payload root: $entryName"
                }
                $sourceItem = Get-Item -Force -LiteralPath $sourcePath
                if (($sourceItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
                    $sourceItem.PSIsContainer) {
                    throw "ZIP source is not a regular file: $entryName"
                }
                $entry = $zip.CreateEntry($entryName, [IO.Compression.CompressionLevel]::Optimal)
                $entry.LastWriteTime = $timestamp
                $entry.ExternalAttributes = 0
                $input = [IO.File]::Open(
                    $sourcePath,
                    [IO.FileMode]::Open,
                    [IO.FileAccess]::Read,
                    [IO.FileShare]::Read
                )
                try {
                    $output = $entry.Open()
                    try {
                        $input.CopyTo($output)
                    } finally {
                        $output.Dispose()
                    }
                } finally {
                    $input.Dispose()
                }
            }
        } finally {
            $zip.Dispose()
        }
    } finally {
        $archiveStream.Dispose()
    }
    Write-Host "Created reproducible ZIP with $($fileNames.Count) files."
    return
}

$ArchivePath = (Resolve-Path $ArchivePath).Path
$ManifestPath = (Resolve-Path $ManifestPath).Path
$ConfinementRoot = (Resolve-Path -LiteralPath $ConfinementRoot).Path
$ExtractionRoot = Assert-SafeOwnedFilesystemPath -TargetPath $ExtractionRoot `
    -RootPath $ConfinementRoot
$manifest = Get-Content -Raw $ManifestPath | ConvertFrom-Json
$expectedTimestamp = [DateTimeOffset]::Parse(
    $ExpectedTimestampUtc,
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal
).ToUniversalTime()
$declared = [Collections.Generic.Dictionary[string, object]]::new(
    [StringComparer]::OrdinalIgnoreCase
)
foreach ($file in $manifest.files) {
    if ($declared.ContainsKey($file.relativePath)) {
        throw "Manifest path collides case-insensitively: $($file.relativePath)"
    }
    $declared.Add($file.relativePath, $file)
}

if (Test-Path $ExtractionRoot) {
    Remove-Item -Recurse -Force $ExtractionRoot
}
New-Item -ItemType Directory -Force -Path $ExtractionRoot | Out-Null
$rootPrefix = $ExtractionRoot.TrimEnd('\') + '\'
$seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$fileCount = 0L
$expandedLength = 0L
$maxFiles = 100000L
$maxFileBytes = 1GB
$maxExpandedBytes = 4GB
$stream = [IO.File]::Open($ArchivePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
    $zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Read, $false)
    try {
        foreach ($entry in $zip.Entries) {
            Assert-SafeZipPath -EntryName $entry.FullName -Seen $seen
            $isDirectory = [string]::IsNullOrEmpty($entry.Name) -and $entry.FullName.EndsWith('/')
            $unixType = (($entry.ExternalAttributes -shr 16) -band 0xF000)
            $windowsAttributes = $entry.ExternalAttributes -band 0xFFFF
            if ($unixType -eq 0xA000 -or
                ($windowsAttributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "ZIP reparse/symlink entry is forbidden: $($entry.FullName)"
            }
            if ($isDirectory) {
                continue
            }
            if (-not $entry.FullName.StartsWith('payload/', [StringComparison]::Ordinal)) {
                throw "ZIP file is outside payload/: $($entry.FullName)"
            }
            # ZIP stores a timezone-free DOS wall clock. Treat its fields as UTC
            # rather than applying the verifier machine's local offset.
            $entryTimestamp = [DateTimeOffset]::new(
                [DateTime]::SpecifyKind($entry.LastWriteTime.DateTime, [DateTimeKind]::Utc)
            )
            if ([Math]::Abs(($entryTimestamp - $expectedTimestamp).TotalSeconds) -gt 1) {
                throw "ZIP entry timestamp is not normalized: $($entry.FullName)"
            }
            if ($entry.ExternalAttributes -ne $manifest.archive.entryExternalAttributes) {
                throw "ZIP entry metadata is not normalized: $($entry.FullName)"
            }
            if ($entry.Length -gt $maxFileBytes) {
                throw "ZIP entry exceeds the per-file limit: $($entry.FullName)"
            }
            $fileCount += 1
            $expandedLength += $entry.Length
            if ($fileCount -gt $maxFiles -or $expandedLength -gt $maxExpandedBytes) {
                throw 'ZIP expansion limits exceeded.'
            }
            if (-not $declared.ContainsKey($entry.FullName)) {
                throw "ZIP contains an undeclared file: $($entry.FullName)"
            }
            $expected = $declared[$entry.FullName]
            if ($expected.relativePath -cne $entry.FullName -or $expected.length -ne $entry.Length) {
                throw "ZIP entry identity or length mismatch: $($entry.FullName)"
            }
        }
        if ($fileCount -ne $manifest.archive.fileCount -or
            $fileCount -ne $declared.Count -or
            $expandedLength -ne $manifest.archive.expandedLength) {
            throw 'ZIP count or expanded length does not match the manifest.'
        }

        foreach ($entry in $zip.Entries) {
            $target = [IO.Path]::GetFullPath((Join-Path $ExtractionRoot $entry.FullName))
            if (-not $target.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
                throw "ZIP extraction escapes staging: $($entry.FullName)"
            }
            $isDirectory = [string]::IsNullOrEmpty($entry.Name) -and $entry.FullName.EndsWith('/')
            if ($isDirectory) {
                New-Item -ItemType Directory -Force -Path $target | Out-Null
                continue
            }
            New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($target)) | Out-Null
            $inputStream = $entry.Open()
            try {
                $outputStream = [IO.File]::Open(
                    $target,
                    [IO.FileMode]::CreateNew,
                    [IO.FileAccess]::Write,
                    [IO.FileShare]::None
                )
                try {
                    $inputStream.CopyTo($outputStream)
                } finally {
                    $outputStream.Dispose()
                }
            } finally {
                $inputStream.Dispose()
            }
        }
    } finally {
        $zip.Dispose()
    }
} finally {
    $stream.Dispose()
}

Write-Host "Safely extracted $fileCount files ($expandedLength bytes)."
