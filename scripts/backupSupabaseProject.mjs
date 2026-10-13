import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'sodgzkablshladvbtnes';
// Token de acceso personal: solo desde el entorno, nunca en el código.
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!ACCESS_TOKEN) {
    console.error('Falta SUPABASE_ACCESS_TOKEN en el entorno.');
    process.exit(1);
}

async function querySql(sql) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Query failed (HTTP ${res.status}): ${errText}`);
    }

    return await res.json();
}

function escapeSqlValue(val) {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
    if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
    if (Array.isArray(val)) {
        // Formatear array de PostgreSQL
        const escapedItems = val.map(v => typeof v === 'string' ? `"${v.replace(/"/g, '\\"')}"` : String(v));
        return `'{${escapedItems.join(',')}}'`;
    }
    if (typeof val === 'object') {
        const jsonStr = JSON.stringify(val).replace(/'/g, "''");
        return `'${jsonStr}'::jsonb`;
    }
    const str = String(val).replace(/'/g, "''");
    return `'${str}'`;
}

async function main() {
    const startTime = new Date();
    const timestampStr = startTime.toISOString().replace(/[:.]/g, '-');
    console.log(`\n======================================================`);
    console.log(`  RESPALDO MAESTRO DE SUPABASE [${PROJECT_REF}]`);
    console.log(`  Fecha: ${startTime.toLocaleString('es-VE')}`);
    console.log(`======================================================\n`);

    // 1. Obtener lista de tablas públicas y sus columnas
    console.log(`[1/5] Extrayendo estructura de tablas y columnas (DDL)...`);
    const tablesInfo = await querySql(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name;
    `);

    const tableNames = tablesInfo.map(t => t.table_name);

    const columnsInfo = await querySql(`
        SELECT 
            table_name, 
            column_name, 
            udt_name,
            data_type, 
            is_nullable, 
            column_default 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        ORDER BY table_name, ordinal_position;
    `);

    // Primary keys
    const pkInfo = await querySql(`
        SELECT 
            tc.table_name, 
            kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name 
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY' 
          AND tc.table_schema = 'public'
        ORDER BY tc.table_name, kcu.ordinal_position;
    `);

    const pksByTable = {};
    for (const pk of pkInfo) {
        if (!pksByTable[pk.table_name]) pksByTable[pk.table_name] = [];
        pksByTable[pk.table_name].push(`"${pk.column_name}"`);
    }

    const colsByTable = {};
    for (const col of columnsInfo) {
        if (!colsByTable[col.table_name]) colsByTable[col.table_name] = [];
        colsByTable[col.table_name].push(col);
    }

    let sqlDump = `-- ======================================================\n`;
    sqlDump += `-- RESPALDO MAESTRO DE SUPABASE - PROYECTO: ${PROJECT_REF}\n`;
    sqlDump += `-- FECHA: ${startTime.toISOString()}\n`;
    sqlDump += `-- ESQUEMA: public (Tablas, Constraints, RLS, Funciones, Datos)\n`;
    sqlDump += `-- ======================================================\n\n`;
    sqlDump += `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";\n`;
    sqlDump += `CREATE EXTENSION IF NOT EXISTS "pgcrypto";\n\n`;

    // Generar CREATE TABLE
    for (const tableName of tableNames) {
        const cols = colsByTable[tableName] || [];
        const colDefs = cols.map(c => {
            let typeStr = c.data_type === 'USER-DEFINED' ? c.udt_name : c.data_type;
            if (c.data_type === 'ARRAY') typeStr = `${c.udt_name.replace(/^_/, '')}[]`;
            let def = `  "${c.column_name}" ${typeStr}`;
            if (c.column_default) def += ` DEFAULT ${c.column_default}`;
            if (c.is_nullable === 'NO') def += ` NOT NULL`;
            return def;
        });

        if (pksByTable[tableName] && pksByTable[tableName].length > 0) {
            colDefs.push(`  PRIMARY KEY (${pksByTable[tableName].join(', ')})`);
        }

        sqlDump += `CREATE TABLE IF NOT EXISTS public."${tableName}" (\n${colDefs.join(',\n')}\n);\n\n`;
        sqlDump += `ALTER TABLE public."${tableName}" ENABLE ROW LEVEL SECURITY;\n\n`;
    }
    console.log(`✓ Se generó la definición DDL de ${tableNames.length} tablas.\n`);

    // 2. Extraer políticas RLS
    console.log(`[2/5] Extrayendo políticas de seguridad (RLS)...`);
    const policies = await querySql(`
        SELECT tablename, policyname, permissive, roles, cmd, qual, with_check 
        FROM pg_policies 
        WHERE schemaname = 'public' 
        ORDER BY tablename, policyname;
    `);

    sqlDump += `-- ======================================================\n`;
    sqlDump += `-- POLÍTICAS DE ROW LEVEL SECURITY (${policies.length} políticas)\n`;
    sqlDump += `-- ======================================================\n\n`;

    for (const pol of policies) {
        const rolesStr = Array.isArray(pol.roles) ? pol.roles.join(', ') : 'public';
        sqlDump += `DO $$ BEGIN\n`;
        sqlDump += `  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = '${pol.tablename}' AND policyname = '${pol.policyname.replace(/'/g, "''")}') THEN\n`;
        sqlDump += `    CREATE POLICY "${pol.policyname.replace(/"/g, '""')}" ON public."${pol.tablename}"\n`;
        sqlDump += `      FOR ${pol.cmd}\n`;
        sqlDump += `      TO ${rolesStr}\n`;
        if (pol.qual) sqlDump += `      USING (${pol.qual})\n`;
        if (pol.with_check) sqlDump += `      WITH CHECK (${pol.with_check})\n`;
        sqlDump += `    ;\n`;
        sqlDump += `  END IF;\n`;
        sqlDump += `END $$;\n\n`;
    }
    console.log(`✓ Se respaldaron ${policies.length} políticas RLS.\n`);

    // 3. Extraer funciones almacenadas
    console.log(`[3/5] Extrayendo funciones y procedimientos almacenados...`);
    const routines = await querySql(`
        SELECT 
            p.proname as name,
            pg_get_functiondef(p.oid) as definition
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
        ORDER BY p.proname;
    `);

    sqlDump += `-- ======================================================\n`;
    sqlDump += `-- FUNCIONES ALMACENADAS (${routines.length} funciones)\n`;
    sqlDump += `-- ======================================================\n\n`;

    for (const r of routines) {
        if (r.definition) {
            sqlDump += `${r.definition};\n\n`;
        }
    }
    console.log(`✓ Se respaldaron ${routines.length} funciones almacenadas.\n`);

    // 4. Extraer datos y generar INSERTs
    console.log(`[4/5] Extrayendo registros y datos de cada tabla...`);
    const backupJson = {
        project_ref: PROJECT_REF,
        exported_at: startTime.toISOString(),
        tables: {}
    };

    sqlDump += `-- ======================================================\n`;
    sqlDump += `-- REGISTROS DE DATOS POR TABLA\n`;
    sqlDump += `-- ======================================================\n\n`;

    let totalRows = 0;

    for (const tableName of tableNames) {
        process.stdout.write(`  -> Respaldando tabla "${tableName}"... `);
        const rows = await querySql(`SELECT * FROM "${tableName}";`);
        backupJson.tables[tableName] = rows;
        totalRows += rows.length;

        sqlDump += `--\n-- Datos de: public."${tableName}" (${rows.length} filas)\n--\n`;

        if (rows.length > 0) {
            const columns = Object.keys(rows[0]);
            const colList = columns.map(c => `"${c}"`).join(', ');

            const batchSize = 100;
            for (let i = 0; i < rows.length; i += batchSize) {
                const batch = rows.slice(i, i + batchSize);
                const valuesClauses = batch.map(row => {
                    const rowVals = columns.map(col => escapeSqlValue(row[col]));
                    return `  (${rowVals.join(', ')})`;
                });

                sqlDump += `INSERT INTO public."${tableName}" (${colList})\nVALUES\n${valuesClauses.join(',\n')}\nON CONFLICT DO NOTHING;\n\n`;
            }
        } else {
            sqlDump += `-- (Tabla vacía)\n\n`;
        }

        console.log(`OK (${rows.length} filas)`);
    }

    // 5. Guardar archivos locales
    console.log(`\n[5/5] Escribiendo archivos de respaldo en disco...`);
    const backupDir = resolve('backups/supabase');
    await mkdir(backupDir, { recursive: true });

    const sqlFilePath = resolve(backupDir, `backup_${PROJECT_REF}_${timestampStr}.sql`);
    const jsonFilePath = resolve(backupDir, `backup_${PROJECT_REF}_${timestampStr}.json`);

    await writeFile(sqlFilePath, sqlDump, 'utf8');
    await writeFile(jsonFilePath, JSON.stringify(backupJson, null, 2), 'utf8');

    console.log(`\n======================================================`);
    console.log(`  ¡RESPALDO MAESTRO COMPLETADO AL 100%!`);
    console.log(`======================================================`);
    console.log(`  • Tablas DDL:          ${tableNames.length}`);
    console.log(`  • Políticas RLS:       ${policies.length}`);
    console.log(`  • Funciones SQL:       ${routines.length}`);
    console.log(`  • Filas respaldadas:   ${totalRows}`);
    console.log(`  • Archivo SQL (Dump):  ${sqlFilePath}`);
    console.log(`  • Archivo JSON (Data): ${jsonFilePath}`);
    console.log(`======================================================\n`);
}

main().catch(err => {
    console.error(`\n[ERROR] Falló el respaldo:`, err);
    process.exit(1);
});
