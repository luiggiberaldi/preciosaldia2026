import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SafeImg from '../src/components/SafeImg.jsx';

describe('SafeImg', () => {
    it('muestra la imagen mientras carga bien', () => {
        render(<SafeImg src="./logo.png" alt="Logo" fallback={<span>respaldo</span>} />);
        expect(screen.getByAltText('Logo')).toBeTruthy();
        expect(screen.queryByText('respaldo')).toBeNull();
    });

    it('si la imagen falla, muestra el respaldo en su lugar', () => {
        render(<SafeImg src="./logo.png" alt="Logo" fallback={<span>respaldo</span>} />);
        fireEvent.error(screen.getByAltText('Logo'));
        expect(screen.queryByAltText('Logo')).toBeNull();
        expect(screen.getByText('respaldo')).toBeTruthy();
    });

    it('si cambia la imagen después de un fallo, vuelve a intentarlo', () => {
        const { rerender } = render(<SafeImg src="./a.png" alt="Logo" fallback={<span>respaldo</span>} />);
        fireEvent.error(screen.getByAltText('Logo'));
        rerender(<SafeImg src="./b.png" alt="Logo" fallback={<span>respaldo</span>} />);
        expect(screen.getByAltText('Logo').getAttribute('src')).toBe('./b.png');
    });

    it('sin src muestra el respaldo', () => {
        render(<SafeImg src="" alt="Logo" fallback={<span>respaldo</span>} />);
        expect(screen.getByText('respaldo')).toBeTruthy();
    });
});
