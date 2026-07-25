const port = process.argv[2] || '9444';
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const tab = list.find(t => t.type==='page' && t.url.startsWith('https://chatgpt.com'));
if(!tab){console.log(port,'no tab');process.exit(0);}
const ws = new WebSocket(tab.webSocketDebuggerUrl);
function ev(expr){return new Promise(res=>{const id=Math.floor(Math.random()*1e6);const h=(e)=>{const m=JSON.parse(e.data);if(m.id===id){ws.removeEventListener('message',h);res(m.result?.result?.value);}};ws.addEventListener('message',h);ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression:expr,awaitPromise:true,returnByValue:true}}));setTimeout(()=>res(null),20000);});}
await new Promise(r=>ws.onopen=r);
const ids = JSON.parse(await ev(`(async()=>{const s=await(await fetch('/api/auth/session')).json();const d=await(await fetch('/backend-api/conversations?offset=0&limit=12&order=updated',{headers:{authorization:'Bearer '+s.accessToken}})).json();return JSON.stringify((d.items??[]).map(i=>i.id));})()`)||'[]');
let latest=null;
for(const id of ids){const c=await ev(`(async()=>{const s=await(await fetch('/api/auth/session')).json();const d=await(await fetch('/backend-api/conversation/${id}',{headers:{authorization:'Bearer '+s.accessToken}})).json();const msgs=Object.values(d.mapping||{}).filter(m=>m.message&&m.message.author&&m.message.author.role==='assistant'&&m.message.content);const full=msgs.map(m=>(m.message.content.parts||[]).join(' ')).join('\n');const mine=full.includes('84c28a15f636')&&full.includes('disclosure-only');const ro=(full.match(/ROUND_OUTCOME:\s*\w+/)||[null])[0];return JSON.stringify({mine,ro,ut:d.update_time});})()`);const o=JSON.parse(c||'{}');if(o.mine)console.log('THREAD',port,id,JSON.stringify(o));}
console.log(port,'scan done');process.exit(0);
