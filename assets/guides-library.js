const PAGE_SIZE = 20;
const INCLUDED_TYPES = new Set(['guide', 'rule', 'law']);

const topicDefinitions = {
  operations: {
    title: '운영·안전',
    description: '현장실습과 학교 노무의 운영 기준',
    categories: ['fieldTraining', 'staffLabor'],
    formsHash: 'operations',
  },
  employment: {
    title: '취업지도',
    description: '진로와 취업지원에 필요한 공식자료',
    categories: ['careerEmployment'],
    formsHash: 'employment',
  },
  protection: {
    title: '학생 보호',
    description: '학교폭력 예방과 안전 대응 기준',
    categories: ['schoolViolenceSafety'],
    formsHash: 'protection',
  },
  'student-life': {
    title: '생활·학적',
    description: '학생생활, 출결과 학적 업무 기준',
    categories: ['studentLife'],
    formsHash: 'student-life',
  },
  administration: {
    title: '행정·회계',
    description: '학교행정, 개인정보와 기록 관리 기준',
    categories: ['schoolAdmin', 'privacyRecords'],
    formsHash: 'administration',
  },
  official: {
    title: '공식자료',
    description: '교육청과 공공기관의 공통 업무자료',
    categories: ['general'],
    formsHash: 'official',
  },
};

const kindDefinitions = {
  manual: { label: '업무매뉴얼', order: 1 },
  standard: { label: '지침·기준', order: 2 },
  plan: { label: '계획·대책', order: 3 },
  legal: { label: '법령·규정', order: 4 },
  reference: { label: '참고자료', order: 5 },
};

const state = {
  entries: [],
  topic: '',
  query: '',
  kind: 'all',
  visible: PAGE_SIZE,
};

const topicButtons = [...document.querySelectorAll('[data-guide-topic]')];
const kindButtons = [...document.querySelectorAll('[data-guide-kind]')];
const searchForm = document.querySelector('#guide-search-form');
const searchInput = document.querySelector('#guide-search');
const searchReset = document.querySelector('#guide-search-reset');
const resultsSection = document.querySelector('#guide-results');
const resultsTitle = document.querySelector('#guide-results-title');
const resultsSummary = document.querySelector('#guide-results-summary');
const formsShortcut = document.querySelector('#guide-forms-shortcut');
const listMount = document.querySelector('#guide-list');
const moreButton = document.querySelector('#guide-more');

function formatNumber(value) {
  return new Intl.NumberFormat('ko-KR').format(value);
}

function cleanTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\.(hwp|hwpx|pdf|docx?|xlsx?|pptx?)$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[·ㆍ/_,()[\]{}-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractYear(entry) {
  const matches = `${entry.title || ''} ${entry.query || ''}`.match(/20(?:1\d|2\d)/g) || [];
  return matches.length ? Math.max(...matches.map(Number)) : 0;
}

function deriveKind(entry) {
  if (entry.type === 'law' || entry.type === 'rule') return 'legal';
  const title = cleanTitle(entry.title);
  if (/매뉴얼|편람|길라잡이|가이드|안내서|핸드북|업무안내/.test(title)) return 'manual';
  if (/지침|기준|기본방향|요령|준칙/.test(title)) return 'standard';
  if (/계획|대책|시행방안|추진방안/.test(title)) return 'plan';
  if (/법률|법령|규정|조례|시행령|시행규칙/.test(title)) return 'legal';
  return 'reference';
}

function deriveFormat(entry) {
  let text = `${entry.query || ''} ${entry.title || ''} ${entry.url || ''}`;
  try {
    text = decodeURIComponent(text);
  } catch {
    // Some official URLs contain partially encoded values.
  }
  const match = text.match(/\.(hwp|hwpx|pdf|docx?|xlsx?|pptx?)(?:[?&#\s]|$)/i);
  if (match) return match[1].toUpperCase();
  return entry.linkKind === 'file' ? '파일' : '원문';
}

function inferCategory(entry) {
  const title = cleanTitle(entry.title);

  if (/학교폭력|성폭력|성희롱|아동학대|학생보호|학교안전|재난대응/.test(title)) {
    return 'schoolViolenceSafety';
  }
  if (/현장실습|도제학교|산학일체형|일학습병행|직업계고\s*실습/.test(title)) {
    return 'fieldTraining';
  }
  if (
    /계약제교원|기간제교사|교육공무직|교원\s*채용|직원\s*채용|강사\s*채용|채용\s*시험|휴직|복직/.test(title)
  ) {
    return 'staffLabor';
  }
  if (/조기취업형\s*계약학과|선도대학\s*육성사업/.test(title)) {
    return 'general';
  }
  if (entry.category === 'careerEmployment') {
    return 'careerEmployment';
  }
  if (
    /고졸채용|고졸청년|직업계고.*취업|특성화고.*취업|마이스터고.*취업|취업지원|취업지도|취업상담|취업준비|취업추천|취업역량|채용연계|취업맞춤반|학교장추천|중앙취업지원센터|이력서|자기소개서|면접지도|직무역량|직업진로|진로교육|진로지도|졸업생.*취업/.test(
      title,
    )
  ) {
    return 'careerEmployment';
  }
  if (/학교생활기록부|생활기록부|학적|출결|전입|전출|편입학|학생생활/.test(title)) {
    return 'studentLife';
  }
  if (/개인정보|정보보호|기록물|정보공개/.test(title)) {
    return 'privacyRecords';
  }
  if (/학교회계|예산|결산|학교행정|계약업무|재정업무|민원업무/.test(title)) {
    return 'schoolAdmin';
  }
  if (/교직원|교육공무직|복무|노무|근로기준|산업안전보건/.test(title)) {
    return 'staffLabor';
  }
  return entry.category || 'general';
}

function groupResources(resources) {
  const groups = new Map();

  resources.filter((entry) => INCLUDED_TYPES.has(entry.type) && entry.url).forEach((entry) => {
    const title = cleanTitle(entry.title);
    const category = inferCategory(entry);
    const key = [
      category,
      normalizeSearchText(entry.provider),
      normalizeSearchText(title),
    ].join('|');
    const variant = {
      url: entry.url,
      format: deriveFormat(entry),
      linkKind: entry.linkKind,
    };

    if (!groups.has(key)) {
      const kind = deriveKind(entry);
      groups.set(key, {
        id: entry.id || key,
        title,
        provider: entry.provider || '공식기관',
        description: entry.description || '공식기관에서 공개한 업무자료입니다.',
        category,
        kind,
        year: extractYear(entry),
        variants: [variant],
        searchText: '',
      });
      return;
    }

    const group = groups.get(key);
    group.year = Math.max(group.year, extractYear(entry));
    if (!group.variants.some((item) => item.url === variant.url)) group.variants.push(variant);
  });

  return [...groups.values()].map((entry) => ({
    ...entry,
    searchText: normalizeSearchText([
      entry.title,
      entry.provider,
      entry.description,
      entry.category,
      kindDefinitions[entry.kind].label,
    ].join(' ')),
  })).sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    const kindOrder = kindDefinitions[a.kind].order - kindDefinitions[b.kind].order;
    if (kindOrder) return kindOrder;
    return a.title.localeCompare(b.title, 'ko');
  });
}

function topicForCategory(category) {
  return Object.entries(topicDefinitions)
    .find(([, definition]) => definition.categories.includes(category))?.[0] || 'official';
}

function getTopicEntries(topic) {
  const definition = topicDefinitions[topic];
  if (!definition) return [];
  return state.entries.filter((entry) => definition.categories.includes(entry.category));
}

function getBaseEntries() {
  let entries = state.entries;
  if (state.topic) entries = getTopicEntries(state.topic);

  const tokens = normalizeSearchText(state.query).split(' ').filter(Boolean);
  if (tokens.length) {
    entries = entries.filter((entry) => tokens.every((token) => entry.searchText.includes(token)));
  }
  return entries;
}

function getVisibleEntries() {
  const entries = getBaseEntries();
  return state.kind === 'all' ? entries : entries.filter((entry) => entry.kind === state.kind);
}

function updateTopicCounts() {
  topicButtons.forEach((button) => {
    const countNode = button.querySelector('[data-topic-count]');
    if (countNode) countNode.textContent = `${formatNumber(getTopicEntries(button.dataset.guideTopic).length)}건`;
  });
}

function updateKindCounts(entries) {
  kindButtons.forEach((button) => {
    const kind = button.dataset.guideKind;
    const count = kind === 'all' ? entries.length : entries.filter((entry) => entry.kind === kind).length;
    const countNode = button.querySelector(`[data-kind-count="${kind}"]`);
    if (countNode) countNode.textContent = formatNumber(count);
    button.hidden = kind !== 'all' && count === 0;
  });
}

function createBadge(text, className = '') {
  const badge = document.createElement('span');
  badge.className = `guide-badge ${className}`.trim();
  badge.textContent = text;
  return badge;
}

function createEntryCard(entry) {
  const article = document.createElement('article');
  article.className = 'guide-list-item';

  const copy = document.createElement('div');
  const badges = document.createElement('div');
  badges.className = 'guide-card-badges';
  badges.append(
    createBadge(kindDefinitions[entry.kind].label, `kind-${entry.kind}`),
    createBadge(entry.year ? `${entry.year} 자료` : '연도 확인'),
    createBadge(entry.provider),
  );

  const title = document.createElement('h3');
  title.textContent = entry.title;
  const description = document.createElement('p');
  description.textContent = entry.description;
  copy.append(badges, title, description);

  const actions = document.createElement('div');
  actions.className = 'guide-card-actions';
  entry.variants.slice(0, 4).forEach((variant, index) => {
    const link = document.createElement('a');
    link.className = 'guide-source-link';
    link.href = variant.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const suffix = entry.variants.length > 1 ? ` ${index + 1}` : '';
    link.textContent = `${variant.format} 원문${suffix}`;
    link.setAttribute('aria-label', `${entry.title} ${variant.format} 공식 원문 열기`);
    actions.append(link);
  });

  const relatedForms = document.createElement('a');
  relatedForms.className = 'guide-related-link';
  relatedForms.href = `forms.html#${topicDefinitions[topicForCategory(entry.category)].formsHash}`;
  relatedForms.textContent = '관련 서식 보기 →';
  actions.append(relatedForms);

  article.append(copy, actions);
  return article;
}

function updateLocation() {
  const url = new URL(location.href);
  if (state.query) url.searchParams.set('q', state.query);
  else url.searchParams.delete('q');
  url.hash = state.topic || '';
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function renderList(shouldScroll = false) {
  const baseEntries = getBaseEntries();
  const entries = getVisibleEntries();
  const visibleEntries = entries.slice(0, state.visible);

  resultsSection.hidden = false;
  updateKindCounts(baseEntries);
  kindButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.guideKind === state.kind));
  });

  if (state.query) {
    resultsTitle.textContent = `“${state.query}” 검색 결과`;
    resultsSummary.textContent = `${formatNumber(entries.length)}개 주제의 공식자료를 찾았습니다.`;
  } else {
    const definition = topicDefinitions[state.topic];
    resultsTitle.textContent = definition.title;
    resultsSummary.textContent = `${definition.description} ${formatNumber(entries.length)}개 주제`;
  }

  const formsHash = state.topic ? topicDefinitions[state.topic].formsHash : 'official';
  formsShortcut.href = `forms.html#${formsHash}`;

  if (visibleEntries.length) {
    listMount.replaceChildren(...visibleEntries.map(createEntryCard));
  } else {
    const empty = document.createElement('div');
    empty.className = 'guide-empty';
    empty.innerHTML = '<strong>조건에 맞는 자료가 없습니다.</strong><span>다른 단어로 검색하거나 문서 종류를 전체로 바꿔 보세요.</span>';
    listMount.replaceChildren(empty);
  }

  moreButton.hidden = state.visible >= entries.length;
  moreButton.textContent = `목록 더 보기 (${formatNumber(Math.max(0, entries.length - state.visible))}건)`;
  updateLocation();
  if (shouldScroll) resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function selectTopic(topic, shouldScroll = true) {
  if (!topicDefinitions[topic]) return;
  state.topic = topic;
  state.query = '';
  state.kind = 'all';
  state.visible = PAGE_SIZE;
  searchInput.value = '';
  topicButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.guideTopic === topic));
  });
  renderList(shouldScroll);
}

function runSearch(shouldScroll = true) {
  const query = searchInput.value.trim();
  if (!query) {
    searchInput.focus();
    return;
  }
  state.topic = '';
  state.query = query;
  state.kind = 'all';
  state.visible = PAGE_SIZE;
  topicButtons.forEach((button) => button.setAttribute('aria-pressed', 'false'));
  renderList(shouldScroll);
}

function resetLibrary() {
  state.topic = '';
  state.query = '';
  state.kind = 'all';
  state.visible = PAGE_SIZE;
  searchInput.value = '';
  topicButtons.forEach((button) => button.setAttribute('aria-pressed', 'false'));
  resultsSection.hidden = true;
  const url = new URL(location.href);
  history.replaceState(null, '', url.pathname);
  searchInput.focus();
}

function showLoadError() {
  resultsSection.hidden = false;
  resultsTitle.textContent = '업무지침을 불러오지 못했습니다.';
  resultsSummary.textContent = '공식자료 서버 연결을 확인한 뒤 잠시 후 다시 시도해 주세요.';
  listMount.replaceChildren();
}

function initialize() {
  const resources = globalThis.GYO6_PUBLIC_RESOURCE_INDEX?.resources;
  if (!Array.isArray(resources)) {
    showLoadError();
    return;
  }

  state.entries = groupResources(resources);
  updateTopicCounts();

  topicButtons.forEach((button) => {
    button.addEventListener('click', () => selectTopic(button.dataset.guideTopic));
  });
  kindButtons.forEach((button) => {
    button.addEventListener('click', () => {
      state.kind = button.dataset.guideKind;
      state.visible = PAGE_SIZE;
      renderList(false);
    });
  });
  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch();
  });
  searchReset.addEventListener('click', resetLibrary);
  moreButton.addEventListener('click', () => {
    state.visible += PAGE_SIZE;
    renderList(false);
  });

  const params = new URLSearchParams(location.search);
  const initialQuery = (params.get('q') || '').trim();
  const initialTopic = location.hash.slice(1);
  if (initialQuery) {
    searchInput.value = initialQuery;
    runSearch(false);
  } else if (topicDefinitions[initialTopic]) {
    selectTopic(initialTopic, false);
  }
}

initialize();
