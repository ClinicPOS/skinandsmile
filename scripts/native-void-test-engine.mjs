import EmbeddedPostgres from 'embedded-postgres';
import {Pool} from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

export async function nativeVoidTestEngine() {
 // A new cluster with a random local credential. No environment URLs are read.
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pos-void-synthetic-'));
 const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
 const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
 const password=randomUUID();
 const postgres=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:true,
  postgresFlags:['-h','127.0.0.1'],onLog(){},onError(message){if(/FATAL|ERROR/.test(String(message)))console.error(String(message));}});
 await postgres.initialise();await postgres.start();
 const pool=new Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',max:8});
 return {query:(sql,args)=>pool.query(sql,args),exec:sql=>pool.query(sql),connect:()=>pool.connect(),
  async close(){
   await pool.end();
   if(process.platform==='win32'){
    const {pg_ctl}=await import('@embedded-postgres/windows-x64');
    await promisify(execFile)(pg_ctl,['-D',directory,'-m','fast','-w','-t','15','stop'],{windowsHide:true}).catch(async error=>{
     // Windows sandbox tokens can prevent pg_ctl signalling its parent. The
     // fallback is restricted to the exact child process we created.
     const child=postgres.process;
     if(!child?.pid)throw error;
     await promisify(execFile)(path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true});
    });
    postgres.process=undefined;
   } else await postgres.stop();
   console.log('Stopped isolated native PostgreSQL test server. Synthetic cluster retained in the temporary directory.');
  }};
}
