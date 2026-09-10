// Shared by the collector and the website: a reference is never an employer notice.
export function isReferenceUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return /(^|\.)(alio\.go\.kr|work24\.go\.kr|work\.go\.kr|worknet\.go\.kr|hifive\.go\.kr|jobkorea\.co\.kr|jobaba\.net)$/.test(host)
      || /^(www\.|job\.|people\.|lab\.|search\.)?(saramin\.co\.kr|incruit\.com)$/.test(host);
  } catch { return false; }
}

export function isEmployerDetailUrl(value) {
  try {
    const u = new URL(value);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || isReferenceUrl(value)) return false;
    if (/^\/$|\/(?:main|index|list)(?:\.[^/]*|\/?)$|(?:BoardList|selectNttList|M0List)\./i.test(u.pathname)) return false;
    if (/\.(pdf|hwp|hwpx|zip|docx?|xlsx?)(?:$|[?#])|(?:download|filedown|\/file\/)/i.test(value)) return false;
    const keys = new Set(['nttsn', 'nttid', 'datasid', 'list_no', 'articleno', 'empmnid', 'emplyid',
      'projectid', 'rnm_idx', 'bbscnid', 'q_bbsdocno', 'searchboardsn', 'pstsn', 'annc_no',
      'b_num', 'reno', 'idx', 'sn', 'seq', 'seqno', 'idxno', 'no', 'wr_id', 'recruitno',
      'pstid', 'empmpbancregsn', 'post']);
    for (const [key, val] of u.searchParams) if (keys.has(key.toLowerCase()) && /^[\w-]+$/.test(val)) return true;
    if (/bbsView\.do$/i.test(u.pathname) && u.searchParams.has('bbsId') && u.searchParams.has('bbsManageId')) return true;
    if (/jobinfo_view\.asp$/i.test(u.pathname) && /^\d+$/.test(u.searchParams.get('ID') || '')) return true;
    return /\/bbs\/view\/[^/]+\/\d+\.do$/i.test(u.pathname)
      || /\/(?:jobs|jobpost|recruit|recruits|recruitments|careers\/recruit)\/[\w-]+\/?$/i.test(u.pathname)
      || /\/service\/[^/]+\/\d+\/applicant\/apply\/recruit_default\.asp$/i.test(u.pathname);
  } catch { return false; }
}

export function employerNoticeUrl(item = {}) {
  const proof = item.employerNotice;
  return proof?.status === 'verified' && isEmployerDetailUrl(proof.url) ? proof.url : '';
}

export function referenceNoticeUrl(item = {}) {
  return [item.referenceNoticeUrl, item.sourceDetailUrl, item.sourceOfficialUrl,
    item.sourceVerification?.sourceOfficialUrl, item.originalUrl, item.url]
    .find((url) => { try { return /^https?:$/.test(new URL(url).protocol); } catch { return false; } }) || '';
}
