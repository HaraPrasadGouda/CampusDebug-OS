// Stamps public/sw.js with a fresh build id after every `vite build`, so each deploy ships a
// byte-different service worker (the browser then installs it, skipWaiting()s and claim()s —
// no hard refresh needed). See the comment at the top of public/sw.js.
import fs from 'node:fs';
import path from 'node:path';

export const stampServiceWorker = (src, id) => src.replace(/__BUILD_ID__/g, id);
export const newBuildId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export default function swBuildStamp() {
  let outDir = 'dist';
  return {
    name: 'sw-build-stamp',
    apply: 'build',
    configResolved(cfg) { outDir = path.resolve(cfg.root, cfg.build.outDir); },
    closeBundle() {
      const f = path.join(outDir, 'sw.js');
      if (!fs.existsSync(f)) return;
      fs.writeFileSync(f, stampServiceWorker(fs.readFileSync(f, 'utf8'), newBuildId()));
    }
  };
}
