import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    BACKUP_REQUEST_POLL_INTERVAL_MS,
    startBackupRequestPolling,
} from '../src/services/backupRequestPolling';

describe('startBackupRequestPolling', () => {
    let visibilityListeners;
    let windowListeners;
    let documentRef;
    let windowRef;

    beforeEach(() => {
        vi.useFakeTimers();
        visibilityListeners = new Set();
        windowListeners = new Map();
        documentRef = {
            visibilityState: 'visible',
            addEventListener: vi.fn((event, listener) => {
                if (event === 'visibilitychange') visibilityListeners.add(listener);
            }),
            removeEventListener: vi.fn((event, listener) => {
                if (event === 'visibilitychange') visibilityListeners.delete(listener);
            }),
        };
        windowRef = {
            addEventListener: vi.fn((event, listener) => windowListeners.set(event, listener)),
            removeEventListener: vi.fn((event, listener) => {
                if (windowListeners.get(event) === listener) windowListeners.delete(event);
            }),
        };
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('reconciles once on startup and polls visible tabs every five minutes', () => {
        const checkPendingRequests = vi.fn();
        const stop = startBackupRequestPolling(checkPendingRequests, { documentRef, windowRef });

        expect(BACKUP_REQUEST_POLL_INTERVAL_MS).toBe(5 * 60 * 1000);
        expect(checkPendingRequests).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(BACKUP_REQUEST_POLL_INTERVAL_MS - 1);
        expect(checkPendingRequests).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1);
        expect(checkPendingRequests).toHaveBeenCalledTimes(2);

        stop();
        vi.advanceTimersByTime(BACKUP_REQUEST_POLL_INTERVAL_MS);
        expect(checkPendingRequests).toHaveBeenCalledTimes(2);
    });

    it('stops polling in background and reconciles immediately when visible again', () => {
        const checkPendingRequests = vi.fn();
        const stop = startBackupRequestPolling(checkPendingRequests, { documentRef, windowRef });
        const [onVisibilityChange] = visibilityListeners;

        documentRef.visibilityState = 'hidden';
        onVisibilityChange();
        vi.advanceTimersByTime(BACKUP_REQUEST_POLL_INTERVAL_MS * 2);
        expect(checkPendingRequests).toHaveBeenCalledTimes(1);

        documentRef.visibilityState = 'visible';
        onVisibilityChange();
        expect(checkPendingRequests).toHaveBeenCalledTimes(2);

        vi.advanceTimersByTime(BACKUP_REQUEST_POLL_INTERVAL_MS);
        expect(checkPendingRequests).toHaveBeenCalledTimes(3);
        stop();
    });

    it('reconciles immediately on online while visible and cleans up listeners', () => {
        const checkPendingRequests = vi.fn();
        const stop = startBackupRequestPolling(checkPendingRequests, { documentRef, windowRef });

        windowListeners.get('online')();
        expect(checkPendingRequests).toHaveBeenCalledTimes(2);

        stop();
        expect(visibilityListeners.size).toBe(0);
        expect(windowListeners.size).toBe(0);
    });

    it('does not start periodic polling when initialized in background', () => {
        documentRef.visibilityState = 'hidden';
        const checkPendingRequests = vi.fn();
        const stop = startBackupRequestPolling(checkPendingRequests, { documentRef, windowRef });

        expect(checkPendingRequests).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(BACKUP_REQUEST_POLL_INTERVAL_MS * 2);
        expect(checkPendingRequests).toHaveBeenCalledTimes(1);
        stop();
    });
});
