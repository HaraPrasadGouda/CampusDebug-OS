import React from 'react';
import { Sparkles } from 'lucide-react';

// Fix 4 (AI category chip): shows the category the AI model gave a complaint,
// next to the category the student picked. Renders nothing when the AI was
// offline / gave no valid category (the old behaviour), and never for
// certificate requests. When the AI disagrees with the student's pick the chip
// turns amber so staff can spot a mis-filed complaint at a glance.
export default function AiCategoryChip({ ticket, className = '' }) {
  const ai = ticket && typeof ticket.aiCategory === 'string' ? ticket.aiCategory.trim() : '';
  if (!ai || ticket.category === 'Admin Document') return null;
  const picked = String(ticket.category || '').trim().toLowerCase();
  const differs = picked && picked !== ai.toLowerCase();
  return (
    <span
      data-testid="ai-category-chip"
      title={differs ? `AI thinks this is ${ai} (student chose ${ticket.category})` : `AI category: ${ai}`}
      className={`inline-flex items-center gap-0.5 max-w-full text-[10px] font-semibold px-2 py-0.5 rounded-md border whitespace-nowrap ${
        differs
          ? 'bg-amber-50 text-amber-800 border-amber-200'
          : 'bg-violet-50 text-violet-700 border-violet-200'
      } ${className}`}
    >
      <Sparkles className="w-3 h-3 shrink-0" aria-hidden="true" />
      <span className="truncate">AI: {ai}</span>
    </span>
  );
}
