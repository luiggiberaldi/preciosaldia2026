(() => {
    if (location.origin !== 'http://127.0.0.1:4174') return;

    localStorage.setItem('pda_device_id', 'e2e-monitor-device');
    localStorage.removeItem('pda_pairing_mode');
    localStorage.removeItem('pda_paired_device_id');
})();
