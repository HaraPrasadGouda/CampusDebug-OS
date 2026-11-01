Add-Type -AssemblyName System.Drawing
$root = 'C:\Users\LENOVO\Downloads\bput project - Current - Copy\public'
$src = "$root\brand_icon.png"

$fs = New-Object System.IO.FileStream $src, ([System.IO.FileMode]::Open), ([System.IO.FileAccess]::Read)
$bmp = New-Object System.Drawing.Bitmap $fs
$w = $bmp.Width; $h = $bmp.Height
$bd = $bmp.LockBits([System.Drawing.Rectangle]::new(0,0,$w,$h), [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$total = $w*$h
$bytes = New-Object byte[] ($total*4)
[System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $bytes, 0, $bytes.Length)

function Test-Light([byte[]]$arr, [int]$i) {
  $o = $i*4; $b=$arr[$o]; $g=$arr[$o+1]; $r=$arr[$o+2]
  $mn = [Math]::Min($r, [Math]::Min($g,$b))
  $mx = [Math]::Max($r, [Math]::Max($g,$b))
  return ($mn -gt 205 -and ($mx-$mn) -lt 18)
}

$visited = New-Object bool[] $total
$stack = New-Object 'System.Collections.Generic.Stack[int]'

for ($x=0; $x -lt $w; $x++) {
  foreach ($i in @($x, ($x + ($h-1)*$w))) {
    if (-not $visited[$i] -and (Test-Light $bytes $i)) { $visited[$i]=$true; $stack.Push($i) }
  }
}
for ($y=0; $y -lt $h; $y++) {
  foreach ($i in @(($y*$w), ($w-1 + $y*$w))) {
    if (-not $visited[$i] -and (Test-Light $bytes $i)) { $visited[$i]=$true; $stack.Push($i) }
  }
}

while ($stack.Count -gt 0) {
  $i = $stack.Pop()
  $x = $i % $w; $y = [Math]::Floor($i / $w)
  $cand = @()
  if ($x -gt 0) { $cand += ($i-1) }
  if ($x -lt ($w-1)) { $cand += ($i+1) }
  if ($y -gt 0) { $cand += ($i-$w) }
  if ($y -lt ($h-1)) { $cand += ($i+$w) }
  foreach ($n in $cand) {
    if (-not $visited[$n] -and (Test-Light $bytes $n)) { $visited[$n]=$true; $stack.Push($n) }
  }
}

$knocked = 0
for ($i=0; $i -lt $total; $i++) {
  if ($visited[$i]) { $bytes[$i*4+3] = 0; $knocked++ }
}

[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $bd.Scan0, $bytes.Length)
$bmp.UnlockBits($bd)
$fs.Dispose()

function Resize-Png($srcImg, $dst, $size) {
  $b = New-Object System.Drawing.Bitmap $size,$size,([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($b)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.SmoothingMode = 'HighQuality'
  $g.DrawImage($srcImg, 0, 0, $size, $size)
  $g.Dispose()
  $b.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
  $b.Dispose()
}

# resized outputs write directly to new files (srcImg is in-memory, no file lock)
Resize-Png $bmp "$root\brand_icon_128.png" 128
Resize-Png $bmp "$root\brand_icon_sm.png" 64
Resize-Png $bmp "$root\logo512.png" 512
Resize-Png $bmp "$root\logo192.png" 192

# master: save to memory stream, write via temp, replace
$mem = New-Object System.IO.MemoryStream
$bmp.Save($mem, [System.Drawing.Imaging.ImageFormat]::Png)
[System.IO.File]::WriteAllBytes("$env:TEMP\icon_master.png", $mem.ToArray())
$mem.Dispose()
$bmp.Dispose()
Copy-Item "$env:TEMP\icon_master.png" $src -Force

"Flood-fill cleared $knocked of $total pixels ($([Math]::Round($knocked*100/$total,1))%)"
foreach ($f in @('brand_icon.png','brand_icon_128.png','brand_icon_sm.png','logo192.png','logo512.png')) {
  "$f -> $((Get-Item "$root\$f").Length) bytes"
}
