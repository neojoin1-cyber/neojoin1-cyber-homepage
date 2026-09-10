// Keep original downloads and extracted ZIP documents available independently of notice links.
export function attachmentUrl(value, base = 'https://gyo6.kr/jobs.html') {
  if (!value || !/^(?:https?:\/\/|\/?assets\/job-attachment-files\/)/i.test(value)) return '';
  try {
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function parseLine(value) {
  const match = String(value || '').match(/https?:\/\/\S+/i);
  return { title: match ? value.slice(0, match.index).replace(/[:：\s]+$/, '') : value,
    url: match ? match[0].replace(/[),.;]+$/, '') : '' };
}

function kindOf(title) {
  if (/지원서|입사지원|응시원서|자기소개|이력서|동의서|양식|서식/.test(title)) return '서류양식';
  if (/직무|NCS|기술서/.test(title)) return '직무자료';
  if (/공고|모집|채용|요강/.test(title)) return '공고문';
  return '첨부자료';
}

export function collectJobAttachments(item, base) {
  const files = new Map();
  const visit = (input, parent = '') => {
    const file = typeof input === 'string' ? parseLine(input) : input || {};
    const title = file.title || file.name || file.fileName || file.label || '공식 첨부자료';
    const originalUrl = attachmentUrl(file.url || file.href || file.downloadUrl || file.publicUrl || file.localUrl, base);
    const cachedUrl = /^assets\/job-attachment-files\/originals\/[a-f0-9]{64}\.[a-z0-9]+$/.test(file.cachedUrl || '')
      ? attachmentUrl(file.cachedUrl, base) : '';
    const url = cachedUrl || originalUrl;
    if (!url && title === '회사·기관 공식 공고문') return;
    const key = originalUrl || title;
    if (!files.has(key)) files.set(key, { title, url, kind: kindOf(title), parent,
      downloadName: file.downloadName || title, cached: Boolean(cachedUrl), originalUrl });
    for (const child of file.archiveEntries || file.zipEntries || []) visit(child, title);
  };
  for (const file of [
    ...(item.attachments || []), ...(item.publicRecruitDetails?.attachments || []),
    ...(item.attachmentLines || []), ...(item.teacherBriefing?.attachmentLines || [])
  ]) visit(file);
  const result = [...files.values()];
  const storedTitles = new Set(result.filter((f) => f.cached).map((f) => f.title));
  return result.filter((f) => f.cached || !storedTitles.has(f.title)).sort((a, b) => Number(b.cached) - Number(a.cached));
}
