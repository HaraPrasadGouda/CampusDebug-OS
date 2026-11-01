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

# Erode light remnant ring: any light pixel adjacent (within 3px radius, anytime during 3 passes)
# to a fully transparent pixel becomes transparent too. Green artwork pixels have saturation so
# they survive; gray/white anti-alias rim pixels get nibbled away.
function Test-Lightish([byte[]]$arr, [int]$i) {
  $o = $i*4; $b=$arr[$o]; $g=$arr[$o+1]; $r=$arr[$o+2]; $a=$arr[$o+3]
  if ($a -eq 0) { return $false }
  $mn = [Math]::Min($r, [Math]::Min($g,$b))
  $mx = [Math]::Max($r, [Math]::Max($g,$b))
  return ($mn -gt 150 -and ($mx-$mn) -lt 55)
}
function Test-Transparent([byte[]]$arr, [int]$i) {
  return ($arr[$i*4+3] -eq 0)
}

for ($pass=0; $pass -lt 3; $pass++) {
  $toClear = New-Object 'System.Collections.Generic.List[int]'
  for ($i=0; $i -lt $total; $i++) {
    if (-not (Test-Lightish $bytes $i)) { continue }
    $x = $i % $w; $y = [Math]::Floor($i / $w)
    $touch = $false
    foreach ($d in @(-1, 1, -$w, $w)) {
      $n = $i + $d
      if ($d -eq -1 -and $x -eq 0) { continue }
      if ($d -eq 1 -and $x -eq $w-1) { continue }
      if ($d -eq -$w -and $y -eq 0) { continue }
      if ($d -eq $w -and $y -eq $h-1) { continue }
      if (Test-Transparent $bytes $n) { $touch = $true; break }
    }
    if ($touch) { $toClear.Add($i) }
  }
  foreach ($i in $toClear) { $bytes[$i*4+3] = 0 }
  if ($toClear.Count -eq 0) { break }
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
Resize-Png $bmp "$root\brand_icon_128.png" 128
Resize-Png $bmp "$root\brand_icon_sm.png" 64
Resize-Png $bmp "$root\logo512.png" 512
Resize-Png $bmp "$root\logo192.png" 192

$mem = New-Object System.IO.MemoryStream
$bmp.Save($mem, [System.Drawing.Imaging.ImageFormat]::Png)
[System.IO.File]::WriteAllBytes("$env:TEMP\icon_master2.png", $mem.ToArray())
$mem.Dispose()
$bmp.Dispose()
Copy-Item "$env:TEMP\icon_master2.png" $src -Force
'RIM CLEAN DONE'
foreach ($f in @('brand_icon.png','brand_icon_128.png','logo192.png','logo512.png')) {
  "$f -> $((Get-Item "$root\$f").Length) bytes"
}
