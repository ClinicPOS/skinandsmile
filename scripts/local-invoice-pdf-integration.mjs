import assert from 'node:assert/strict';
const app='http://127.0.0.1:3001';
let cookie;
try {
 const anonymous=await fetch(app+'/api/generate-invoice-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({html:'<p>TEST</p>'})});
 assert.ok([401,403].includes(anonymous.status));
 const login=await fetch(app+'/api/auth/staff-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner.demo@local.test',password:'LocalOwnerTestOnly!42'})});
 assert.equal(login.status,200);cookie=login.headers.get('set-cookie').match(/app-auth=[^;]+/)[0];
 const headers={'Content-Type':'application/json',Cookie:cookie};
 assert.equal((await fetch(app+'/api/generate-invoice-pdf',{method:'POST',headers,body:JSON.stringify({html:42})})).status,400);
 const response=await fetch(app+'/api/generate-invoice-pdf',{method:'POST',headers,body:JSON.stringify({html:'<html><body><h1>TEST ONLY Invoice</h1><p>AED 105.00</p><img src="http://127.0.0.1:1/private-resource"><script>throw Error("must not execute")</script></body></html>',filename:'test-invoice.pdf'})});
 assert.equal(response.status,200,await response.clone().text());
 assert.equal(response.headers.get('content-type'),'application/pdf');
 const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.ok(bytes.length>1000);
 console.log('PASS: invoice PDF renders, anonymous access and malformed HTML are rejected, blocked image does not stall printing.');
}finally{if(cookie)await fetch(app+'/api/auth/logout',{method:'POST',headers:{Cookie:cookie}});}
