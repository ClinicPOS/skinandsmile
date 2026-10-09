import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {global:{fetch:async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    const method=(init?.method||'GET').toUpperCase();
    if(typeof window!=='undefined'&&url.origin===new URL(supabaseUrl).origin&&url.pathname.startsWith('/rest/v1/')&&['GET','HEAD'].includes(method)){
      const headers=new Headers(init?.headers);
      const table=url.pathname.slice('/rest/v1/'.length);
      return fetch('/api/pos-read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table,query:url.search.slice(1),range:headers.get('range'),accept:headers.get('accept'),count:headers.get('prefer')?.includes('count=exact')?'exact':null}),signal:init?.signal});
    }
    return fetch(input,init);
  }}}
)
