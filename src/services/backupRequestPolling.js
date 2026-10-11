export const BACKUP_REQUEST_POLL_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Starts the backup-request fallback poll while the page is visible.
 * Realtime remains the primary delivery path; visibility/online transitions
 * trigger an immediate reconciliation so hidden tabs do not need to poll.
 */
export function startBackupRequestPolling(
    checkPendingRequests,
    {
        documentRef = document,
        windowRef = window,
        intervalMs = BACKUP_REQUEST_POLL_INTERVAL_MS,
    } = {},
) {
    let intervalId = null;

    const stopPolling = () => {
        if (intervalId === null) return;
        clearInterval(intervalId);
        intervalId = null;
    };

    const startPolling = () => {
        if (intervalId !== null || documentRef.visibilityState !== 'visible') return;
        intervalId = setInterval(checkPendingRequests, intervalMs);
    };

    const onVisibilityChange = () => {
        if (documentRef.visibilityState === 'visible') {
            checkPendingRequests();
            startPolling();
        } else {
            stopPolling();
        }
    };

    const onOnline = () => {
        if (documentRef.visibilityState === 'visible') checkPendingRequests();
    };

    documentRef.addEventListener('visibilitychange', onVisibilityChange);
    windowRef.addEventListener('online', onOnline);

    // Preserve the initial reconciliation, even if startup occurs in background.
    checkPendingRequests();
    startPolling();

    return () => {
        stopPolling();
        documentRef.removeEventListener('visibilitychange', onVisibilityChange);
        windowRef.removeEventListener('online', onOnline);
    };
}
