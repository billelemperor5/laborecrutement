/**
 * Supabase Configuration
 * Laboratoires Nedjma Recrutement
 */

const SUPABASE_URL = "https://wyfmuuevljugwkzsggpn.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_mXmaLqEQ79sXPYE082r6FQ_nqUUROjr";
const SUPABASE_BUCKET = "cv";

// Initialize Supabase Client
let supabaseClient = null;

function getSupabaseClient() {
    if (!supabaseClient) {
        if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
        } else {
            console.error("Supabase SDK is not loaded. Please ensure CDN script is included.");
        }
    }
    return supabaseClient;
}
