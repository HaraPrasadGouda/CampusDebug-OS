/**
 * Generates the PWA "app-plate" icons: the raw brand artwork is placed on a
 * soft near-white rounded-square plate (like modern app launchers) with a
 * small inner padding, and the area outside the rounded corners stays fully
 * transparent.
 *
 * Usage: node scripts/genPlatedIcons.cjs   (run from the project root)
 */
const sharp = require('sharp');
const path = require('path');

const SRC = path.join(__dirname, '..', 'public', 'brand_icon.png');
const OUT_DIR = path.join(__dirname, '..', 'public');

const PLATE_BG = { r: 245, g: 251, b: 246, alpha: 1 }; // soft mint-white plate

function roundedRectSvg(size, radius) {
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
       <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}"
             fill="rgb(${PLATE_BG.r},${PLATE_BG.g},${PLATE_BG.b})" />
     </svg>`
  );
}

async function makeIcon({ size, artworkScale, prefix, vBias = 0.5, hBias = 0.5 }) {
  const plateRadius = Math.round(size * 0.23); // generous modern corner rounding
  const inner = Math.round(size * artworkScale);
  // vBias < 0.5 places less whitespace above the artwork → it rides higher
  // in the plate (Android maskable launchers crop toward the edges, which
  // visually drags content down; the bias compensates).
  const topBias = Math.round((size - inner) * vBias);
  const leftBias = hBias; // share of leftover width placed on the LEFT side
  const leftOffset = Math.round((size - inner) * leftBias);

  // 1. crop the source to its REAL content box: scan for strongly opaque,
  //    non-background pixels — the decorative faded ring + watermark padding
  //    in the source canvas are excluded this way, so the C itself fills
  //    the plate properly.
  const srcMeta = await sharp(SRC).metadata();
  const { data, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (data[i + 3] <= 140) continue;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum >= 190) continue;
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
  }
  const cropMargin = 2;
  const cropW = Math.min(srcMeta.width - 1, maxX - minX + 1 + cropMargin * 2);
  const cropH = Math.min(srcMeta.height - 1, maxY - minY + 1 + cropMargin * 2);
  const croppedSrc = await sharp(SRC)
    .extract({
      left: Math.max(0, minX - cropMargin),
      top: Math.max(0, minY - cropMargin),
      width: cropW, height: cropH
    })
    .png()
    .toBuffer();

  const artwork = await sharp(croppedSrc)
    .resize(inner, inner, { fit: 'inside' })
    .png()
    .toBuffer();

  const meta = await sharp(artwork).metadata();
  const left = Math.round(leftOffset + (inner - meta.width) / 2);
  const top = Math.round(topBias + (inner - meta.height) / 2);

  // 2. transparent canvas → plate → artwork on top
  await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([
      { input: roundedRectSvg(size, plateRadius), left: 0, top: 0 },
      { input: artwork, left, top }
    ])
    .png()
    .toFile(path.join(OUT_DIR, `${prefix}.png`));

  console.log(`✔ ${prefix}.png (${size}x${size}, artwork ${artworkScale})`);
}

(async () => {
  await makeIcon({ size: 192, artworkScale: 0.72, prefix: 'logo192', hBias: 0.42 });
  await makeIcon({ size: 512, artworkScale: 0.72, prefix: 'logo512', hBias: 0.42 });
  await makeIcon({ size: 128, artworkScale: 0.72, prefix: 'brand_icon_128', hBias: 0.42 });
  await makeIcon({ size: 256, artworkScale: 0.80, prefix: 'brand_icon', hBias: 0.42 });
  console.log('Done.');
})();