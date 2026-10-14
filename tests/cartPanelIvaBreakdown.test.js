// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CartPanel from '../src/components/Sales/CartPanel';

const cart = [{ id: 'p1', name: 'Prestobarba', priceUsd: 1, qty: 1, exactBs: 877.9 }];

function render(overrides = {}) {
    return renderToStaticMarkup(
        React.createElement(CartPanel, {
            cart,
            effectiveRate: 877.9,
            cartSubtotalUsd: 1,
            cartSubtotalBs: 877.9,
            cartBaseUsd: 1,
            cartIvaUsd: 0,
            cartTotalUsd: 1,
            cartTotalBs: 877.9,
            cartTotalCop: 0,
            cartItemCount: 1,
            discountData: null,
            copEnabled: false,
            tasaCop: 0,
            cartSelectedIndex: -1,
            ...overrides,
        })
    );
}

describe('CartPanel desglose IVA', () => {
    it('no muestra Base ni IVA cuando el IVA es 0', () => {
        const html = render();
        expect(html).not.toContain('Base (sin IVA)');
        expect(html).not.toContain('>IVA<');
    });

    it('muestra Base e IVA cuando hay IVA', () => {
        const html = render({ cartBaseUsd: 1, cartIvaUsd: 0.16, cartTotalUsd: 1.16 });
        expect(html).toContain('Base (sin IVA)');
        expect(html).toContain('$1.00');
        expect(html).toContain('>IVA<');
        expect(html).toContain('$0.16');
    });
});
