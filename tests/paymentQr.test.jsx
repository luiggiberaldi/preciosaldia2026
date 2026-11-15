import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn(async (text) => (text === 'FALLA' ? Promise.reject(new Error('x')) : `data:image/png;base64,QR-${btoa(text)}`)) },
}));

import PaymentQr from '../src/components/PaymentQr.jsx';

describe('PaymentQr (QR de cobro sin internet)', () => {
    it('genera el QR en el equipo, sin pedirlo a una página externa', async () => {
        render(<PaymentQr text="PAGO MÓVIL" />);
        const img = await screen.findByAltText('Código QR de Pago');
        expect(img.getAttribute('src').startsWith('data:image/png')).toBe(true);
        expect(img.getAttribute('src')).not.toContain('http');
    });

    it('mientras se crea muestra un recuadro de espera', () => {
        render(<PaymentQr text="ZELLE" />);
        expect(screen.getByLabelText('Creando código QR')).toBeTruthy();
    });

    it('si no se puede crear, lo dice en vez de mostrar una imagen rota', async () => {
        render(<PaymentQr text="FALLA" />);
        expect(await screen.findByText('No se pudo crear el QR')).toBeTruthy();
    });

    it('al cambiar de cuenta se genera el QR nuevo', async () => {
        const { rerender } = render(<PaymentQr text="A" />);
        await screen.findByAltText('Código QR de Pago');
        rerender(<PaymentQr text="B" />);
        await waitFor(() => expect(screen.getByAltText('Código QR de Pago').getAttribute('src')).toContain(btoa('B')));
    });
});
