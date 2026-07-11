import { createClient } from '@supabase/supabase-js';

// DB Cloud/Sync P2P: proyecto "preciosaldia rebranding" (sodgzkablshladvbtnes).
// La URL/key reales vienen de VITE_SUPABASE_CLOUD_URL / _KEY en .env.
// (Refs viejos fgzwmwrugerptfqfrsjd / ewwszyzzvoweudholmbf quedaron obsoletos.)
const supabaseUrl = import.meta.env.VITE_SUPABASE_CLOUD_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_CLOUD_KEY || '';

// Exportando cliente de supabase para los backups vinculados a la cuenta Cloud (email/password)
// Si no hay URL configurada, crear un cliente placeholder que no crashee
export const supabaseCloud = supabaseUrl
    ? createClient(supabaseUrl, supabaseKey)
    : null;
