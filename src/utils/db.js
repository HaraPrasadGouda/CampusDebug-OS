import { openDB } from 'idb';

const DB_NAME = 'campus_debug_db';
const DB_VERSION = 5;

/**
 * Initialize and upgrade IndexedDB database with necessary stores
 */
export async function initDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // 1. Tickets Store (Hostel complaints, mesh issues, electricity, water, etc.)
      if (!db.objectStoreNames.contains('tickets')) {
        const ticketStore = db.createObjectStore('tickets', { keyPath: 'id' });
        ticketStore.createIndex('by-status', 'status');
        ticketStore.createIndex('by-category', 'category');
        ticketStore.createIndex('by-created', 'createdAt');
      }

      // 2. Gate Passes Store (Offline cryptographic QR tokens & gate status)
      if (!db.objectStoreNames.contains('gate_passes')) {
        const passStore = db.createObjectStore('gate_passes', { keyPath: 'id' });
        passStore.createIndex('by-student', 'studentId');
        passStore.createIndex('by-status', 'status');
        passStore.createIndex('by-validity', 'validUntil');
      }

      // 3. Notices Store (Targeted micro-segmented hostel/mess announcements)
      if (!db.objectStoreNames.contains('notices')) {
        const noticeStore = db.createObjectStore('notices', { keyPath: 'id' });
        noticeStore.createIndex('by-target', 'targetGroup');
        noticeStore.createIndex('by-date', 'publishedAt');
      }

      // 4. Outbox Queue Store (Pending network requests queued while offline)
      if (!db.objectStoreNames.contains('outbox_queue')) {
        const outboxStore = db.createObjectStore('outbox_queue', {
          keyPath: 'queueId',
          autoIncrement: true
        });
        outboxStore.createIndex('by-type', 'actionType');
        outboxStore.createIndex('by-created', 'timestamp');
      }

      // 5. Users Store (Imported student rosters & faculty allotments)
      if (!db.objectStoreNames.contains('users')) {
        const userStore = db.createObjectStore('users', { keyPath: 'rollNo' });
        userStore.createIndex('by-block', 'hostelBlock');
        userStore.createIndex('by-branch', 'branch');
      }

      // 6. Assets Store (Hostel electrical, plumbing & infrastructure inventory)
      if (!db.objectStoreNames.contains('assets')) {
        const assetStore = db.createObjectStore('assets', { keyPath: 'assetId' });
        assetStore.createIndex('by-block', 'locationBlock');
      }

      // 7. Document Requests Store (Registrar desk requests — kept OUT of the
      //    tickets store so the warden's local issue queue never sees them;
      //    v4 upgrade: previously they leaked into the shared ticket ledger)
      if (!db.objectStoreNames.contains('doc_requests')) {
        const docStore = db.createObjectStore('doc_requests', { keyPath: 'id' });
        docStore.createIndex('by-created', 'createdAt');
      }

      // 8. Timetable Store (v5 upgrade: the server's generated schedule cache —
      //    powers offline timetable opening with a live "now" highlight)
      if (!db.objectStoreNames.contains('timetable')) {
        const ttStore = db.createObjectStore('timetable', { keyPath: 'id' });
        ttStore.createIndex('by-department', 'department');
      }
    }
  });
}

/**
 * Save or update an item in a specific local object store
 * @param {string} storeName - Target object store ('tickets' | 'gate_passes' | 'notices' | 'users' | 'assets')
 * @param {Object} item - Data item to insert or update
 */
export async function saveLocal(storeName, item) {
  const db = await initDB();
  return db.put(storeName, item);
}

/**
 * Bulk save multiple items using a single transaction for maximum CSV ingest performance
 * @param {string} storeName 
 * @param {Array<Object>} items 
 */
export async function bulkSaveLocal(storeName, items) {
  const db = await initDB();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  await Promise.all(items.map(item => store.put(item)));
  await tx.done;
  return items.length;
}

/**
 * Retrieve all items from a specific local object store
 * @param {string} storeName - Target object store
 */
export async function getAllLocal(storeName) {
  const db = await initDB();
  return db.getAll(storeName);
}

/**
 * Retrieve a single item by key
 * @param {string} storeName 
 * @param {string|number} key 
 */
export async function getLocalById(storeName, key) {
  const db = await initDB();
  return db.get(storeName, key);
}

/**
 * Delete an item by key from an object store
 * @param {string} storeName 
 * @param {string|number} key 
 */
export async function deleteLocal(storeName, key) {
  const db = await initDB();
  return db.delete(storeName, key);
}

/**
 * Queue an offline action in the outbox for background sync when connection resumes
 * @param {string} actionType - 'CREATE_TICKET' | 'REQUEST_GATE_PASS' | 'ACKNOWLEDGE_NOTICE' | etc.
 * @param {Object} payload - The action payload data
 */
export async function queueOfflineAction(actionType, payload) {
  const db = await initDB();
  const queueItem = {
    actionType,
    payload,
    timestamp: new Date().toISOString(),
    retryCount: 0,
    synced: false
  };
  const queueId = await db.add('outbox_queue', queueItem);
  
  // Dispatch custom event so UI components immediately react to outbox updates
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('campus_outbox_updated', {
      detail: { queueId, actionType, count: await getOutboxCount() }
    }));
    window.dispatchEvent(new CustomEvent('campus_outbox_updated'));

    // If online, immediately flush outbox so items don't sit in queue
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      import('./syncEngine').then(({ flushOutbox }) => {
        flushOutbox().catch(err => console.warn('[DB] Auto-flush error:', err));
      });
    }
  }
  
  return queueId;
}

/**
 * Get the total count of pending actions in outbox queue
 */
export async function getOutboxCount() {
  const db = await initDB();
  return db.count('outbox_queue');
}

// seedDemoData() was REMOVED on purpose: the ledger must only ever hold
// real passes/tickets created by real users. Historical leftovers of the
// seeding callpath are not referenced anywhere anymore.


/**
 * Retrieve all pending items in outbox queue
 */
export async function getOutboxQueue() {
  const db = await initDB();
  return db.getAll('outbox_queue');
}

/**
 * Remove an item from outbox queue after successful sync
 * @param {number} queueId 
 */
export async function removeOutboxItem(queueId) {
  const db = await initDB();
  await db.delete('outbox_queue', queueId);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('campus_outbox_updated', {
      detail: { count: await getOutboxCount() }
    }));
  }
}

/**
 * Clear an entire store (useful for resets or testing)
 * @param {string} storeName 
 */
export async function clearStore(storeName) {
  const db = await initDB();
  return db.clear(storeName);
}
