import { initDB } from './db';

const SYNC_DB_NAME = 'campusdebug_sync_db';
const SYNC_DB_VERSION = 1;

/**
 * Initialize IndexedDB for CampusDebug OS PWA Sync Engine
 * Object Stores:
 *   1. outbox: { id, actionType, endpoint, payload, timestamp, retryCount }
 *   2. cached_dashboard: { key: 'dashboard_data', data, cachedAt }
 */
export async function getSyncDB() {
  return openDB(SYNC_DB_NAME, SYNC_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('outbox')) {
        const outboxStore = db.createObjectStore('outbox', { keyPath: 'id' });
        outboxStore.createIndex('by-timestamp', 'timestamp');
        outboxStore.createIndex('by-action', 'actionType');
      }

      if (!db.objectStoreNames.contains('cached_dashboard')) {
        db.createObjectStore('cached_dashboard', { keyPath: 'key' });
      }
    }
  });
}

/**
 * 1. Queue or Execute Action
 * Executes immediately if online; queues in IndexedDB outbox_queue if offline.
 */
export async function queueOrExecute(actionType, endpoint, payload) {
  return queueAction(actionType, endpoint, payload);
}

export async function queueAction(actionType, endpoint, payload) {
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

  const db = await getCampusDebugDB();
  const queueItem = {
    actionType,
    endpoint,
    payload,
    timestamp: Date.now(),
    retryCount: 0
  };

  const queueId = await db.add('outbox_queue', queueItem);
  queueItem.queueId = queueId;
  console.log(`[SyncEngine] Queued in outbox_queue:`, queueItem);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('campus_outbox_updated'));
  }

  // Right after dispatching, check network status: if navigator.onLine is true, call flushOutbox() immediately without awaiting
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    console.log(`[SyncEngine] Online detected: Triggering immediate flushOutbox()...`);
    flushOutbox().catch(err => console.warn('[SyncEngine] Auto-flush error:', err));
  }

  return { status: (typeof navigator !== 'undefined' && navigator.onLine) ? 'FLUSHING_ONLINE' : 'QUEUED_OFFLINE', queueId, item: queueItem };
}

/**
 * Exponential backoff delay utility
 */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Single source of truth: db.js owns the campus_debug_db schema (tickets,
// gate_passes, notices, outbox_queue, users, assets, doc_requests). This
// module once ran its OWN opener pinned to version 3 — after db.js upgraded
// the same database to version 4 (doc_requests), every open attempt here
// threw VersionError (requested 3 < existing 4) and the ENTIRE outbox went
// permanently dead on upgraded devices: queued documents, gate passes and
// complaints silently never reached the server. Never re-introduce a
// second schema for this database.
function getCampusDebugDB() {
  return initDB();
}

/**
 * 2. Flush Outbox Queue
 * Aligned with campus_debug_db -> outbox_queue
 * Sequentially posts pending requests with retry backoff when connection returns.
 */
export async function flushOutbox(onNotification) {
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  if (!isOnline) {
    console.log('[SyncEngine] Cannot flush outbox: System is currently offline.');
    return 0;
  }

  try {
    const db = await getCampusDebugDB();
    const allPending = await db.getAll('outbox_queue');

    if (!allPending || allPending.length === 0) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('campus_outbox_updated', { detail: { count: 0 } }));
      }
      return 0;
    }

    console.log(`[SyncEngine] Flushing ${allPending.length} pending actions from outbox_queue...`);
    let syncedCount = 0;

    for (const item of allPending) {
      let succeeded = false;
      const maxRetries = 3;

      // Map action types to endpoints
      let targetEndpoint = item.endpoint;
      let targetBody = item.payload || item;
      if (item.actionType === 'REQUEST_DOCUMENT' || item.actionType === 'APPLY_CERTIFICATE') {
        targetEndpoint = item.endpoint || '/api/document-requests';
      } else if (item.actionType === 'REQUEST_GATE_PASS') {
        // Student pass REQUEST goes to the creation endpoint — NEVER the warden
        // approval endpoint, otherwise the pass auto-approves itself.
        targetEndpoint = item.endpoint || '/api/create-pass';
        targetBody = { passData: item.pass || item.payload || item };
      } else if (item.actionType === 'SCAN_PASS') {
        // Guard QR scan (possibly taken offline at the gate) — sync to scan endpoint
        targetEndpoint = item.endpoint || '/api/scan-pass';
        targetBody = { passData: item.pass || item.payload || item };
      } else if (item.actionType === 'WARDEN_APPROVE_PASS') {
        targetEndpoint = item.endpoint || '/api/approve-pass';
      } else if (item.actionType === 'WARDEN_REJECT_PASS') {
        // Fix 3: rejection had no mapping (it was POSTed to "/undefined" and
        // silently deleted). The warden desk records decisions through the
        // same pass endpoint the approve button uses.
        targetEndpoint = item.endpoint || '/api/create-pass';
        targetBody = { passData: item.pass || item.payload || item };
      } else if (item.actionType === 'MESS_FEEDBACK') {
        targetEndpoint = item.endpoint || '/api/mess-feedback';
        targetBody = item.payload || item;
      } else if (item.actionType === 'ACKNOWLEDGE_NOTICE') {
        targetEndpoint = item.endpoint || '/api/notices/ack';
        targetBody = item.payload || item;
      } else if (item.actionType === 'MEAL_RSVP') {
        targetEndpoint = item.endpoint || '/api/meal-rsvp';
      } else if (item.actionType === 'DISPATCH_NOTICE') {
        // Notice dispatched while admin was offline → replay to the central
        // notice bus so PWA devices still receive it when back online.
        targetEndpoint = item.endpoint || '/api/notices';
        const n = item.payload || item;
        targetBody = {
          title: n.title,
          content: n.content,
          target: n.target,
          category: 'General',
          urgency: n.urgency || n.priority || 'Normal',
          source: 'Admin Notice Desk (offline flush)'
        };
      } else if (item.actionType === 'SUBMIT_TICKET' || item.actionType === 'CREATE_TICKET') {
        // Offline complaint → goes through the same AI/classification/routing
        // endpoint as online submissions (same clustering & technician logic)
        targetEndpoint = '/api/parse-ticket';
        const p = item.payload || item;
        targetBody = {
          complaintText: p.complaintText || p.description || p.raw_text || (p.ticket ? p.ticket.description : ''),
          hostelBlock: p.hostelBlock || p.block || (p.ticket ? p.ticket.hostelBlock : ''),
          floor: p.floor || (p.ticket ? p.ticket.floor : ''),
          room: p.room || (p.ticket ? p.ticket.room : ''),
          category: p.category || (p.ticket ? p.ticket.category : ''),
          urgency: p.urgency || (p.ticket ? p.ticket.urgency : '')
        };
      } else if (item.actionType === 'SUPPORT_REPORT') {
        // Login-screen "Report a problem" filed while the reporter had no
        // session and no connection → replay to the unauthenticated support
        // endpoint once connectivity returns.
        targetEndpoint = '/api/support/report';
        targetBody = item.payload || item;
      } else if (item.actionType === 'TECHNICIAN_ACTION') {
        // Technician accept/start/note/resolve/close taken offline on-site
        targetEndpoint = item.endpoint || '/api/technician/action';
        targetBody = item.payload || item;
      } else if (item.actionType === 'WARDEN_ESCALATE') {
        targetEndpoint = item.endpoint || '/api/warden/escalate';
        targetBody = item.payload || item;
      } else if (item.actionType === 'WARDEN_REASSIGN') {
        targetEndpoint = item.endpoint || '/api/warden/reassign';
        targetBody = item.payload || item;
      } else if (item.actionType && !['REQUEST_DOCUMENT','APPLY_CERTIFICATE','REQUEST_GATE_PASS','SCAN_PASS','WARDEN_APPROVE_PASS','MEAL_RSVP','SUBMIT_TICKET','CREATE_TICKET','TECHNICIAN_ACTION','WARDEN_ESCALATE','WARDEN_REASSIGN'].includes(item.actionType)) {
        targetEndpoint = item.endpoint;
        targetBody = item.payload || item;
      }

      // Fix 3: an action with no known endpoint used to be POSTed to
      // "/undefined"; the app-shell fallback answered 200 and the action was
      // deleted as if it had synced. Keep it queued instead of losing it.
      if (!targetEndpoint) {
        console.warn(`[SyncEngine] No endpoint for outbox action ${item.actionType} — kept in the queue, not sent.`);
        continue;
      }

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const res = await fetch(targetEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(targetBody)
          });

          if (res.ok || (res.status >= 200 && res.status < 300)) {
            const deleteKey = item.queueId !== undefined ? item.queueId : item.id;
            await db.delete('outbox_queue', deleteKey);
            syncedCount++;
            succeeded = true;

            // Offline complaints: on successful replay, reconcile the LOCAL copy
            // with the server's real ticket (fresh UUID, AI title, live status).
            // Without this, the stale local row stays in IndexedDB forever and
            // duplicates the cloud row with a frozen "Just now" label.
            if (item.actionType === 'SUBMIT_TICKET' || item.actionType === 'CREATE_TICKET') {
              try {
                const serverRes = await res.json();
                const payloadTicket = (item.payload && item.payload.ticket) || item.ticket;
                const localId = payloadTicket ? payloadTicket.id : null;
                const sv = serverRes && serverRes.ticket;
                if (sv && sv.id) {
                  const createdIso = sv.createdAt || sv.created_at || (payloadTicket && payloadTicket.createdAt) || new Date().toISOString();
                  const createdMs = new Date(createdIso).getTime();
                  const updatedLocal = {
                    ...sv,
                    type: 'ticket',
                    title: sv.title || (payloadTicket && payloadTicket.title) || 'Hostel Complaint',
                    description: (payloadTicket && payloadTicket.description) || sv.raw_text || sv.description || null,
                    createdAtMs: isNaN(createdMs) ? undefined : createdMs,
                    time: sv.time || 'Just now'
                  };
                  if (localId && String(localId) !== String(sv.id)) {
                    await db.delete('tickets', localId);
                  }
                  await db.put('tickets', updatedLocal);
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('campus_tickets_updated', { detail: { masterClusters: serverRes.masterClusters } }));
                  }
                  console.log(`[SyncEngine] Reconciled offline ticket ${localId} → ${sv.id}`);
                }
              } catch (reconErr) {
                console.warn('[SyncEngine] Ticket reconciliation failed (payload kept):', reconErr.message);
              }
            }

            // Guard's OFFLINE day-scholar leave exit: tell the guard screen.
            if (item.actionType === 'LEAVE_SCAN' && typeof window !== 'undefined') {
              const j = await res.json().catch(() => ({}));
              window.dispatchEvent(new CustomEvent('campus_leave_scan_synced', { detail: { ...j, ok: true, leaveId: targetBody.leaveId } }));
            }
            // Guard's OFFLINE exit from a typed GP number: same answer path.
            if (item.actionType === 'SCAN_PASS' && targetBody.passData?.manualOffline && typeof window !== 'undefined') {
              const j = await res.json().catch(() => ({}));
              window.dispatchEvent(new CustomEvent('campus_leave_scan_synced', { detail: { ...j, ok: true, kind: 'PASS', leaveId: targetBody.passData.id } }));
            }

            if (item.actionType === 'REQUEST_DOCUMENT' || item.actionType === 'APPLY_CERTIFICATE') {
              console.log('Successfully flushed document request:', deleteKey);
            } else {
              console.log(`[SyncEngine] Synced outbox item #${deleteKey} (${item.actionType})`);
            }
            break;
          } else if (item.actionType === 'SCAN_PASS' && targetBody.passData?.manualOffline && [400, 403, 404, 409].includes(res.status)) {
            // Final answer for an offline typed-number exit (double use from
            // another guard phone, pass not approved) — drop it, show the guard.
            const j = await res.json().catch(() => ({}));
            await db.delete('outbox_queue', item.queueId !== undefined ? item.queueId : item.id);
            syncedCount++;
            succeeded = true;
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('campus_leave_scan_synced', { detail: { ...j, ok: false, status: res.status, kind: 'PASS', leaveId: targetBody.passData.id } }));
            }
            console.warn(`[SyncEngine] Offline pass exit refused at sync (${res.status}):`, j.reason || j.error || '');
            break;
          } else if (item.actionType === 'LEAVE_SCAN' && [400, 403, 404, 409].includes(res.status)) {
            // Final answer for an offline leave exit (double use from another
            // gate, expired QR, not approved) — retrying can't change it.
            // Drop it from the outbox and show the guard why.
            const j = await res.json().catch(() => ({}));
            await db.delete('outbox_queue', item.queueId !== undefined ? item.queueId : item.id);
            syncedCount++;
            succeeded = true;
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('campus_leave_scan_synced', { detail: { ...j, ok: false, status: res.status, leaveId: targetBody.leaveId } }));
            }
            console.warn(`[SyncEngine] Offline leave exit refused at sync (${res.status}):`, j.reason || j.error || '');
            break;
          } else {
            console.warn(`[SyncEngine] Attempt ${attempt} failed with status ${res.status} for ${item.queueId || item.id}`);
          }
        } catch (postErr) {
          console.warn(`[SyncEngine] Attempt ${attempt} network error for ${item.queueId || item.id}:`, postErr.message);
        }

        // Retry exponential backoff: 300ms, 600ms, 1200ms
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 150;
          await wait(delay);
        }
      }

      if (!succeeded) {
        item.retryCount = (item.retryCount || 0) + 1;
        await db.put('outbox_queue', item);
        // Failure ISOLATION: stop retrying THIS item now (it retries on the
        // next sync trigger), but keep flushing the rest. The old behavior
        // halted the whole queue to preserve causal ordering — in practice
        // one stale/poison item (an expired session, a since-deleted pass)
        // permanently froze every newer action behind it, so documents and
        // passes silently never reached the server. Items that DO succeed
        // still flush in order, so the ordering guarantee survives for the
        // common case.
        console.warn(`[SyncEngine] Item #${item.queueId || item.id} (${item.actionType}) failed attempt — queued for retry; flushing remaining items.`);
      }
    }

    const remainingPending = await db.getAll('outbox_queue');
    const remainingCount = remainingPending ? remainingPending.length : 0;

    if (syncedCount > 0) {
      const msg = `Offline Outbox Synced (${syncedCount} action${syncedCount > 1 ? 's' : ''} pushed)`;
      if (onNotification) onNotification(msg, 'success');

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('campus_queue_synced', { detail: { count: syncedCount } }));
        window.dispatchEvent(new CustomEvent('campus_dashboard_refreshed', { detail: {} }));
      }
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('campus_outbox_updated', { detail: { count: remainingCount } }));
      window.dispatchEvent(new CustomEvent('campus_outbox_updated'));
    }

    return syncedCount;
  } catch (flushErr) {
    console.error('[SyncEngine] flushOutbox error:', flushErr);
    return 0;
  }
}

/**
 * Get current pending sync count in outbox_queue
 */
export async function getPendingSyncCount() {
  try {
    const db = await getCampusDebugDB();
    const count = await db.count('outbox_queue');
    return count;
  } catch (err) {
    console.warn('[SyncEngine] Error counting outbox items:', err);
    return 0;
  }
}

/**
 * 3. Cache & Retrieve Offline Dashboard Data
 * Serves cached attendance, fee dues balance, gate passes, and meal RSVP state for 0ms rendering.
 */
export async function cacheDashboardData(data) {
  try {
    const db = await getSyncDB();
    await db.put('cached_dashboard', {
      key: 'dashboard_data',
      data,
      cachedAt: Date.now()
    });
  } catch (err) {
    console.warn('[SyncEngine] Failed to cache dashboard data:', err.message);
  }
}

export async function getOfflineDashboardData() {
  try {
    const db = await getSyncDB();
    const entry = await db.get('cached_dashboard', 'dashboard_data');
    if (entry && entry.data) {
      return {
        ...entry.data,
        isCached: true,
        cachedAt: entry.cachedAt
      };
    }
  } catch (err) {
    console.warn('[SyncEngine] Failed to read cached dashboard data:', err.message);
  }

  // Resilient offline fallback: an EMPTY ledger. No fabricated students,
  // passes or money figures — when the server was never reached, the UI
  // must show "no data yet", not invented data.
  return {
    isCached: true,
    cachedAt: Date.now(),
    profile: null,
    gatePasses: [],
    mealRsvp: null,
    tickets: []
  };
}

/**
 * 4. Automatic Online Listener Registration
 */
export function initSyncEngine(onNotification) {
  if (typeof window === 'undefined') return;

  const handleOnline = () => {
    console.log('[SyncEngine] Network connection restored (online). Flushing outbox queue...');
    flushOutbox(onNotification);
  };

  window.addEventListener('online', handleOnline);

  // Auto flush on boot if online
  if (navigator.onLine) {
    flushOutbox(onNotification);
  }

  return () => {
    window.removeEventListener('online', handleOnline);
  };
}

// Backward compatibility alias for legacy call sites
export const flushOfflineQueue = flushOutbox;
