/**
 * CampusDebug OS — Native Desktop Notification Manager
 * Handles browser permission requests & triggers native system notifications
 */

export async function requestNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }

  if (Notification.permission === 'granted') {
    return 'granted';
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission;
  }

  return 'denied';
}

export async function sendDesktopNotification(title, body, options = {}) {
  try {
    const permission = await requestNotificationPermission();
    if (permission === 'granted') {
      const notification = new Notification(title, {
        body,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: 'campus-debug-os',
        ...options
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      return notification;
    }
  } catch (err) {
    console.warn('Desktop notification warning:', err);
  }
}

export function notifyGatePassApproved(passName, passId) {
  sendDesktopNotification(
    '🎟️ Gate Pass Approved!',
    `Gate Pass #${passId} has been signed by Hostel Warden for ${passName}. HMAC token unlocked for exit.`
  );
}

export function notifyMasterIncidentResolved(masterId, category) {
  sendDesktopNotification(
    '✅ Master Incident Resolved!',
    `Master ${category} incident ${masterId} affecting your hostel wing has been marked RESOLVED by maintenance.`
  );
}
