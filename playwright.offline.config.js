// Pruebas SIN INTERNET contra el build de producción (vite build + vite preview).
// El service worker (que guarda logos y letras para usar offline) no existe en `vite dev`,
// por eso estas pruebas van aparte de tests/e2e. Uso: npm run test:e2e:offline
import { defineConfig, devices } from '@playwright/test';

const PORT = 4199;
const OUT_DIR = 'node_modules/.cache/dist-offline'; // fuera de dist/ y ya ignorado por git

export default defineConfig({
    testDir: './tests/e2e-offline',
    timeout: 90_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    reporter: process.env.CI ? 'line' : 'list',
    use: {
        baseURL: `http://localhost:${PORT}`,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        ...devices['Desktop Chrome'],
        serviceWorkers: 'allow',
    },
    webServer: {
        command: `npx vite build --outDir ${OUT_DIR} --emptyOutDir && npx vite preview --outDir ${OUT_DIR} --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: false,
        timeout: 300_000,
    },
});
