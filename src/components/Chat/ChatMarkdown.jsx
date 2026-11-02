// Markdown mínimo del asistente: títulos, negritas/cursivas/código, viñetas,
// listas numeradas y tablas (el prompt permite tablas al comparar 3 o más elementos).

export function parseInline(text) {
    const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g);
    return parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={index} className="font-bold text-slate-950 dark:text-white">{part.slice(2, -2)}</strong>;
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={index} className="italic font-medium">{part.slice(1, -1)}</em>;
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={index} className="bg-slate-200 dark:bg-slate-700/80 px-1.5 py-0.5 rounded text-[11px] font-mono text-emerald-700 dark:text-emerald-300 font-bold">{part.slice(1, -1)}</code>;
        return part;
    });
}

const isTableLine = (line) => /^\s*\|.*\|\s*$/.test(line);
const isSeparatorRow = (line) => /^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$/.test(line);
const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());

function renderTable(block, key) {
    const rows = block.filter((line) => !isSeparatorRow(line)).map(splitRow);
    const [header, ...body] = rows;
    return (
        <div key={key} className="overflow-x-auto my-1.5">
            <table className="w-full text-[11px] border-collapse">
                <thead>
                    <tr>
                        {header.map((cell, c) => (
                            <th key={c} className="text-left font-black text-slate-900 dark:text-white border-b border-slate-300 dark:border-slate-600 px-2 py-1 whitespace-nowrap">{parseInline(cell)}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {body.map((row, r) => (
                        <tr key={r} className="border-b border-slate-200/70 dark:border-slate-700/60">
                            {row.map((cell, c) => (
                                <td key={c} className="px-2 py-1 align-top">{parseInline(cell)}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function renderChatMarkdown(text) {
    if (!text) return null;
    const lines = text.split('\n');
    const result = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const isLast = i === lines.length - 1;

        // Tabla: al menos dos líneas seguidas con barras (una sola línea aún en streaming se muestra como texto).
        if (isTableLine(line) && i + 1 < lines.length && isTableLine(lines[i + 1])) {
            const block = [];
            let j = i;
            while (j < lines.length && isTableLine(lines[j])) { block.push(lines[j]); j += 1; }
            if (block.filter((l) => !isSeparatorRow(l)).length >= 1) {
                result.push(renderTable(block, `t-${i}`));
                i = j;
                continue;
            }
        }

        if (line.startsWith('### ')) {
            result.push(<h4 key={i} className="text-xs font-black text-slate-950 dark:text-white mt-2 mb-1">{parseInline(line.slice(4))}</h4>);
        } else if (line.startsWith('## ')) {
            result.push(<h3 key={i} className="text-sm font-black text-slate-950 dark:text-white mt-2.5 mb-1">{parseInline(line.slice(3))}</h3>);
        } else if (line.startsWith('# ')) {
            result.push(<h2 key={i} className="text-sm font-black text-emerald-600 dark:text-emerald-400 mt-3 mb-1">{parseInline(line.slice(2))}</h2>);
        } else if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
            result.push(<div key={i} className="flex items-start gap-1.5 ml-1 my-0.5"><span className="text-emerald-600 dark:text-emerald-400 font-bold">•</span><span>{parseInline(line.trim().slice(2))}</span></div>);
        } else if (/^\s*\d+[.)]\s+/.test(line)) {
            const [, num, rest] = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
            result.push(<div key={i} className="flex items-start gap-1.5 ml-1 my-0.5"><span className="text-emerald-600 dark:text-emerald-400 font-bold tabular-nums">{num}.</span><span>{parseInline(rest)}</span></div>);
        } else if (line.trim() === '') {
            if (!isLast) result.push(<br key={i} />);
        } else {
            result.push(<span key={i}>{parseInline(line)}</span>);
            if (!isLast) result.push(<br key={`br-${i}`} />);
        }
        i += 1;
    }
    return result;
}
