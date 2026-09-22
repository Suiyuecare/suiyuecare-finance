import {createClient} from 'npm:@supabase/supabase-js@2.116.0';
import {createHandler} from './handler.ts';
import {BridgeError,type Purpose,type Rpc} from '../_shared/hr-finance-protocol.ts';
const url=Deno.env.get('SUPABASE_URL')!;
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const rpc=(client:ReturnType<typeof createClient>):Rpc=>async(name,args)=>{const {data,error}=await client.rpc(name,args);if(error)throw error;return data;};
const names:Record<Purpose,string>={intake:'HRFIN_BRIDGE_DISPATCH_KEY',export:'HRFIN_BRIDGE_EXPORT_KEY',callback:'HRFIN_BRIDGE_CALLBACK_KEY'};
Deno.serve(createHandler({service:rpc(admin),user:async jwt=>{
 const {data,error}=await admin.auth.getUser(jwt);if(error||!data.user||data.user.is_anonymous)throw new BridgeError('BRIDGE_UNAUTHENTICATED',401);
 return rpc(createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:`Bearer ${jwt}`}},auth:{persistSession:false,autoRefreshToken:false}}));
},secret:purpose=>Deno.env.get(names[purpose])??'',fetch}));
