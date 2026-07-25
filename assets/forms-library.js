const FORM_VAULT_URL = 'https://gyo6-law-info.web.app/#formVault';
const PAGE_SIZE = 20;

const topicDefinitions = {
  operations: {
    title: '운영·안전',
    description: '현장실습과 학교 노무에 필요한 서식',
    categories: ['fieldTraining', 'staffLabor'],
  },
  employment: {
    title: '취업지도',
    description: '채용, 면접과 진로 지도에 필요한 서식',
    categories: ['careerEmployment'],
  },
  protection: {
    title: '학생 보호',
    description: '학교폭력 예방과 안전 대응에 필요한 서식',
    categories: ['schoolViolenceSafety'],
  },
  'student-life': {
    title: '생활·학적',
    description: '학생생활, 상담, 출결과 학적 업무 서식',
    categories: ['studentLife'],
  },
  administration: {
    title: '행정·회계',
    description: '학교행정, 개인정보와 기록 관리 서식',
    categories: ['schoolAdmin', 'privacyRecords'],
  },
  official: {
    title: '공식자료',
    description: '교육청과 공공기관에서 확인한 공통 서식',
    categories: ['general'],
  },
};

const state = {
  entries: [],
  topic: '',
  visible: PAGE_SIZE,
};

const topicButtons = [...document.querySelectorAll('[data-form-topic]')];
const resultsSection = document.querySelector('#form-results');
const resultsTitle = document.querySelector('#form-results-title');
const resultsSummary = document.querySelector('#form-results-summary');
const listMount = document.querySelector('#form-list');
const moreButton = document.querySelector('#form-more');

function formatNumber(value) {
  return new Intl.NumberFormat('ko-KR').format(value);
}

function getTopicEntries(topic) {
  const definition = topicDefinitions[topic];
  if (!definition) return [];
  return state.entries.filter((entry) => definition.categories.includes(entry.category));
}

function updateTopicCounts() {
  topicButtons.forEach((button) => {
    const count = getTopicEntries(button.dataset.formTopic).length;
    const countNode = button.querySelector('[data-topic-count]');
    if (countNode) countNode.textContent = `${formatNumber(count)}건`;
  });
}

function createEntryCard(entry) {
  const article = document.createElement('article');
  article.className = 'form-list-item';

  const copy = document.createElement('div');
  const meta = document.createElement('p');
  meta.className = 'form-list-meta';
  meta.textContent = [entry.provider, String(entry.format || '').toUpperCase()].filter(Boolean).join(' · ');

  const title = document.createElement('h3');
  title.textContent = entry.title;
  copy.append(meta, title);

  const link = document.createElement('a');
  link.className = 'btn';
  link.href = FORM_VAULT_URL;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = '승인 후 열기';
  link.setAttribute('aria-label', `${entry.title} 자료실에서 승인 후 열기`);

  article.append(copy, link);
  return article;
}

function renderTopic(topic, shouldScroll = true) {
  const definition = topicDefinitions[topic];
  if (!definition) return;

  state.topic = topic;
  state.visible = PAGE_SIZE;
  topicButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.formTopic === topic));
  });
  history.replaceState(null, '', `#${topic}`);
  renderList();
  if (shouldScroll) resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderList() {
  const definition = topicDefinitions[state.topic];
  const entries = getTopicEntries(state.topic);
  const visibleEntries = entries.slice(0, state.visible);

  resultsSection.hidden = false;
  resultsTitle.textContent = definition.title;
  resultsSummary.textContent = `${definition.description} ${formatNumber(entries.length)}건`;
  listMount.replaceChildren(...visibleEntries.map(createEntryCard));
  moreButton.hidden = state.visible >= entries.length;
  moreButton.textContent = `목록 더 보기 (${formatNumber(Math.max(0, entries.length - state.visible))}건)`;
}

function showLoadError() {
  resultsSection.hidden = false;
  resultsTitle.textContent = '서식 목록을 불러오지 못했습니다.';
  resultsSummary.textContent = '전체 서식 검색에서 최신 자료를 확인해 주세요.';
  listMount.innerHTML = `<a class="btn primary" href="${FORM_VAULT_URL}" target="_blank" rel="noopener noreferrer">전체 서식 검색</a>`;
}

function initialize() {
  const rawEntries = globalThis.GYO6_PUBLIC_RESOURCE_FORM_VAULT?.entries;
  if (!Array.isArray(rawEntries)) {
    showLoadError();
    return;
  }

  state.entries = rawEntries.filter((entry) => entry.status === 'ready');
  updateTopicCounts();

  topicButtons.forEach((button) => {
    button.addEventListener('click', () => renderTopic(button.dataset.formTopic));
  });
  moreButton.addEventListener('click', () => {
    state.visible += PAGE_SIZE;
    renderList();
  });

  const initialTopic = location.hash.slice(1);
  if (topicDefinitions[initialTopic]) renderTopic(initialTopic, false);
}

initialize();
