import React from 'react';
import { Download, X, FileSpreadsheet, ShieldCheck, Wrench, CheckCircle2 } from 'lucide-react';
import { getAllLocal } from '../../utils/db';

// API origin comes from the environment (Vite VITE_API_BASE). Empty means
// same-origin, the same pattern the rest of the app's API calls use.
const API_BASE = import.meta.env.VITE_API_BASE || '';

export default function ExportModal({ isOpen, onClose, onNotification }) {
  if (!isOpen) return null;

  const triggerDownload = (csvContent, fileName) => {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    if (onNotification) {
      onNotification(`Successfully exported ${fileName} to Downloads folder!`, 'success');
    }
  };

  const handleExportGatePassLogs = async () => {
    try {
      const passes = (await getAllLocal('gate_passes')) || [];
      const headers = ['Pass ID', 'Student Roll', 'Student Name', 'Destination', 'Pass Type', 'Status', 'Valid Until', 'Verified At'];
      
      const rows = passes.map(p => [
        `"${p.id || ''}"`,
        `"${p.rollNo || ''}"`,
        `"${p.name || ''}"`,
        `"${p.destination || ''}"`,
        `"${p.passType || 'Day Pass'}"`,
        `"${p.status || 'PENDING'}"`,
        `"${p.validUntil || ''}"`,
        `"${p.verifiedAt || p.approvedAt || ''}"`
      ]);

      // No fabricated rows: an empty ledger exports an empty audit CSV.
      // Inventing people/passes in an export would be falsified audit data.

      const csvString = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      triggerDownload(csvString, `Gate_Pass_Audit_Log_${new Date().toISOString().slice(0,10)}.csv`);
    } catch (err) {
      console.error('Export gate pass error:', err);
    }
  };

  const handleExportMaintenanceClusters = async () => {
    try {
      let clusters = [];
      try {
        const res = await fetch(`${API_BASE}/api/dashboard-data`);
        if (res.ok) {
          const data = await res.json();
          clusters = data.masterClusters || [];
        }
      } catch (e) {
        console.warn('Backend server offline during export fallback');
      }

      const headers = ['Cluster Master ID', 'Category', 'Title', 'Location', 'Impacted Students Count', 'Status', 'Assigned Technician'];
      
      const rows = clusters.map(c => [
        `"${c.id || c.masterId || ''}"`,
        `"${c.category || ''}"`,
        `"${c.title || ''}"`,
        `"${c.location || ''}"`,
        `"${c.impactedCount || c.studentsImpacted || 0}"`,
        `"${c.status || 'UNASSIGNED'}"`,
        `"${c.assignedTo || 'Unassigned'}"`
      ]);

      // No clusters → the file carries just the header row (no sample rows
      // that look like real incidents).

      const csvString = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      triggerDownload(csvString, `Maintenance_Master_Clusters_${new Date().toISOString().slice(0,10)}.csv`);
    } catch (err) {
      console.error('Export clusters error:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white border border-slate-100 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Campus CSV Data Exporter</h3>
              <p className="text-[11px] text-slate-500 font-mono">Zero-dependency Blob URL download</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed">
          Select an audit log dataset to generate an instant CSV report for warden sign-offs or university administrative filing:
        </p>

        <div className="space-y-2.5">
          {/* Option A */}
          <button
            onClick={() => { handleExportGatePassLogs(); onClose(); }}
            className="w-full p-3.5 rounded-xl bg-slate-50 hover:bg-emerald-50/60 border border-slate-200 hover:border-emerald-300 text-left transition-all cursor-pointer flex items-center justify-between group shadow-2xs"
          >
            <div className="flex items-center space-x-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-100/80 text-emerald-700 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-900 group-hover:text-emerald-900 block">
                  Option A: Gate Pass Entry/Exit Audit Log
                </span>
                <span className="text-[10px] text-slate-500 font-mono block">
                  Gate pass scan logs
                </span>
              </div>
            </div>
            <Download className="w-4 h-4 text-slate-400 group-hover:text-emerald-600" />
          </button>

          {/* Option B */}
          <button
            onClick={() => { handleExportMaintenanceClusters(); onClose(); }}
            className="w-full p-3.5 rounded-xl bg-slate-50 hover:bg-purple-50/60 border border-slate-200 hover:border-purple-300 text-left transition-all cursor-pointer flex items-center justify-between group shadow-2xs"
          >
            <div className="flex items-center space-x-3">
              <div className="w-9 h-9 rounded-lg bg-purple-100/80 text-purple-700 flex items-center justify-center shrink-0">
                <Wrench className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-900 group-hover:text-purple-900 block">
                  Option B: Master Maintenance Clusters Summary
                </span>
                <span className="text-[10px] text-slate-500 font-mono block">
                  SLA metrics & spatial deduplication log
                </span>
              </div>
            </div>
            <Download className="w-4 h-4 text-slate-400 group-hover:text-purple-600" />
          </button>
        </div>

        <div className="pt-2 text-right">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
