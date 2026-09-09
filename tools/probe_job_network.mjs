// Diagnostics emit only response metadata, never credential URLs or response bodies.
import dns from 'node:dns/promises';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const targets = [
  ['alio-list', 'https://job.alio.go.kr/recruit.do?pageNo=1'],
  ['alio-detail', 'https://job.alio.go.kr/recruitview.do?idx=304432'],
  ['alio-main', 'https://www.alio.go.kr/'],
  ['data-portal', 'https://www.data.go.kr/'],
  ['moef-api', 'https://apis.data.go.kr/1051000/recruitment/list?pageNo=1&numOfRows=1', process.env.MOEF_PUBLIC_RECRUIT_SERVICE_KEY || process.env.DATA_GO_KR_SERVICE_KEY],
  ['mpm-api', 'https://apis.data.go.kr/1760000/PblJobService/getList?pageNo=1&numOfRows=1&Pblanc_ty=e01&Instt_se=g01', process.env.MPM_PUBLIC_JOB_SERVICE_KEY || process.env.DATA_GO_KR_SERVICE_KEY]
];
function metadata(body) {
  return {
    bytes: Buffer.byteLength(body),
    recruitLinks: (body.match(/recruitview\.do\?idx=/g) || []).length,
    apiCode: body.match(/<(?:returnReasonCode|resultCode)>([A-Z0-9_]+)</)?.[1] || null,
    apiError: /SERVICE_KEY_IS_NOT_REGISTERED|SERVICE_ACCESS_DENIED|PERMISSION_DENIED|NO_OPENAPI_SERVICE|LIMITED_NUMBER/.test(body)
  };
}
for (const host of [...new Set(targets.map(([,url])=>new URL(url).hostname))]) {
  try { console.log(JSON.stringify({host,dns:await dns.lookup(host,{all:true})})); }
  catch(e) {console.log(JSON.stringify({host,dnsError:e.code}));}
}
for (const [id, raw, key] of targets) {
  const url = key ? raw + '&serviceKey=' + (/%[0-9a-f]{2}/i.test(key) ? key : encodeURIComponent(key)) : raw;
  for (const transport of ['fetch','https-ipv4','curl-ipv4']) {
    const start = Date.now();
    try {
      let status, body;
      if (transport === 'fetch') {
        const response = await fetch(url,{signal:AbortSignal.timeout(8000)});
        status=response.status; body=await response.text();
      } else if (transport === 'https-ipv4') {
        const response = await new Promise((resolve,reject)=>{
          const req=https.get(url,{family:4,timeout:8000},res=>{
            const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()}));
          });req.on('timeout',()=>req.destroy(Object.assign(new Error('timeout'),{code:'TIMEOUT'})));req.on('error',reject);
        });status=response.status;body=response.body;
      } else {
        const result=await exec(process.platform==='win32'?'curl.exe':'curl',['-4','-L','--silent','--show-error','--max-time','8','--write-out','\nHTTP_STATUS:%{http_code}',url],{timeout:10000,maxBuffer:5*1024*1024,windowsHide:true});
        status=Number(result.stdout.match(/HTTP_STATUS:(\d+)$/)?.[1]);body=result.stdout.replace(/\nHTTP_STATUS:\d+$/,'');
      }
      console.log(JSON.stringify({id,transport,status,ms:Date.now()-start,...metadata(body)}));
    } catch(e) {
      console.log(JSON.stringify({id,transport,error:String(e.cause?.code||e.code||e.name),ms:Date.now()-start}));
    }
  }
}
