import { createClient } from '@supabase/supabase-js';

// DB Cloud/Sync P2P: proyecto "preciosaldia rebranding" (sodgzkablshladvbtnes).
// La URL/key reales vienen de VITE_SUPABASE_CLOUD_URL / _KEY en .env.
// (Refs viejos fgzwmwrugerptfqfrsjd / ewwszyzzvoweudholmbf quedaron obsoletos.)
const supabaseUrl = import.meta.env.VITE_SUPABASE_CLOUD_URL || import.meta.env.VITE_SUPABASE_URL || 'https://sodgzkablshladvbtnes.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_CLOUD_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvZGd6a2FibHNobGFkdmJ0bmVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMjAzMTEsImV4cCI6MjA5Nzg5NjMxMX0.oCgDF4IakAjoMwplkwDxPHBqngfiYL60biRKLhuzsMU';

export const supabaseCloud = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
    },
});
