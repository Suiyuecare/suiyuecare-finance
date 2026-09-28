import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { createHandler } from './handler.mjs';

const url = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false }
});

Deno.serve(createHandler({
  service: admin,
  staff: async (jwt: string) => {
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data.user || data.user.is_anonymous) return null;
    return createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
}));
