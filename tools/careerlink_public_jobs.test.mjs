import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCareerlinkPublicJobs } from './careerlink_public_jobs.mjs';

const entry = {
  employer: 'KB국민은행',
  url: 'https://kbstar.careerlink.kr/jobs',
  careerlinkCoNo: 'public-company-id',
  careerlinkGroupCoNo: 'public-company-id'
};
const source = { id: 'finance-large-company-recruit', name: '금융·대기업 공식채용' };
const response = (data, code = '0000') => ({ ok: true, json: async () => ({ code, data }) });

test('reads the official list and detail, preserving the employer detail URL and notice image', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body, headers: options.headers });
    if (url.endsWith('/list')) return response({ rcrtList: [{
      rcrtNo: 'recruit-1',
      coNm: 'KB국민은행',
      rcrtNm: '2026 특성화고 특별채용',
      rcrtAcptEndDtm: '2026-10-10 18:00:00',
      rcrtJobInfList: [{ jobNm: '특성화고' }]
    }] });
    return response({ rcrtInf: {
      rcrtNo: body.rcrtNo,
      coNm: 'KB국민은행',
      rcrtNm: '2026 특성화고 특별채용',
      rcrtCntn: '<p>지원자격: 특성화고 졸업예정자</p><img src="https://img.inhr.co.kr/public/notice.png">',
      rcrtJobInfList: [{ jobNm: '특성화고' }],
      rcrtAcptEndDtm: '2026-10-10 18:00:00',
      carrTypeGbcdNm: '신입',
      hireTypeGbcdNm: '정규직'
    } });
  };

  const result = await fetchCareerlinkPublicJobs({ entry, source, fetchImpl });
  assert.equal(result.complete, true);
  assert.equal(result.listCount, 1);
  assert.equal(result.records[0].education, '특성화고');
  assert.equal(result.records[0].qualificationText, '지원자격: 특성화고 졸업예정자');
  assert.equal(result.records[0].url, 'https://kbstar.careerlink.kr/jobs/recruit-1');
  assert.deepEqual(result.records[0].attachments, [{ title: '공식 채용 안내 이미지', url: 'https://img.inhr.co.kr/public/notice.png' }]);
  assert.equal(calls[0].headers.Origin, 'https://kbstar.careerlink.kr');
  assert.equal(calls[1].body.grpCoNo, 'public-company-id');
});

test('does not mistake a sibling high-school notice name for the current job track', async () => {
  const fetchImpl = async (url) => url.endsWith('/list')
    ? response({ rcrtList: [{ rcrtNo: 'recruit-2', rcrtNm: '신입행원 UB 부문', untdRcrtNmList: '특성화고 특별채용' }] })
    : response({ rcrtInf: { rcrtNo: 'recruit-2', rcrtNm: '신입행원 UB 부문', rcrtJobInfList: [{ jobNm: 'UB' }] } });
  const result = await fetchCareerlinkPublicJobs({ entry, source, fetchImpl });
  assert.equal(result.records[0].education, '');
  assert.equal(result.records[0].recruitField, 'UB');
});

test('keeps list discoveries when an individual detail fails and reports incomplete coverage', async () => {
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/list')) return response({ rcrtList: [
      { rcrtNo: 'recruit-3', rcrtNm: '특성화고 채용' },
      { rcrtNo: 'recruit-4', rcrtNm: '특성화고 채용' }
    ] });
    if (JSON.parse(options.body).rcrtNo === 'recruit-3') return response({ rcrtInf: { rcrtNo: 'recruit-3', rcrtNm: '특성화고 채용' } });
    throw new Error('detail unavailable');
  };
  const result = await fetchCareerlinkPublicJobs({ entry, source, fetchImpl, detailConcurrency: 1 });
  assert.equal(result.records.length, 2);
  assert.equal(result.detailFailures, 1);
  assert.equal(result.complete, false);
});

test('rejects a failed official API response instead of counting reachability as collection', async () => {
  await assert.rejects(fetchCareerlinkPublicJobs({
    entry,
    source,
    fetchImpl: async () => response({}, '9999')
  }), /Careerlink API/);
});
