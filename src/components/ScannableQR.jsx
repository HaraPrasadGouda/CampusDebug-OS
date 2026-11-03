import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Maximize2 } from 'lucide-react';

/**
 * Gate-scannable QR. The signed token is long (dense QR), so it must be
 * shown BIG for a guard's phone camera: pure black on white, a 4-module
 * white quiet zone, error-correction M, drawn as crisp vector SVG that
 * fills the card width (never a blurry upscaled bitmap).
 * Tap → fullscreen white view for scanning at the gate.
 * Optional `hint` (e.g. the rotating leave QR's countdown) shows under the
 * QR in both views; the fullscreen view follows `value` as it changes.
 */
export default function ScannableQR({ value, caption, hint }) {
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (!full) return;
    const onKey = (e) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  if (!value) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setFull(true)}
        aria-label="Enlarge QR for the gate scanner"
        data-testid="scannable-qr"
        className="block w-full max-w-[300px] mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm p-1.5 cursor-zoom-in"
      >
        <QRCodeSVG
          value={value}
          size={512}
          level="M"
          marginSize={4}
          bgColor="#FFFFFF"
          fgColor="#000000"
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
        <span className="mt-1 mb-0.5 flex items-center justify-center gap-1 text-[11px] font-bold text-slate-500">
          <Maximize2 className="w-3 h-3" /> Tap to enlarge
        </span>
      </button>
      {hint && <p data-testid="scannable-qr-hint" className="mt-1.5 text-[11px] font-bold text-emerald-800 text-center">{hint}</p>}

      {full && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog"
          aria-label="QR for the gate scanner"
          data-testid="scannable-qr-full"
          onClick={() => setFull(false)}
          className="fixed inset-0 z-[100] bg-white flex flex-col items-center justify-center p-4 cursor-zoom-out"
        >
          <QRCodeSVG
            value={value}
            size={1024}
            level="M"
            marginSize={4}
            bgColor="#FFFFFF"
            fgColor="#000000"
            style={{ width: 'min(94vw, 80vh)', height: 'auto', display: 'block' }}
          />
          {caption && <p className="mt-3 text-sm font-extrabold text-slate-900 text-center">{caption}</p>}
          {hint && <p className="mt-1 text-xs font-bold text-emerald-800 text-center">{hint}</p>}
          <p className="mt-1 text-xs font-bold text-slate-500">Tap anywhere to close</p>
        </div>,
        document.body
      )}
    </>
  );
}
