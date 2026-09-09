// Read-only contract diagnostics. Never log credential-bearing request URLs or provider error bodies.
const key = process.env.MPM_PUBLIC_JOB_SERVICE_KEY;
if (!key) throw new Error('MPM credential is not configured');
const xml = (s, tag) => s.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() || '';
for (const sort of ['1', '2', 'DESC', 'desc', '내림차순']) {
  for (const dated of [false, true]) {
    const url = new URL('https://apis.data.go.kr/1760000/PblJobService/getList');
    for (const [name, value] of Object.entries({ serviceKey: decodeURIComponent(key), pageNo: '1', numOfRows: '2',
      Pblanc_ty: 'e01', Instt_se: 'g01', Sort_order: sort,
      ...(dated ? { Begin_de: '2026-09-01', End_de: '2026-09-10' } : {}) })) url.searchParams.set(name, value);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const body = await response.text();
      const records = [...body.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => ({ id: xml(m[1], 'idx'), registered: xml(m[1], 'regdate'), end: xml(m[1], 'enddate') }));
      console.log(JSON.stringify({ sort, dated, status: response.status, code: xml(body, 'resultCode'), total: xml(body, 'totalCount'), records }));
    } catch { console.log(JSON.stringify({ sort, dated, failed: true })); }
  }
}
