Add-Type -AssemblyName System.Drawing
$root = 'C:\Users\LENOVO\Downloads\bput project - Current - Copy\public'
$orig = "$root\brand_icon.png"

# 1) load pristine original into memory-backed copy
$fs = New-Object System.IO.FileStream $orig, ([System.IO.FileMode]::Open), ([System.IO.FileAccess]::Read)
$mbmp = New-Object System.Drawing.Bitmap $fs
$fs.Dispose()

# 2) read pixels via LockBits ReadOnly
$w = $mbmp.Width; $h = $mbmp.Height
$bd = $mbmp.LockBits([System.Drawing.Rectangle]::new(0,0,$w,$h), [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$total = $w*$h
$bytes = New-Object byte[] ($total*4)
[System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $bytes, 0, $bytes.Length)
$mbmp.UnlockBits($bd)

# 3) flood-fill analysis purely on the byte array
function Test-Light([byte[]]$arr, [int]$i) {
  $o = $i*4; $b=$arr[$o]; $g=$arr[$o+1]; $r=$arr[$o+2]
  $mn = [Math]::Min($r, [Math]::Min($g,$b))
  $mx = [Math]::Max($r, [Math]::Max($g,$b))
  return ($mn -gt 205 -and ($mx-$mn) -lt 18)
}
$visited = New-Object bool[] $total
$queue = New-Object 'System.Collections.Generic.Queue[int]'
for ($x=0; $x -lt $w; $x++) {
  foreach ($i in @($x, ($x + ($h-1)*$w))) { if (-not $visited[$i] -and (Test-Light $bytes $i)) { $visited[$i]=$true; $queue.Enqueue($i) } }
}
for ($y=0; $y -lt $h; $y++) {
  foreach ($i in @(($y*$w), ($w-1 + $y*$w))) { if (-not $visited[$i] -and (Test-Light $bytes $i)) { $visited[$i]=$true; $queue.Enqueue($i) } }
}
$cCount = 0
while ($queue.Count -gt 0) {
  $i = $queue.Dequeue()
  $x = $i % $w; $y = [Math]::Floor($i / $w)
  $cCount++
  foreach ($n in @()) {}
  if ($x -gt 0)      { $n=$i-1;  if (-not $visited[$n] -and (Test-Light $bytes $n)) { $visited[$n]=$true; $queue.Enqueue($n) } }
  if ($x -lt $w-1)   { $n=$i+1;  if (-not $visited[$n] -and (Test-Light $bytes $n)) { $visited[$n]=$true; $queue.Enqueue($n) } }
  if ($y -gt 0)      { $n=$i-$w; if (-not $visited[$n] -and (Test-Light $bytes $n)) { $visited[$n]=$true; $queue.Enqueue($n) } }
  if ($y -lt $h-1)   { $n=$i+$w; if (-not $visited[$n] -and (Test-Light $bytes $n)) { $visited[$n]=$true; $queue.Enqueue($n) } }
}
"Started flood analysis: cleared $cCount of $total"

# APPLY the mask: visited pixels -> fully transparent
$applied = 0
for ($i=0; $i -lt $total; $i++) {
  if ($visited[$i]) { $bytes[$i*4+3] = 0; $applied++ }
}
"Applied mask to $applied pixels"

# 4) rim erosion on byte array (3 passes, light pixels touching transparent become transparent)
function Test-Lightish([byte[]]$arr, [int]$i) {
  $o = $i*4; $b=$arr[$o]; $g=$arr[$o+1]; $r=$arr[$o+2]; $a=$arr[$o+3]
  if ($a -eq 0) { return $false }
  $mn = [Math]::Min($r, [Math]::Min($g,$b))
  $mx = [Math]::Max($r, [Math]::Max($g,$b))
  return ($mn -gt 150 -and ($mx-$mn) -lt 55)
}
for ($pass=0; $pass -lt 3; $pass++) {
  $toClear = New-Object 'System.Collections.Generic.List[int]'
  for ($i=0; $i -lt $total; $i++) {
    if (-not (Test-Lightish $bytes $i)) { continue }
    $x = $i % $w; $y = [Math]::Floor($i / $w)
    $touch = $false
    if ($x -gt 0)      { $n=$i-1;  if ($bytes[$n*4+3] -eq 0) { $touch=$true } }
    if (-not $touch -and $x -lt $w-1) { $n=$i+1;  if ($bytes[$n*4+3] -eq 0) { $touch=$true } }
    if (-not $touch -and $y -gt 0)    { $n=$i-$w; if ($bytes[$n*4+3] -eq 0) { $touch=$true } }
    if (-not $touch -and $y -lt $h-1) { $n=$i+$w; if ($bytes[$n*4+3] -eq 0) { $touch=$true } }
    if ($touch) { $toClear.Add($i) }
  }
  foreach ($i in $toClear) { $bytes[$i*4+3] = 0 }
  if ($toClear.Count -eq 0) { break }
}

# 5) verify the byte array itself
$opaqueAfter = 0
for ($i=0; $i -lt $total; $i++) { if ($bytes[$i*4+3] -gt 128) { $opaqueAfter++ } }
"In-memory result: $opaqueAfter opaque pixels ($([Math]::Round($opaqueAfter*100/$total,1))%)"

# 6) rebuild a NEW bitmap from scratch with the alpha applied (pixel-format-first construction)
$out = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$obd = $out.LockBits([System.Drawing.Rectangle]::new(0,0,$w,$h), [System.Drawing.Imaging.ImageLockMode]::WriteOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $obd.Scan0, $bytes.Length)
$out.UnlockBits($obd)

# 7) resizes from the fresh bitmap
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
Resize-Png $out "$root\brand_icon_128.png" 128
Resize-Png $out "$root\brand_icon_sm.png" 64
Resize-Png $out "$root\logo512.png" 512
Resize-Png $out "$root\logo192.png" 192

# 8) master to temp file, verify by RELOADING from disk, then swap in
$mem = New-Object System.IO.MemoryStream
$out.Save($mem, [System.Drawing.Imaging.ImageFormat]::Png)
$memBytes = $mem.ToArray()
$mem.Dispose()
$out.Dispose()
[System.IO.File]::WriteAllBytes("$env:TEMP\icon_master3.png", $memBytes)

# validation: reload temp file and count opaque
$check = New-Object System.Drawing.Bitmap "$env:TEMP\icon_master3.png"
$cbd = $check.LockBits([System.Drawing.Rectangle]::new(0,0,$check.Width,$check.Height), [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$cb = New-Object byte[] ($check.Width*$check.Height*4)
[System.Runtime.InteropServices.Marshal]::Copy($cbd.Scan0, $cb, 0, $cb.Length)
$check.UnlockBits($cbd)
$sz = $check.Width*$check.Height; $check.Dispose()
$checkOpaque = 0
for ($i=0; $i -lt $sz; $i++) { if ($cb[$i*4+3] -gt 128) { $checkOpaque++ } }
"Reload check: $checkOpaque / $sz = $([Math]::Round($checkOpaque*100/$sz,1))% opaque (expect ~26%)"
if (($checkOpaque / $sz) -lt 0.5) {
  Copy-Item "$env:TEMP\icon_master3.png" "$root\brand_icon.png" -Force
  'SWAPPED INTO public/'
} else {
  'NOT SWAPPED - validation failed'
}
