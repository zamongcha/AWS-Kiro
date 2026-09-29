// ===== SERVICE CONFIGURATIONS =====
const services = [
  { key: 'legal', icon: '⚖️', name: 'AI 법률 자문', desc: '부동산 법령과 판례 기반 법률 상담', active: true },
  { key: 'tax', icon: '💰', name: 'AI 세무 자문', desc: '부동산 세금 관련 전문 상담', active: true },
  { key: 'contract', icon: '📄', name: '계약서 분석', desc: 'AI 기반 계약서 검토 및 리스크 분석', active: true },
  { key: 'case_search', icon: '📚', name: '판례 검색', desc: '부동산 관련 판례 검색 및 분석', active: true },
  { key: 'acquisition', icon: '🏠', name: '취득비용 계산', desc: '부동산 취득 시 총 비용 계산', active: true },
  { key: 'transfer', icon: '💸', name: '양도세 계산', desc: '양도소득세 자동 계산', active: true },
  { key: 'commission', icon: '📑', name: '중개수수료 계산', desc: '부동산 중개보수 계산', active: true },
];

const serviceConfigs = {
  legal: {
    title: '⚖️ AI 법률 자문',
    subtitle: '법령과 판례를 기반으로 정확한 법률 답변을 제공합니다',
    categories: [
      { id: 'lease', name: '임대차', icon: '🏠', example: '전세 계약 만료 후 보증금을 돌려받지 못하면 어떻게 해야 하나요?' },
      { id: 'sale', name: '매매', icon: '💰', example: '부동산 매매 계약 시 주의해야 할 사항은 무엇인가요?' },
      { id: 'registration', name: '등기', icon: '📋', example: '소유권 이전 등기는 언제까지 해야 하나요?' },
      { id: 'brokerage', name: '중개', icon: '🤝', example: '공인중개사의 중개 수수료 상한은 얼마인가요?' },
      { id: 'reconstruction', name: '재건축', icon: '🏗️', example: '재건축 조합원 자격 요건은 무엇인가요?' },
    ],
    welcomeQuestions: [
      { label: '전세 보증금 미반환 시 대처 방법', query: '전세 계약 만료 후 보증금을 돌려받지 못하면 어떻게 해야 하나요?' },
      { label: '1주택자 양도소득세 비과세 요건', query: '1주택자 양도소득세 비과세 요건은 무엇인가요?' },
      { label: '공인중개사 중개 수수료 상한', query: '공인중개사의 중개 수수료 상한은 얼마인가요?' },
    ],
  },
  tax: {
    title: '💰 AI 세무 자문',
    subtitle: '세법과 국세청 자료를 기반으로 세무 상담을 제공합니다',
    categories: [
      { id: 'acquisition_tax', name: '취득세', icon: '🏷️', example: '신축 주택 취득세 감면 조건을 알려주세요' },
      { id: 'capital_gains', name: '양도소득세', icon: '💸', example: '1가구 2주택 양도소득세 비과세 요건이 뭔가요?' },
      { id: 'comprehensive', name: '종합부동산세', icon: '🏢', example: '종합부동산세 과세 기준은 어떻게 되나요?' },
      { id: 'property_tax', name: '재산세', icon: '🏠', example: '재산세 납부 시기와 계산 방법을 알려주세요' },
      { id: 'gift_tax', name: '증여세', icon: '🎁', example: '증여세 면제 한도가 어떻게 되나요?' },
    ],
    welcomeQuestions: [
      { label: '1가구 2주택 양도소득세 비과세 요건', query: '1가구 2주택 양도소득세 비과세 요건이 뭔가요?' },
      { label: '신축 주택 취득세 감면 조건', query: '신축 주택 취득세 감면 조건을 알려주세요' },
      { label: '증여세 면제 한도', query: '증여세 면제 한도가 어떻게 되나요?' },
    ],
  },
  case_search: {
    title: '📚 판례 검색',
    subtitle: '부동산 관련 판례를 검색하고 분석합니다',
    categories: [
      { id: 'lease_dispute', name: '임대차 분쟁', icon: '🏠', example: '전세보증금 반환 관련 대법원 판례를 찾아줘' },
      { id: 'sale_dispute', name: '매매 분쟁', icon: '💰', example: '이중매매 시 소유권 귀속 관련 판례를 알려줘' },
      { id: 'registration_dispute', name: '등기 분쟁', icon: '📋', example: '허위 등기로 인한 소유권 분쟁 판례가 있나요?' },
      { id: 'reconstruction_dispute', name: '재건축 분쟁', icon: '🏗️', example: '재건축 매도청구권 관련 최신 판례가 있나요?' },
      { id: 'brokerage_dispute', name: '중개 분쟁', icon: '🤝', example: '중개사 과실로 인한 손해배상 판례를 알려줘' },
    ],
    welcomeQuestions: [
      { label: '전세보증금 반환 관련 대법원 판례', query: '전세보증금 반환 관련 대법원 판례를 찾아줘' },
      { label: '재건축 매도청구권 최신 판례', query: '재건축 매도청구권 관련 최신 판례가 있나요?' },
      { label: '이중매매 소유권 귀속 판례', query: '이중매매 시 소유권 귀속 관련 판례를 알려줘' },
    ],
  },
  contract: {
    title: '📄 계약서 분석',
    subtitle: '계약서 조항을 분석해 위험 조항·독소조항·누락 특약을 검토합니다',
    categories: [
      { id: 'sale_contract', name: '매매계약', icon: '💰', example: '아파트 매매계약서인데 근저당 말소 관련 특약이 빠져도 괜찮을까요?' },
      { id: 'jeonse_contract', name: '전세계약', icon: '🏠', example: '전세보증금 3억인데 등기부에 근저당 2억이 있어요. 위험한가요?' },
      { id: 'wolse_contract', name: '월세계약', icon: '🏘️', example: '월세 계약서에 월세 1회 연체 시 즉시 퇴거 조항이 있는데 문제 없나요?' },
      { id: 'commercial_contract', name: '상가임대차', icon: '🏢', example: '상가 임대차계약서에서 권리금 회수를 포기하는 특약을 넣자는데 괜찮나요?' },
      { id: 'clause_check', name: '조항 검토', icon: '📋', example: '이 조항을 계약서에 넣어도 될까요? "임차인은 어떤 경우에도 보증금 반환을 청구할 수 없다"' },
    ],
    welcomeQuestions: [
      { label: '전세 계약 전세사기 위험도 점검', query: '전세보증금 3억인데 등기부에 근저당 2억이 있어요. 위험한가요?' },
      { label: '독소조항 여부 검토', query: '월세 계약서에 월세 1회 연체 시 즉시 퇴거 조항이 있는데 문제 없나요?' },
      { label: '특정 조항 삽입 적정성 판단', query: '이 조항을 계약서에 넣어도 될까요? "임차인은 어떤 경우에도 보증금 반환을 청구할 수 없다"' },
    ],
  },
};

// ===== STATE =====
let currentService = null;
let sessionId = sessionStorage.getItem('chatSessionId') || null;
let messageCount = 0;
let isLoading = false;

// ===== DOM =====
const mainMenuScreen = document.getElementById('mainMenuScreen');
const serviceScreen = document.getElementById('serviceScreen');
const chatArea = document.getElementById('chatArea');
const messagesDiv = document.getElementById('messages');
const queryInput = document.getElementById('queryInput');
const sendBtn = document.getElementById('sendBtn');
const charCount = document.getElementById('charCount');
const sessionInfo = document.getElementById('sessionInfo');
const categoriesDiv = document.getElementById('categories');
const serviceTitle = document.getElementById('serviceTitle');
const serviceSubtitle = document.getElementById('serviceSubtitle');
const serviceGrid = document.getElementById('serviceGrid');
// Contract upload DOM (계약서 서비스 전용)
const contractUpload = document.getElementById('contractUpload');
const contractFileInput = document.getElementById('contractFileInput');
const contractUploadBtn = document.getElementById('contractUploadBtn');
const contractUploadStatus = document.getElementById('contractUploadStatus');
const contractPreview = document.getElementById('contractPreview');
const contractPreviewImg = document.getElementById('contractPreviewImg');
// Calculator screen DOM
const calcScreen = document.getElementById('calcScreen');
const calcTitle = document.getElementById('calcTitle');
const calcSubtitle = document.getElementById('calcSubtitle');
const calcForm = document.getElementById('calcForm');
const calcFields = document.getElementById('calcFields');
const calcFormError = document.getElementById('calcFormError');
const calcSubmitBtn = document.getElementById('calcSubmitBtn');
const calcResult = document.getElementById('calcResult');
const calcAiSection = document.getElementById('calcAiSection');
const calcAiInput = document.getElementById('calcAiInput');
const calcAiBtn = document.getElementById('calcAiBtn');
const calcAiResponse = document.getElementById('calcAiResponse');

// ===== RENDER MAIN MENU =====
// 아이콘 원형 배경 파스텔 색상(인덱스별 은은한 로테이션)
var CARD_ICON_BG = [
  'bg-blue-50', 'bg-emerald-50', 'bg-amber-50', 'bg-violet-50',
  'bg-rose-50', 'bg-sky-50', 'bg-indigo-50',
];

function renderServiceGrid() {
  serviceGrid.innerHTML = services.map(function(s, i) {
    // 카드 등장 stagger: 인덱스별 지연(60ms)
    var delay = 'style="animation-delay:' + (i * 60) + 'ms"';
    var iconBg = CARD_ICON_BG[i % CARD_ICON_BG.length];
    if (s.active) {
      return '<div class="service-card card-rise active bg-white border border-gray-200 rounded-3xl p-5 sm:p-6 cursor-pointer relative flex flex-col items-start" ' + delay + ' onclick="openService(\'' + s.key + '\')">' +
        '<div class="service-icon-circle w-14 h-14 rounded-2xl ' + iconBg + ' flex items-center justify-center text-3xl mb-4">' + s.icon + '</div>' +
        '<h3 class="font-bold text-gray-800 text-base mb-1">' + s.name + '</h3>' +
        '<p class="text-xs sm:text-sm text-gray-500 leading-relaxed">' + s.desc + '</p>' +
      '</div>';
    } else {
      return '<div class="service-card card-rise disabled bg-gray-50 border border-gray-200 rounded-3xl p-5 sm:p-6 relative flex flex-col items-start" ' + delay + '>' +
        '<span class="absolute top-3 right-3 text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">\uD83D\uDD1C 준비중</span>' +
        '<div class="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center text-3xl mb-4">' + s.icon + '</div>' +
        '<h3 class="font-bold text-gray-600 text-base mb-1">' + s.name + '</h3>' +
        '<p class="text-xs sm:text-sm text-gray-400 leading-relaxed">' + s.desc + '</p>' +
      '</div>';
    }
  }).join('');
}

// ===== NAVIGATION =====
function openService(serviceKey) {
  // Calculators use a structured-form screen instead of the chat screen.
  if (calculatorConfigs[serviceKey]) {
    openCalculator(serviceKey);
    return;
  }

  currentService = serviceKey;
  sessionStorage.setItem('currentScreen', serviceKey);

  var config = serviceConfigs[serviceKey];
  serviceTitle.textContent = config.title;
  serviceSubtitle.textContent = config.subtitle;

  // Render categories
  categoriesDiv.innerHTML = config.categories.map(function(cat) {
    return '<button class="category-chip inline-flex items-center px-3 py-1.5 rounded-full text-sm bg-gray-100 hover:bg-blue-50 hover:text-blue-700 text-gray-700 border border-gray-200 hover:border-blue-200" onclick="fillQuestion(this.dataset.q)" data-q="' + escapeAttr(cat.example) + '">' +
      '<span class="mr-1">' + cat.icon + '</span>' + cat.name +
    '</button>';
  }).join('');

  // Render welcome message
  renderWelcomeMessage(config);

  // Update session info
  if (sessionId) {
    sessionInfo.textContent = '세션 ID: ' + sessionId.substring(0, 8) + '...';
  } else {
    sessionInfo.textContent = '세션 ID: 새 세션';
  }

  messageCount = 0;
  isLoading = false;

  // 계약서 서비스에서만 사진/PDF 업로드 영역을 노출한다(다른 서비스에는 영향 없음).
  if (serviceKey === 'contract') {
    contractUpload.classList.remove('hidden');
  } else {
    contractUpload.classList.add('hidden');
  }
  resetContractUpload();

  // Transition
  mainMenuScreen.classList.add('hidden');
  serviceScreen.classList.remove('hidden');
  serviceScreen.classList.remove('screen-enter-back');
  serviceScreen.classList.add('screen-enter');
}

function goBackToMenu() {
  currentService = null;
  currentCalculator = null;
  lastCalcResult = null;
  lastCalcInputs = null;
  sessionStorage.removeItem('currentScreen');

  serviceScreen.classList.add('hidden');
  serviceScreen.classList.remove('screen-enter');
  calcScreen.classList.add('hidden');
  calcScreen.classList.remove('screen-enter');
  mainMenuScreen.classList.remove('hidden');
  mainMenuScreen.classList.add('screen-enter-back');

  // 뒤로가기 시에도 인사말은 최신 날짜로 갱신(팁은 기존 표시 유지)
  renderGreeting();

  messagesDiv.innerHTML = '';
  queryInput.value = '';
  updateCharCount();

  if (contractUpload) contractUpload.classList.add('hidden');
  resetContractUpload();
}

// ===== WELCOME MESSAGE =====
function renderWelcomeMessage(config) {
  messagesDiv.innerHTML = '';
  var icon = config.title.split(' ')[0];
  var welcomeDiv = document.createElement('div');
  welcomeDiv.className = 'message-enter';

  var questionsHtml = config.welcomeQuestions.map(function(q) {
    return '<button onclick="fillQuestion(this.dataset.q)" data-q="' + escapeAttr(q.query) + '" class="block w-full text-left text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors">' +
      '\u2192 ' + q.label + '</button>';
  }).join('');

  welcomeDiv.innerHTML =
    '<div class="flex items-start gap-3">' +
      '<div class="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm flex-shrink-0">' + icon + '</div>' +
      '<div class="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%] shadow-sm">' +
        '<p class="text-gray-800 font-medium mb-2">안녕하세요! ' + config.title + ' 시스템입니다.</p>' +
        '<p class="text-gray-600 text-sm mb-3">' + config.subtitle + '</p>' +
        '<p class="text-gray-500 text-sm mb-2">\uD83D\uDCA1 이런 질문을 해보세요:</p>' +
        '<div class="space-y-1.5">' + questionsHtml + '</div>' +
      '</div>' +
    '</div>';
  messagesDiv.appendChild(welcomeDiv);
}

// ===== CHAT FUNCTIONS =====
function fillQuestion(question) {
  queryInput.value = question;
  autoResize();
  updateCharCount();
  queryInput.focus();
}

function autoResize() {
  queryInput.style.height = 'auto';
  queryInput.style.height = Math.min(queryInput.scrollHeight, 120) + 'px';
}

function updateCharCount() {
  var len = queryInput.value.length;
  // 계약서 서비스는 OCR 원문(장문) 입력을 허용하므로 상한을 크게 둔다.
  var maxLen = currentService === 'contract' ? 200000 : 1000;
  charCount.textContent = len + '/' + maxLen;
  if (len >= 10) {
    // 10자 이상이면 전송 가능. 상한 초과 시 표시만 경고색.
    if (len > maxLen) {
      charCount.classList.remove('text-gray-400');
      charCount.classList.add('text-red-400');
    } else {
      charCount.classList.remove('text-red-400');
      charCount.classList.add('text-gray-400');
    }
    sendBtn.disabled = false;
  } else {
    // 10자 미만(빈 값 포함)은 전송 불가
    charCount.classList.remove('text-gray-400');
    charCount.classList.add(len > 0 ? 'text-red-400' : 'text-gray-400');
    sendBtn.disabled = true;
  }
}

queryInput.addEventListener('input', function() { autoResize(); updateCharCount(); });
queryInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled && !isLoading) sendMessage();
  }
});

function formatResponse(text) {
  var html = text;
  var disclaimerMatch = html.match(/⚠️.*$/s);
  var disclaimer = '';
  if (disclaimerMatch) {
    disclaimer = disclaimerMatch[0].replace(/⚠️\s*/, '');
    html = html.substring(0, disclaimerMatch.index);
  }
  html = html.replace(/\*\*\[(.+?)\]\*\*/g, '<div class="section-header">[$1]</div>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\[(\d+)\]/g, '<span class="citation">[$1]</span>');
  html = html.replace(/\n\n/g, '</p><p class="mt-2">');
  html = html.replace(/\n/g, '<br>');
  html = html.replace(/<br>---<br>/g, '<hr class="my-3 border-gray-200">');
  html = html.replace(/^---<br>/gm, '<hr class="my-3 border-gray-200">');
  html = '<div class="text-sm text-gray-700 leading-relaxed"><p>' + html + '</p></div>';
  if (disclaimer) {
    html += '<div class="disclaimer-box">\u26A0\uFE0F ' + disclaimer + '</div>';
  }
  return html;
}

function addMessage(role, content, index) {
  var msgDiv = document.createElement('div');
  msgDiv.className = 'message-enter';
  if (role === 'user') {
    msgDiv.innerHTML =
      '<div class="flex justify-end">' +
        '<div class="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 max-w-[75%] shadow-sm">' +
          '<p class="text-sm">' + escapeHtml(content) + '</p>' +
        '</div>' +
      '</div>';
  } else {
    var config = serviceConfigs[currentService];
    var icon = config ? config.title.split(' ')[0] : '🏠';
    var formattedContent = formatResponse(content);

    // 후속 질문 칩(서비스별). 기존 category-chip 톤 재사용. 클릭 시 입력창 채움.
    var followUps = FOLLOW_UP_QUESTIONS[currentService] || [];
    var followUpsHtml = '';
    if (followUps.length > 0) {
      followUpsHtml =
        '<div class="flex flex-wrap gap-2 mt-2">' +
          followUps.map(function(q) {
            return '<button onclick="fillQuestion(this.dataset.q)" data-q="' + escapeAttr(q) + '" ' +
              'class="category-chip inline-flex items-center px-3 py-1.5 rounded-full text-sm bg-gray-100 hover:bg-blue-50 hover:text-blue-700 text-gray-700 border border-gray-200 hover:border-blue-200">' +
              '<span class="mr-1">\uD83D\uDCAC</span>' + escapeHtml(q) +
            '</button>';
          }).join('') +
        '</div>';
    }

    msgDiv.innerHTML =
      '<div class="flex items-start gap-3">' +
        '<div class="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm flex-shrink-0">' + icon + '</div>' +
        '<div class="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%] shadow-sm">' +
          formattedContent +
          '<div class="flex items-center flex-wrap gap-2 mt-3 pt-2 border-t border-gray-100">' +
            '<span class="text-xs text-gray-400">이 답변이 도움이 되었나요?</span>' +
            '<button onclick="sendFeedback(' + index + ', 1, this)" class="feedback-btn text-xs px-2 py-1 rounded-lg hover:bg-green-50 text-gray-500 hover:text-green-600 border border-transparent hover:border-green-200">\uD83D\uDC4D 유용해요</button>' +
            '<button onclick="sendFeedback(' + index + ', -1, this)" class="feedback-btn text-xs px-2 py-1 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-600 border border-transparent hover:border-red-200">\uD83D\uDC4E 아쉬워요</button>' +
            '<button class="copy-answer-btn feedback-btn text-xs px-2 py-1 rounded-lg hover:bg-blue-50 text-gray-500 hover:text-blue-600 border border-transparent hover:border-blue-200">\uD83D\uDCCB 복사</button>' +
          '</div>' +
          followUpsHtml +
        '</div>' +
      '</div>';

    // 복사 버튼: 원문 텍스트(content)를 클로저로 보관해 클립보드에 복사.
    var copyBtn = msgDiv.querySelector('.copy-answer-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() { copyAnswer(content, copyBtn); });
    }
  }
  messagesDiv.appendChild(msgDiv);
  scrollToBottom();
}

// 답변 원문을 클립보드에 복사하고, 성공 시 버튼 텍스트를 잠깐 바꿨다가 원복.
function copyAnswer(text, btnEl) {
  function onSuccess() {
    var original = '\uD83D\uDCCB 복사';
    btnEl.textContent = '\u2713 복사됨';
    setTimeout(function() { btnEl.textContent = original; }, 1500);
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onSuccess, function() { /* 실패 시 조용히 무시 */ });
    } else {
      // 구형 브라우저 폴백: 임시 textarea 사용.
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); onSuccess(); } catch (e) { /* 무시 */ }
      document.body.removeChild(ta);
    }
  } catch (e) { /* 무시 */ }
}

// 로딩 중 순환 문구(서비스별). 없으면 일반 세트 사용. 연출용이며 서버 진행과 무관.
var TYPING_STEPS = {
  legal: ['관련 법령을 찾고 있어요', '판례를 검토하고 있어요', '답변을 정리하고 있어요'],
  case_search: ['관련 판례를 검색하고 있어요', '판례 내용을 분석하고 있어요', '답변을 정리하고 있어요'],
  tax: ['관련 세법을 확인하고 있어요', '과세 요건을 검토하고 있어요', '답변을 정리하고 있어요'],
  contract: ['계약 조항을 살펴보고 있어요', '위험 요소를 점검하고 있어요', '답변을 정리하고 있어요'],
};
var TYPING_STEPS_DEFAULT = ['질문을 이해하고 있어요', '자료를 검토하고 있어요', '답변을 정리하고 있어요'];

// 답변 하단 후속 질문 예시 칩(서비스별). 클릭 시 입력창에 채움. 과하지 않게 2~3개.
var FOLLOW_UP_QUESTIONS = {
  legal: ['소송 절차는 어떻게 되나요?', '필요한 서류는 무엇인가요?'],
  tax: ['절세 방법이 있을까요?', '신고 기한은 언제인가요?'],
  case_search: ['관련 최신 판례가 더 있나요?', '이 판례의 핵심 쟁점은 무엇인가요?'],
  contract: ['이 조항은 수정하면 어떻게 되나요?', '추가로 넣어야 할 특약이 있나요?'],
};

// 문구 순환용 타이머 핸들(누수 방지를 위해 hideTyping에서 반드시 clear).
var typingStepTimer = null;

function showTyping() {
  var config = serviceConfigs[currentService];
  var icon = config ? config.title.split(' ')[0] : '🏠';
  var steps = TYPING_STEPS[currentService] || TYPING_STEPS_DEFAULT;
  var typingDiv = document.createElement('div');
  typingDiv.id = 'typingIndicator';
  typingDiv.className = 'message-enter';
  typingDiv.innerHTML =
    '<div class="flex items-start gap-3">' +
      '<div class="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm flex-shrink-0">' + icon + '</div>' +
      '<div class="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">' +
        '<div class="flex items-center gap-1.5">' +
          '<div class="typing-dot w-2 h-2 bg-gray-400 rounded-full"></div>' +
          '<div class="typing-dot w-2 h-2 bg-gray-400 rounded-full"></div>' +
          '<div class="typing-dot w-2 h-2 bg-gray-400 rounded-full"></div>' +
        '</div>' +
        '<p id="typingStepText" class="text-xs text-gray-400 mt-1">' + escapeHtml(steps[0]) + '</p>' +
      '</div>' +
    '</div>';
  messagesDiv.appendChild(typingDiv);
  scrollToBottom();

  // 기존 타이머가 남아있으면 정리 후 새로 시작(중복 방지).
  if (typingStepTimer) { clearInterval(typingStepTimer); typingStepTimer = null; }
  var idx = 0;
  typingStepTimer = setInterval(function() {
    var textEl = document.getElementById('typingStepText');
    if (!textEl) { clearInterval(typingStepTimer); typingStepTimer = null; return; }
    idx = (idx + 1) % steps.length;
    textEl.textContent = steps[idx];
  }, 1200);
}

function hideTyping() {
  if (typingStepTimer) { clearInterval(typingStepTimer); typingStepTimer = null; }
  var el = document.getElementById('typingIndicator');
  if (el) el.remove();
}

async function sendMessage() {
  var query = queryInput.value.trim();
  if (!query || query.length < 10 || isLoading) return;

  isLoading = true;
  sendBtn.disabled = true;
  queryInput.value = '';
  queryInput.setAttribute('maxlength', '1000'); // OCR로 완화했던 값 원복
  autoResize();
  updateCharCount();

  addMessage('user', query);
  messageCount++;
  showTyping();

  try {
    var res = await fetch('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query, sessionId: sessionId, service: currentService }),
    });

    hideTyping();

    if (!res.ok) {
      var err = await res.json();
      throw new Error(err.error || '서버 오류가 발생했습니다.');
    }

    var data = await res.json();

    if (!sessionId) {
      sessionId = data.sessionId;
      sessionStorage.setItem('chatSessionId', sessionId);
      sessionInfo.textContent = '세션 ID: ' + sessionId.substring(0, 8) + '...';
    }

    addMessage('assistant', data.answer, messageCount);
    messageCount++;

  } catch (error) {
    hideTyping();
    addErrorMessage(error.message);
  }

  isLoading = false;
  updateCharCount();
}

function addErrorMessage(text) {
  var msgDiv = document.createElement('div');
  msgDiv.className = 'message-enter';
  msgDiv.innerHTML =
    '<div class="flex items-start gap-3">' +
      '<div class="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-sm flex-shrink-0">\u26A0\uFE0F</div>' +
      '<div class="bg-red-50 border border-red-200 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%]">' +
        '<p class="text-sm text-red-700">' + escapeHtml(text) + '</p>' +
      '</div>' +
    '</div>';
  messagesDiv.appendChild(msgDiv);
  scrollToBottom();
}

async function sendFeedback(messageIndex, rating, btnEl) {
  try {
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId, messageIndex: messageIndex, rating: rating }),
    });
    var parent = btnEl.parentElement;
    parent.innerHTML = '<span class="text-xs text-green-600">\u2713 피드백을 보내주셔서 감사합니다!</span>';
  } catch (e) {
    console.error('피드백 전송 실패:', e);
  }
}

function scrollToBottom() {
  requestAnimationFrame(function() {
    chatArea.scrollTop = chatArea.scrollHeight;
  });
}

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===================================================================
// ===== 계약서 사진/PDF 업로드 → OCR (계약서 서비스 전용) =====
// ===================================================================
//
// 파일을 base64로 읽어 /api/contract/ocr 로 전송하고, 추출된 계약서 텍스트를
// 채팅 입력창(queryInput)에 채워넣는다. 사용자가 확인·수정 후 전송 버튼으로 분석한다.
// 기존 채팅(직접 입력) 흐름과 /api/questions 통합은 그대로 유지된다.

var OCR_ALLOWED_MIME = ['image/jpeg', 'image/png', 'application/pdf'];
var OCR_MAX_BYTES = 20 * 1024 * 1024; // 20MB

function resetContractUpload() {
  if (!contractUpload) return;
  if (contractFileInput) contractFileInput.value = '';
  if (contractUploadStatus) {
    contractUploadStatus.textContent = '';
    contractUploadStatus.className = 'text-xs text-gray-500';
  }
  if (contractPreview) contractPreview.classList.add('hidden');
  if (contractPreviewImg) contractPreviewImg.removeAttribute('src');
  if (contractUploadBtn) {
    contractUploadBtn.disabled = false;
    contractUploadBtn.textContent = '텍스트 추출';
  }
}

function setContractStatus(message, kind) {
  if (!contractUploadStatus) return;
  var color = kind === 'error' ? 'text-red-600' : (kind === 'success' ? 'text-green-600' : 'text-gray-500');
  contractUploadStatus.textContent = message;
  contractUploadStatus.className = 'text-xs ' + color;
}

// File -> base64 문자열(순수 base64, data URL 접두사 제외)
function readFileAsBase64(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function() {
      var result = String(reader.result || '');
      var commaIdx = result.indexOf(',');
      resolve(commaIdx !== -1 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = function() { reject(new Error('파일을 읽지 못했습니다.')); };
    reader.readAsDataURL(file);
  });
}

async function uploadContractFile() {
  if (!contractFileInput || !contractFileInput.files || contractFileInput.files.length === 0) {
    setContractStatus('먼저 파일을 선택해 주세요.', 'error');
    return;
  }

  var file = contractFileInput.files[0];

  // MIME 검증 (image/* 또는 application/pdf). 일부 브라우저는 jpg를 image/jpeg로 보고.
  var mimeType = file.type;
  if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
  if (OCR_ALLOWED_MIME.indexOf(mimeType) === -1) {
    setContractStatus('이미지(JPG/PNG) 또는 PDF만 업로드할 수 있습니다.', 'error');
    return;
  }
  if (file.size > OCR_MAX_BYTES) {
    setContractStatus('파일이 너무 큽니다. 최대 20MB까지 가능합니다.', 'error');
    return;
  }

  // 이미지면 미리보기 썸네일 표시
  if (mimeType.indexOf('image/') === 0 && contractPreview && contractPreviewImg) {
    contractPreviewImg.src = URL.createObjectURL(file);
    contractPreview.classList.remove('hidden');
  } else if (contractPreview) {
    contractPreview.classList.add('hidden');
  }

  contractUploadBtn.disabled = true;
  contractUploadBtn.textContent = '추출 중...';
  setContractStatus('계약서 텍스트를 추출하고 있습니다...', 'info');

  try {
    var base64 = await readFileAsBase64(file);

    var res = await fetch('/api/contract/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileBase64: base64, mimeType: mimeType }),
    });

    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }

    if (!res.ok || !data || !data.success) {
      var msg = (data && data.error) ? data.error : ('텍스트 추출에 실패했습니다. (HTTP ' + res.status + ')');
      setContractStatus(msg, 'error');
      return;
    }

    var extracted = (data.text || '').trim();
    if (!extracted) {
      setContractStatus('추출된 텍스트가 없습니다. 더 선명한 파일을 사용해 주세요.', 'error');
      return;
    }

    // 추출 텍스트를 입력창에 채워넣고 분석 요청 문구를 덧붙인다.
    // maxlength(1000)에 걸리지 않도록 요청 문구 + 계약서 원문을 합쳐 넣되,
    // 길이 초과 시 maxlength 속성을 완화해 전체 텍스트를 보존한다.
    var prompt = '다음 계약서를 분석해줘.\n\n[계약서 원문]\n' + extracted;
    if (prompt.length > 1000) {
      queryInput.setAttribute('maxlength', String(prompt.length + 100));
    }
    queryInput.value = prompt;
    autoResize();
    updateCharCount();
    queryInput.focus();

    setContractStatus('추출 완료! 입력창에서 내용을 확인·수정한 뒤 전송하세요.', 'success');
  } catch (error) {
    setContractStatus(error && error.message ? error.message : '업로드 중 오류가 발생했습니다.', 'error');
  } finally {
    contractUploadBtn.disabled = false;
    contractUploadBtn.textContent = '텍스트 추출';
  }
}

// ===================================================================
// ===== CALCULATORS (structured input forms) =====
// ===================================================================
//
// 계산기는 채팅형 서비스와 달리 구조화 입력 폼을 렌더링하고, 로컬 서버의
// /calculators/* 엔드포인트로 fetch 하여 결정론적 계산 결과를 표시한다.
// 응답 봉투: 성공 { success:true, data:<결과> } / 실패 { success:false, error }.

// 서비스 카드 key -> 계산기 유형(CalculatorType) 매핑
var CALC_TYPE_BY_KEY = {
  acquisition: 'acquisition',
  transfer: 'transfer_tax',
  commission: 'brokerage',
};

// 사용 가능 기준연도(폼 렌더 시 서버에서 채움, 실패 시 이 기본값 사용)
var DEFAULT_BASE_YEARS = [2026, 2025, 2024];

// 각 계산기의 폼 필드 정의. field 이름은 백엔드 인터페이스 필드명과 정확히 일치한다.
// type: number | select | checkbox. dependsOn: 특정 필드 값일 때만 표시.
var calculatorConfigs = {
  acquisition: {
    calculatorType: 'acquisition',
    endpoint: '/calculators/acquisition',
    title: '🏠 취득비용 계산',
    subtitle: '취득세·지방교육세·농특세·국민주택채권·법무사 수수료·인지세를 산출합니다',
    // '예시로 채우기' 버튼이 폼에 입력할 샘플 값. 계산 로직에는 영향을 주지 않는 편의 기능이다.
    sample: {
      purchasePrice: 500000000,
      officialPriceUnknown: false,
      officialPrice: 400000000,
      exclusiveArea: 84.9,
      propertyType: 'house',
      housingCount: 'one',
      reductionType: 'none',
      isAdjustmentArea: false,
      useJudicialScrivener: true,
    },
    fields: [
      { name: 'purchasePrice', label: '취득가액 (원)', type: 'number', placeholder: '예: 500000000', money: true },
      { name: 'officialPrice', label: '공시가격 (원, 선택)', type: 'number', placeholder: '예: 400000000', money: true,
        help: "신축도 국민주택채권 매입 의무가 있습니다. 다만 신축 시가표준액이 자동 조회되지 않을 수 있으니, 시가표준액(또는 예상 공시가격)을 알고 있으면 입력하세요. 모르면 '공시가격 미정'을 선택하면 채권을 제외하고 계산합니다." },
      // UI 전용 플래그(서버로 전송하지 않음). 체크 시 공시가격 입력을 비활성화하고 payload에서 officialPrice 제외.
      { name: 'officialPriceUnknown', label: '공시가격 미정(신축 등) — 채권 제외하고 계산', type: 'checkbox', uiOnly: true },
      { name: 'exclusiveArea', label: '전용면적 (㎡)', type: 'number', placeholder: '예: 84.9', step: 'any' },
      { name: 'propertyType', label: '부동산 유형', type: 'select', options: [
        { value: 'house', label: '주택' },
        { value: 'non_house', label: '비주택' },
      ] },
      { name: 'nonHouseType', label: '비주택 유형', type: 'select',
        dependsOn: { field: 'propertyType', value: 'non_house' }, options: [
          { value: 'general', label: '일반(상가·건물·토지 등)' },
          { value: 'farmland', label: '농지' },
          { value: 'original_acquisition', label: '원시취득(신축 보존등기)' },
        ] },
      { name: 'housingCount', label: '주택 수', type: 'select', options: [
        { value: 'one', label: '1주택' },
        { value: 'two', label: '2주택' },
        { value: 'three_or_more', label: '3주택 이상' },
      ] },
      { name: 'reductionType', label: '감면 유형', type: 'select', options: [
        { value: 'none', label: '감면 없음' },
        { value: 'first_time_buyer', label: '생애최초 주택 구입' },
        { value: 'newlywed', label: '신혼부부' },
        { value: 'long_term_rental_business', label: '장기임대사업자' },
      ] },
      { name: 'rentalCondition.areaBracket', label: '장기임대: 면적 구간', type: 'select',
        dependsOn: { field: 'reductionType', value: 'long_term_rental_business' }, options: [
          { value: 'le_60', label: '60㎡ 이하' },
          { value: 'gt_60_le_85', label: '60㎡ 초과 85㎡ 이하' },
        ] },
      { name: 'rentalCondition.acquisitionRequirement', label: '장기임대: 취득 요건', type: 'select',
        dependsOn: { field: 'reductionType', value: 'long_term_rental_business' }, options: [
          { value: 'new_build', label: '신축' },
          { value: 'first_sale', label: '최초 분양' },
        ] },
      { name: 'isAdjustmentArea', label: '조정대상지역', type: 'checkbox' },
      { name: 'useJudicialScrivener', label: '법무사 등기 대행 이용', type: 'checkbox' },
    ],
  },
  transfer: {
    calculatorType: 'transfer_tax',
    endpoint: '/calculators/transfer-tax',
    title: '💸 양도세 계산',
    subtitle: '양도차익·장기보유특별공제·1세대1주택 비과세·과세표준·지방소득세를 산출합니다',
    sample: {
      transferPrice: 1100000000,
      acquisitionPrice: 300000000,
      necessaryExpense: 0,
      holdingPeriod: 5,
      residencePeriod: 3,
      housingCount: 'one',
      isSingleHouseholdOneHouse: true,
      isAdjustmentArea: false,
    },
    fields: [
      { name: 'transferPrice', label: '양도가액 (원)', type: 'number', placeholder: '예: 900000000', money: true },
      { name: 'acquisitionPrice', label: '취득가액 (원)', type: 'number', placeholder: '예: 500000000', money: true },
      { name: 'necessaryExpense', label: '필요경비 (원)', type: 'number', placeholder: '예: 20000000', money: true },
      { name: 'holdingPeriod', label: '보유기간 (년)', type: 'number', placeholder: '예: 5', step: 'any' },
      { name: 'residencePeriod', label: '거주기간 (년)', type: 'number', placeholder: '예: 3', step: 'any' },
      { name: 'housingCount', label: '주택 수', type: 'select', options: [
        { value: 'one', label: '1주택' },
        { value: 'two', label: '2주택' },
        { value: 'three_or_more', label: '3주택 이상' },
      ] },
      { name: 'isSingleHouseholdOneHouse', label: '1세대1주택', type: 'checkbox',
        help: '1세대가 1주택만 보유한 경우 체크하세요. 2년 이상 보유(조정지역은 2년 거주)·양도가액 12억원 이하면 비과세됩니다.' },
      { name: 'isAdjustmentArea', label: '조정대상지역', type: 'checkbox' },
    ],
  },
  commission: {
    calculatorType: 'brokerage',
    endpoint: '/calculators/brokerage',
    title: '📑 중개수수료 계산',
    subtitle: '거래유형·물건유형·금액 구간별 상한 요율과 한도액을 적용해 중개보수를 산출합니다',
    sample: {
      transactionType: 'sale_exchange',
      propertyType: 'house',
      salePrice: 500000000,
    },
    fields: [
      { name: 'transactionType', label: '거래 유형', type: 'select', options: [
        { value: 'sale_exchange', label: '매매/교환' },
        { value: 'lease', label: '임대차' },
      ] },
      { name: 'propertyType', label: '물건 유형', type: 'select', options: [
        { value: 'house', label: '주택' },
        { value: 'officetel', label: '오피스텔' },
        { value: 'other', label: '주택 외' },
      ] },
      { name: 'salePrice', label: '매매가액 (원)', type: 'number', placeholder: '예: 500000000', money: true,
        dependsOn: { field: 'transactionType', value: 'sale_exchange' } },
      { name: 'deposit', label: '보증금 (원)', type: 'number', placeholder: '예: 100000000', money: true,
        dependsOn: { field: 'transactionType', value: 'lease' } },
      { name: 'monthlyRent', label: '월세 (원)', type: 'number', placeholder: '예: 500000', money: true,
        dependsOn: { field: 'transactionType', value: 'lease' } },
      { name: 'officetelQualified', label: '오피스텔 전용 요율 요건 충족', type: 'checkbox',
        dependsOn: { field: 'propertyType', value: 'officetel' } },
    ],
  },
};

// 계산기 상태
var currentCalculator = null;   // 서비스 카드 key (acquisition/transfer/commission)
var lastCalcResult = null;      // 마지막 계산 결과 (data)
var lastCalcInputs = null;      // 마지막으로 전송한 입력값
var calcAvailableBaseYears = null;

// ===== 계산기 화면 진입 =====
function openCalculator(key) {
  var config = calculatorConfigs[key];
  if (!config) return;

  currentCalculator = key;
  currentService = null;
  lastCalcResult = null;
  lastCalcInputs = null;
  sessionStorage.setItem('currentScreen', key);

  calcTitle.textContent = config.title;
  calcSubtitle.textContent = config.subtitle;
  calcResult.innerHTML = '';
  calcAiSection.classList.add('hidden');
  calcAiResponse.innerHTML = '';
  if (calcAiInput) calcAiInput.value = '';
  calcFormError.classList.add('hidden');
  calcFormError.textContent = '';

  // 세율 확인 패널은 계산기 전환 시 닫는다(이전 계산기 세율표 잔존 방지).
  var ratePanel = document.getElementById('calcRateTablePanel');
  if (ratePanel) { ratePanel.classList.add('hidden'); ratePanel.innerHTML = ''; }

  renderCalcForm(config);

  // 기준연도 목록을 서버에서 가져와 select 옵션을 갱신한다(실패해도 기본값 사용).
  loadBaseYears(config.calculatorType);

  mainMenuScreen.classList.add('hidden');
  serviceScreen.classList.add('hidden');
  calcScreen.classList.remove('hidden');
  calcScreen.classList.remove('screen-enter-back');
  calcScreen.classList.add('screen-enter');
}

// ===== 폼 렌더링 =====
function renderCalcForm(config) {
  var years = calcAvailableBaseYears && calcAvailableBaseYears.length ? calcAvailableBaseYears : DEFAULT_BASE_YEARS;
  var html = config.fields.map(function(f) { return renderCalcField(f); }).join('');
  // 기준연도 필드는 모든 계산기 공통으로 마지막에 추가한다.
  html += renderCalcField({
    name: 'baseYear', label: '기준연도', type: 'select',
    options: years.map(function(y) { return { value: String(y), label: String(y) + '년' }; }),
  });
  calcFields.innerHTML = html;

  // dependsOn 필드 표시/숨김을 초기화하고, 변경 시 갱신되도록 이벤트를 건다.
  var controls = calcFields.querySelectorAll('[data-field]');
  controls.forEach(function(el) {
    el.addEventListener('change', function() { updateDependentFields(config); });
    el.addEventListener('input', function() {
      clearFieldError(el.getAttribute('data-field'));
      if (el.hasAttribute('data-money-input')) updateMoneyHint(el);
    });
  });

  // 취득비용 계산기: '공시가격 미정' 체크박스가 공시가격 입력칸을 제어하도록 연결한다.
  // 체크 시 입력칸 비활성화 + 값/힌트 초기화, 해제 시 다시 활성화. (UI 전용 로직)
  var unknownEl = calcFields.querySelector('[data-field="officialPriceUnknown"]');
  if (unknownEl) {
    unknownEl.addEventListener('change', function() {
      applyOfficialPriceUnknown(unknownEl.checked);
    });
    applyOfficialPriceUnknown(unknownEl.checked);
  }

  // 양도세 계산기: '주택 수'(housingCount)가 1주택('one')일 때 '1세대1주택'
  // (isSingleHouseholdOneHouse) 체크박스를 자동 반영한다. 주택 수 변경 시에만
  // 자동 설정하며, 그 후 사용자가 체크박스를 수동으로 토글하는 것은 덮어쓰지 않는다.
  if (config.calculatorType === 'transfer_tax') {
    var housingEl = calcFields.querySelector('[data-field="housingCount"]');
    var singleHouseEl = calcFields.querySelector('[data-field="isSingleHouseholdOneHouse"]');
    if (housingEl && singleHouseEl) {
      var syncSingleHouse = function() {
        singleHouseEl.checked = getFieldValue(housingEl) === 'one';
      };
      housingEl.addEventListener('change', syncSingleHouse);
      // 최초 렌더 시 현재 주택 수 값 기준으로 1회 초기 반영(기본값 'one'이면 체크된 상태로 시작).
      syncSingleHouse();
    }
  }

  updateDependentFields(config);
}

// '공시가격 미정' 상태를 공시가격 입력칸에 반영한다.
// checked=true 이면 공시가격 입력을 비활성화하고 값·오류·금액힌트를 비운다.
function applyOfficialPriceUnknown(checked) {
  var priceEl = calcFields.querySelector('[data-field="officialPrice"]');
  if (!priceEl) return;
  if (checked) {
    priceEl.value = '';
    priceEl.setAttribute('disabled', 'disabled');
    priceEl.classList.add('calc-field-disabled');
    clearFieldError('officialPrice');
    updateMoneyHint(priceEl); // 빈 값이므로 힌트 숨김
  } else {
    priceEl.removeAttribute('disabled');
    priceEl.classList.remove('calc-field-disabled');
  }
}

// ===== 예시로 채우기 =====
// 현재 계산기 config.sample 값을 폼의 각 필드 DOM에 세팅한다.
// 계산 payload/검증 로직은 건드리지 않고, 기존 갱신 함수(종속필드·금액힌트·연동)를 호출해
// 화면 상태만 실제 입력과 동일하게 맞춘다. (편의 기능; 계산 결과에 영향 없음)
function fillCalcSample() {
  if (!currentCalculator) return;
  var config = calculatorConfigs[currentCalculator];
  if (!config || !config.sample) return;
  var sample = config.sample;

  // 하나의 필드 값을 알맞은 컨트롤 타입으로 세팅한다.
  function setSampleField(name, value) {
    var el = calcFields.querySelector('[data-field="' + cssEscape(name) + '"]');
    if (!el) return;
    var ftype = el.getAttribute('data-ftype');
    if (ftype === 'checkbox') {
      el.checked = !!value;
    } else if (ftype === 'select') {
      el.value = String(value);
    } else {
      el.value = (value === null || value === undefined) ? '' : String(value);
    }
  }

  // '공시가격 미정' 플래그는 공시가격 입력칸을 비활성화/초기화하므로 먼저 적용해야
  // 이후 officialPrice 값 세팅이 덮이지 않는다.
  if (Object.prototype.hasOwnProperty.call(sample, 'officialPriceUnknown')) {
    setSampleField('officialPriceUnknown', sample.officialPriceUnknown);
    applyOfficialPriceUnknown(!!sample.officialPriceUnknown);
  }

  // 나머지 값 세팅(중첩 필드명 rentalCondition.* 는 data-field 속성으로 그대로 매칭됨).
  Object.keys(sample).forEach(function(name) {
    if (name === 'officialPriceUnknown') return; // 위에서 처리함
    setSampleField(name, sample[name]);
  });

  // 오류 표시 초기화.
  clearAllFieldErrors();
  calcFormError.classList.add('hidden');
  calcFormError.textContent = '';

  // 기존 갱신 로직 반영: 종속필드 표시/숨김, 금액 한글 힌트, 주택수↔1세대1주택 연동.
  updateDependentFields(config);
  calcFields.querySelectorAll('[data-money-input]').forEach(function(el) { updateMoneyHint(el); });

  if (config.calculatorType === 'transfer_tax') {
    var housingEl = calcFields.querySelector('[data-field="housingCount"]');
    var singleHouseEl = calcFields.querySelector('[data-field="isSingleHouseholdOneHouse"]');
    if (housingEl && singleHouseEl) {
      // 샘플에 명시적 1세대1주택 값이 없으면 주택 수 기준으로 자동 반영.
      if (!Object.prototype.hasOwnProperty.call(sample, 'isSingleHouseholdOneHouse')) {
        singleHouseEl.checked = getFieldValue(housingEl) === 'one';
      }
    }
  }
}

function renderCalcField(f) {
  var wrapClass = 'calc-field-wrap';
  var id = 'calc_' + f.name.replace(/\./g, '_');
  var control;
  if (f.type === 'checkbox') {
    // 체크박스 필드에도 안내 문구(help)를 렌더한다(선택 필드에만 표시).
    var checkboxHelpHtml = f.help
      ? '<p class="calc-help-msg">' + escapeHtml(f.help) + '</p>'
      : '';
    control =
      '<label class="flex items-center gap-2 mt-1 cursor-pointer">' +
        '<input type="checkbox" id="' + id + '" data-field="' + escapeAttr(f.name) + '" data-ftype="checkbox" class="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500">' +
        '<span class="text-sm text-gray-700">' + escapeHtml(f.label) + '</span>' +
      '</label>';
    return '<div class="' + wrapClass + '" data-wrap="' + escapeAttr(f.name) + '">' + control +
      checkboxHelpHtml +
      '<p class="calc-error-msg hidden" data-err="' + escapeAttr(f.name) + '"></p></div>';
  }
  if (f.type === 'select') {
    var opts = f.options.map(function(o) {
      return '<option value="' + escapeAttr(o.value) + '">' + escapeHtml(o.label) + '</option>';
    }).join('');
    control =
      '<select id="' + id + '" data-field="' + escapeAttr(f.name) + '" data-ftype="select" class="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white">' +
        opts +
      '</select>';
  } else {
    var stepAttr = f.step ? ' step="' + escapeAttr(f.step) + '"' : '';
    var moneyAttr = f.money ? ' data-money-input="1"' : '';
    control =
      '<input type="number" id="' + id + '" data-field="' + escapeAttr(f.name) + '" data-ftype="number" min="0"' + stepAttr + moneyAttr +
        ' placeholder="' + escapeAttr(f.placeholder || '') + '"' +
        ' class="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent">';
  }
  // 금액(원 단위) 필드에는 사람이 읽기 쉬운 한글 금액 표기를 실시간으로 보여줄 힌트 요소를 둔다.
  var moneyHint = f.money
    ? '<p class="calc-money-hint hidden" data-money-hint="' + escapeAttr(f.name) + '"></p>'
    : '';
  // 필드 아래 안내 문구(선택). 값이 아니라 사용법을 설명하는 정적 텍스트다.
  var helpHtml = f.help
    ? '<p class="calc-help-msg">' + escapeHtml(f.help) + '</p>'
    : '';
  return '<div class="' + wrapClass + '" data-wrap="' + escapeAttr(f.name) + '">' +
      '<label for="' + id + '" class="block text-sm font-medium text-gray-700 mb-1">' + escapeHtml(f.label) + '</label>' +
      control +
      moneyHint +
      helpHtml +
      '<p class="calc-error-msg hidden" data-err="' + escapeAttr(f.name) + '"></p>' +
    '</div>';
}

// 원 단위 정수 금액을 사람이 읽기 쉬운 한글 표기로 변환한다.
// 조/억/만 단위로 끊어 표기하고, 만 미만 잔돈은 콤마 표기로 덧붙인다.
// 예: 700000 -> "70만원", 5000000 -> "500만원", 500000000 -> "5억원",
//     1350000000 -> "13억 5,000만원", 12345 -> "1만 2,345원"
function formatKoreanMoney(value) {
  var n = Math.floor(Number(value));
  if (!isFinite(n) || n <= 0) return '';

  var UNIT_JO = 1000000000000; // 조
  var UNIT_EOK = 100000000;    // 억
  var UNIT_MAN = 10000;        // 만

  var parts = [];
  var rest = n;

  var jo = Math.floor(rest / UNIT_JO);
  rest = rest % UNIT_JO;
  if (jo > 0) parts.push(jo.toLocaleString('en-US') + '조');

  var eok = Math.floor(rest / UNIT_EOK);
  rest = rest % UNIT_EOK;
  if (eok > 0) parts.push(eok.toLocaleString('en-US') + '억');

  var man = Math.floor(rest / UNIT_MAN);
  rest = rest % UNIT_MAN;
  if (man > 0) parts.push(man.toLocaleString('en-US') + '만');

  // 만 미만 잔돈: 상위 단위가 없을 때만 단독으로, 있으면 콤마로 덧붙인다.
  if (rest > 0) parts.push(rest.toLocaleString('en-US'));

  return parts.join(' ') + '원';
}

// 금액 힌트 요소를 현재 입력값으로 갱신한다.
function updateMoneyHint(inputEl) {
  var fieldName = inputEl.getAttribute('data-field');
  var hintEl = calcFields.querySelector('[data-money-hint="' + cssEscape(fieldName) + '"]');
  if (!hintEl) return;
  var text = formatKoreanMoney(inputEl.value);
  if (text) {
    hintEl.textContent = text;
    hintEl.classList.remove('hidden');
  } else {
    hintEl.textContent = '';
    hintEl.classList.add('hidden');
  }
}

// dependsOn 조건에 따라 필드를 표시/숨김한다.
function updateDependentFields(config) {
  config.fields.forEach(function(f) {
    if (!f.dependsOn) return;
    var wrap = calcFields.querySelector('[data-wrap="' + cssEscape(f.name) + '"]');
    if (!wrap) return;
    var controllingEl = calcFields.querySelector('[data-field="' + cssEscape(f.dependsOn.field) + '"]');
    var visible = controllingEl && getFieldValue(controllingEl) === f.dependsOn.value;
    wrap.style.display = visible ? '' : 'none';
  });
}

function getFieldValue(el) {
  if (el.getAttribute('data-ftype') === 'checkbox') return el.checked;
  return el.value;
}

// dependsOn 조건상 현재 보이는 필드인지 확인한다.
function isFieldVisible(fieldName, config) {
  var def = null;
  for (var i = 0; i < config.fields.length; i++) {
    if (config.fields[i].name === fieldName) { def = config.fields[i]; break; }
  }
  if (!def || !def.dependsOn) return true;
  var el = calcFields.querySelector('[data-field="' + cssEscape(def.dependsOn.field) + '"]');
  return !!el && getFieldValue(el) === def.dependsOn.value;
}

// 폼에서 입력값을 수집해 요청 본문 객체로 변환한다(중첩 필드명 지원).
function collectCalcInputs(config) {
  var payload = {};
  // UI 전용 플래그(officialPriceUnknown)는 서버로 보내지 않으며, 체크 시 officialPrice도 제외한다.
  var unknownEl = calcFields.querySelector('[data-field="officialPriceUnknown"]');
  var officialPriceUnknown = !!(unknownEl && unknownEl.checked);
  config.fields.concat([{ name: 'baseYear', type: 'select' }]).forEach(function(f) {
    if (f.uiOnly) return; // UI 전용 필드는 payload에서 제외
    if (f.name === 'officialPrice' && officialPriceUnknown) return; // 공시가격 미정 → 미포함(신축 처리)
    if (f.dependsOn && !isFieldVisible(f.name, config)) return; // 숨겨진 필드는 전송하지 않음
    var el = calcFields.querySelector('[data-field="' + cssEscape(f.name) + '"]');
    if (!el) return;
    var ftype = el.getAttribute('data-ftype');
    var value;
    if (ftype === 'checkbox') {
      value = el.checked;
    } else if (ftype === 'number') {
      if (el.value.trim() === '') return; // 빈 값은 전송하지 않음(서버가 필수 검증)
      value = Number(el.value);
    } else {
      value = el.value;
      if (f.name === 'baseYear') value = Number(value);
    }
    setNestedValue(payload, f.name, value);
  });
  return payload;
}

function setNestedValue(obj, path, value) {
  var parts = path.split('.');
  var cur = obj;
  for (var i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

// ===== 폼 제출/계산 =====
calcForm.addEventListener('submit', function(e) {
  e.preventDefault();
  submitCalc();
});

async function submitCalc() {
  if (!currentCalculator) return;
  var config = calculatorConfigs[currentCalculator];
  clearAllFieldErrors();
  calcFormError.classList.add('hidden');
  calcFormError.textContent = '';

  var inputs = collectCalcInputs(config);
  lastCalcInputs = inputs;

  calcSubmitBtn.disabled = true;
  calcSubmitBtn.textContent = '계산 중...';

  try {
    var res = await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputs),
    });
    var body = await res.json();

    if (body && body.success) {
      lastCalcResult = body.data;
      renderCalcResult(body.data);
      showAiSection();
    } else {
      lastCalcResult = null;
      calcAiSection.classList.add('hidden');
      handleCalcError(body && body.error, config);
    }
  } catch (err) {
    lastCalcResult = null;
    calcAiSection.classList.add('hidden');
    showFormError('네트워크 오류로 계산을 완료하지 못했습니다. 입력값은 그대로 유지됩니다. 잠시 후 다시 시도해 주세요.');
  }

  calcSubmitBtn.disabled = false;
  calcSubmitBtn.textContent = '계산하기';
}

// ===== 오류 처리 (입력값 보존 + 항목별 메시지) =====
function handleCalcError(error, config) {
  if (!error) {
    showFormError('계산 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    return;
  }
  var validationErrors = error.context && error.context.validationErrors;
  if (Array.isArray(validationErrors) && validationErrors.length) {
    var shown = 0;
    validationErrors.forEach(function(ve) {
      if (ve && ve.field && showFieldError(ve.field, ve.message || '입력값을 확인해 주세요.')) shown++;
    });
    if (shown < validationErrors.length) {
      // 매칭되지 않은 오류는 상단 요약으로도 보여준다.
      showFormError(error.message || '일부 입력값이 유효하지 않습니다. 항목을 확인해 주세요.');
    }
    // 검증 실패 시 입력값은 보존한다(폼을 다시 채우지 않고 그대로 둔다).
    return;
  }
  // 검증 외 오류(기준표 미존재 등)
  showFormError(error.message || '계산을 완료하지 못했습니다.');
}

function showFieldError(fieldName, message) {
  var errEl = calcFields.querySelector('[data-err="' + cssEscape(fieldName) + '"]');
  var control = calcFields.querySelector('[data-field="' + cssEscape(fieldName) + '"]');
  if (!errEl) {
    // 중첩 필드(rentalCondition.areaBracket 등) 또는 알 수 없는 필드
    errEl = calcFields.querySelector('[data-err="' + cssEscape(fieldName) + '"]');
  }
  if (!errEl) return false;
  errEl.textContent = message;
  errEl.classList.remove('hidden');
  if (control) control.classList.add('calc-field-error');
  return true;
}

function clearFieldError(fieldName) {
  var errEl = calcFields.querySelector('[data-err="' + cssEscape(fieldName) + '"]');
  var control = calcFields.querySelector('[data-field="' + cssEscape(fieldName) + '"]');
  if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
  if (control) control.classList.remove('calc-field-error');
}

function clearAllFieldErrors() {
  calcFields.querySelectorAll('[data-err]').forEach(function(el) { el.textContent = ''; el.classList.add('hidden'); });
  calcFields.querySelectorAll('.calc-field-error').forEach(function(el) { el.classList.remove('calc-field-error'); });
}

function showFormError(msg) {
  calcFormError.textContent = msg;
  calcFormError.classList.remove('hidden');
}

// ===== 결과 렌더링 =====
function renderCalcResult(data) {
  var totalHtml =
    '<div class="calc-result-total rounded-2xl px-5 py-4">' +
      '<div class="flex items-start justify-between gap-3">' +
        '<div>' +
          '<p class="text-sm text-gray-600 mb-1">총액</p>' +
          '<p class="calc-total-amount font-bold text-blue-700">' + formatKRWWithKoreanHtml(data.total) + '</p>' +
        '</div>' +
        '<button type="button" class="calc-copy-btn shrink-0 text-xs bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-xl px-3 py-2 font-medium" onclick="copyCalcResult(this)">📋 결과 복사</button>' +
      '</div>' +
    '</div>';

  var rows = (data.lineItems || []).map(function(li) {
    var basis = li.basis || {};
    var basisParts = [];
    if (basis.formula) basisParts.push(escapeHtml(basis.formula));
    if (basis.rateTableItem) basisParts.push('기준표: ' + escapeHtml(basis.rateTableItem));
    if (typeof basis.appliedRate === 'number') basisParts.push('적용요율: ' + formatRate(basis.appliedRate));
    if (typeof basis.taxBase === 'number') basisParts.push('과세표준: ' + formatKRW(basis.taxBase));
    return '<tr>' +
        '<td><div class="text-sm font-medium text-gray-800">' + escapeHtml(li.name) + '</div>' +
          (basisParts.length ? '<div class="calc-basis">' + basisParts.join(' · ') + '</div>' : '') +
        '</td>' +
        '<td class="calc-amount text-sm text-gray-800">' + formatKRWWithKoreanHtml(li.amount) + '</td>' +
      '</tr>';
  }).join('');

  var tableHtml =
    '<div class="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">' +
      '<table class="w-full calc-line-table text-sm">' +
        '<thead><tr><th>항목 / 산출 근거</th><th class="calc-amount">금액</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';

  var detail = renderCalcDetail(data);

  var metaHtml =
    '<div class="flex flex-wrap gap-2 text-xs text-gray-500">' +
      '<span class="bg-gray-100 rounded-full px-3 py-1">기준연도: ' + escapeHtml(String(data.baseYear)) + '년</span>' +
      '<span class="bg-gray-100 rounded-full px-3 py-1">기준표 버전: ' + escapeHtml(String(data.rateTableVersion)) + '</span>' +
    '</div>';

  // 항목별 내역 + 부가상세 + 메타는 접기/펼치기(details)로 감싼다. 기본은 펼침(open)이되
  // summary 클릭으로 접을 수 있어 첫인상을 깔끔하게 유지한다.
  var detailsHtml =
    '<details class="calc-details" open>' +
      '<summary>' +
        '<span>상세 내역 보기</span>' +
        '<span class="calc-details-arrow">\u25BE</span>' +
      '</summary>' +
      '<div class="calc-details-body">' + tableHtml + detail.detailBox + metaHtml + '</div>' +
    '</details>';

  // 안내(notices)와 면책 고지는 접지 않고 항상 보이게 유지한다(중요 정보).
  var disclaimerHtml = data.disclaimer
    ? '<div class="disclaimer-box">\u26A0\uFE0F ' + escapeHtml(data.disclaimer) + '</div>'
    : '';

  calcResult.innerHTML = totalHtml + detailsHtml + detail.noticeBox + disclaimerHtml;
  scrollCalcToResult();
}

// 계산기별 부가 상세(비과세 판정·감면 안내 등)를 렌더링한다.
function renderCalcDetail(data) {
  var d = data.detail || {};
  var notes = [];

  if (data.calculatorType === 'transfer_tax') {
    if (d.isExempt) notes.push('✅ 1세대1주택 비과세 판정' + (d.exemptionBasis ? ': ' + d.exemptionBasis : ''));
    if (d.longTermDeductionTable && d.longTermDeductionTable !== 'none') {
      notes.push('장기보유특별공제 ' + (d.longTermDeductionTable === 'table1' ? '표1(1세대1주택)' : '표2(일반)') + ' 적용');
    }
  }
  if (data.calculatorType === 'acquisition' && d.reduction) {
    var r = d.reduction;
    var rate = typeof r.reductionRate === 'number' ? formatRate(r.reductionRate) : '';
    notes.push('감면 적용: ' + escapeHtml(r.reductionType) + (rate ? ' (감면율 ' + rate + ')' : '') +
      (typeof r.reducedAmount === 'number' ? ' · 감면세액 ' + formatKRW(r.reducedAmount) : ''));
    if (r.minimumPaymentApplied) {
      notes.push('최소납부세제(제177조의2) 적용' +
        (typeof r.grossReductionAmount === 'number' ? ' · 감면대상세액 ' + formatKRW(r.grossReductionAmount) : '') +
        ' → 초과분의 85%만 감면(나머지는 납부)');
    }
    if (r.postManagementNotice) notes.push('사후관리: ' + r.postManagementNotice);
  }
  if (data.calculatorType === 'brokerage') {
    if (d.usedOfficetelRate) notes.push('오피스텔 전용 요율 적용');
    if (typeof d.transactionAmount === 'number') notes.push('산정 거래금액: ' + formatKRW(d.transactionAmount) +
      (d.conversionMultiplier ? ' (환산 ' + d.conversionMultiplier + '배)' : ''));
  }

  var detailBox = notes.length
    ? '<div class="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3 text-sm text-gray-700 space-y-1">' +
        notes.map(function(n) { return '<p>' + n + '</p>'; }).join('') +
      '</div>'
    : '';

  // 안내(notices): 모든 계산기 공통. 백엔드가 detail.notices 배열로 내려준 문구를 그대로 표시한다.
  // (예: 공시가격 미정으로 국민주택채권 미산출, 공시가격 1억 이하 다주택 중과 제외 안내 등)
  var noticeBox = '';
  if (Array.isArray(d.notices) && d.notices.length) {
    noticeBox = '<div class="calc-notice-box rounded-2xl px-4 py-3 text-sm space-y-1">' +
      '<p class="calc-notice-title">\uD83D\uDCA1 안내</p>' +
      '<ul class="calc-notice-list">' +
        d.notices.map(function(n) { return '<li>' + escapeHtml(String(n)) + '</li>'; }).join('') +
      '</ul>' +
    '</div>';
  }

  return { detailBox: detailBox, noticeBox: noticeBox };
}

// ===== 결과 복사 =====
// 마지막 계산 결과(lastCalcResult)를 사람이 읽기 좋은 텍스트로 만들어 클립보드에 복사한다.
// 계산 데이터는 그대로 두고 표시/편의만 담당한다.
function buildCalcResultText(data) {
  if (!data) return '';
  var lines = [];
  if (data.title || currentCalculator) {
    var cfg = calculatorConfigs[currentCalculator];
    if (cfg && cfg.title) lines.push(cfg.title);
  }
  lines.push('총액: ' + formatKRWWithKoreanText(data.total));
  lines.push('');
  lines.push('[항목별 내역]');
  (data.lineItems || []).forEach(function(li) {
    lines.push('- ' + li.name + ': ' + formatKRWWithKoreanText(li.amount));
  });
  var d = data.detail || {};
  if (Array.isArray(d.notices) && d.notices.length) {
    lines.push('');
    lines.push('[안내]');
    d.notices.forEach(function(n) { lines.push('- ' + String(n)); });
  }
  lines.push('');
  lines.push('기준연도: ' + String(data.baseYear) + '년 · 기준표 버전: ' + String(data.rateTableVersion));
  if (data.disclaimer) {
    lines.push('');
    lines.push('※ ' + String(data.disclaimer));
  }
  return lines.join('\n');
}

function copyCalcResult(btn) {
  if (!lastCalcResult) return;
  var text = buildCalcResultText(lastCalcResult);
  var onDone = function() { flashCopyButton(btn); };
  var onFail = function() { fallbackCopyText(text, btn); };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onDone, onFail);
  } else {
    fallbackCopyText(text, btn);
  }
}

// navigator.clipboard 미지원 환경용 폴백(임시 textarea + execCommand).
function fallbackCopyText(text, btn) {
  try {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    flashCopyButton(btn);
  } catch (e) {
    if (btn) { btn.textContent = '복사 실패'; setTimeout(function() { btn.textContent = '📋 결과 복사'; }, 1500); }
  }
}

// '복사됨 ✓'를 잠깐 보여준 뒤 원래 라벨로 되돌린다.
function flashCopyButton(btn) {
  if (!btn) return;
  var original = '📋 결과 복사';
  btn.textContent = '복사됨 ✓';
  btn.classList.add('copied');
  setTimeout(function() {
    btn.textContent = original;
    btn.classList.remove('copied');
  }, 1500);
}

// ===== AI에게 물어보기 =====
function showAiSection() {
  calcAiSection.classList.remove('hidden');
  calcAiResponse.innerHTML = '';
}

async function askCalcAi() {
  if (!currentCalculator || !lastCalcResult) return;
  var question = (calcAiInput.value || '').trim();
  if (!question) {
    calcAiResponse.innerHTML = '<p class="text-sm text-red-600">질문을 입력해 주세요.</p>';
    return;
  }
  var config = calculatorConfigs[currentCalculator];

  // 계산 컨텍스트 구성: 방금 계산 결과의 total/lineItems/appliedRates/taxBase + 입력값
  var appliedRates = {};
  (lastCalcResult.lineItems || []).forEach(function(li) {
    if (li.basis && typeof li.basis.appliedRate === 'number') appliedRates[li.name] = li.basis.appliedRate;
  });
  var taxBase;
  (lastCalcResult.lineItems || []).forEach(function(li) {
    if (li.basis && typeof li.basis.taxBase === 'number' && taxBase === undefined) taxBase = li.basis.taxBase;
  });
  if (lastCalcResult.detail && typeof lastCalcResult.detail.taxBase === 'number') taxBase = lastCalcResult.detail.taxBase;

  var contextResult = {
    total: lastCalcResult.total,
    lineItems: lastCalcResult.lineItems || [],
    appliedRates: appliedRates,
  };
  if (typeof taxBase === 'number') contextResult.taxBase = taxBase;

  var reqBody = {
    calculatorType: config.calculatorType,
    question: question,
    calculationContext: {
      inputs: lastCalcInputs || {},
      result: contextResult,
    },
  };

  calcAiBtn.disabled = true;
  calcAiBtn.textContent = '생성 중...';
  calcAiResponse.innerHTML = '<p class="text-sm text-gray-500">AI가 답변을 생성하고 있습니다...</p>';

  try {
    var res = await fetch('/calculators/ai-assist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    });
    var body = await res.json();
    if (body && body.success) {
      renderAiOutput(body.data);
    } else {
      var msg = (body && body.error && body.error.message) || 'AI 자문 보조를 사용할 수 없습니다.';
      calcAiResponse.innerHTML = '<div class="bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2 text-sm text-yellow-800">' + escapeHtml(msg) + '<br><span class="text-xs">계산 결과는 그대로 유지됩니다.</span></div>';
    }
  } catch (err) {
    calcAiResponse.innerHTML = '<div class="bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2 text-sm text-yellow-800">AI 채널에 연결하지 못했습니다. 계산 결과는 그대로 유지됩니다.</div>';
  }

  calcAiBtn.disabled = false;
  calcAiBtn.textContent = '질문하기';
}

function renderAiOutput(out) {
  // 계산 결과 영역(calcResult)은 절대 건드리지 않는다. AI 응답만 별도 영역에 표시.
  if (!out) {
    calcAiResponse.innerHTML = '<p class="text-sm text-gray-600">응답이 없습니다.</p>';
    return;
  }
  var parts = '';
  if (out.isAvailable === false) {
    parts += '<div class="bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2 text-sm text-yellow-800">AI 자문 보조를 일시적으로 사용할 수 없습니다. 계산 결과는 그대로 유지됩니다.</div>';
  } else if (out.isOutOfScope) {
    parts += '<div class="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700">부동산 취득·양도·중개보수·관련 세무 범위 밖의 질문입니다. 계산과 관련된 질문을 해주세요.</div>';
  } else if (out.answer) {
    parts += '<div class="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 text-sm text-gray-800 leading-relaxed">' +
      escapeHtml(out.answer).replace(/\n/g, '<br>') + '</div>';
  } else {
    parts += '<div class="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700">답변을 생성하지 못했습니다.</div>';
  }
  if (out.disclaimer) {
    parts += '<div class="disclaimer-box">\u26A0\uFE0F ' + escapeHtml(out.disclaimer) + '</div>';
  }
  calcAiResponse.innerHTML = parts;
}

// ===== 기준연도 로드 =====
async function loadBaseYears(calculatorType) {
  try {
    var res = await fetch('/calculators/rate-tables?type=' + encodeURIComponent(calculatorType));
    var body = await res.json();
    if (body && body.success && body.data && Array.isArray(body.data.availableBaseYears) && body.data.availableBaseYears.length) {
      calcAvailableBaseYears = body.data.availableBaseYears.slice().sort(function(a, b) { return b - a; });
      // baseYear select 옵션만 갱신(다른 입력값은 보존).
      var sel = calcFields.querySelector('[data-field="baseYear"]');
      if (sel) {
        var prev = sel.value;
        sel.innerHTML = calcAvailableBaseYears.map(function(y) {
          return '<option value="' + y + '">' + y + '년</option>';
        }).join('');
        if (calcAvailableBaseYears.indexOf(Number(prev)) !== -1) sel.value = prev;
      }
    }
  } catch (e) {
    // 실패 시 기본 연도(DEFAULT_BASE_YEARS)를 그대로 사용한다.
  }
}

// ===== 세율 확인하기 (기준표 세율 조회 패널) =====
// 현재 계산기의 기준표 세율표(rateData)를 서버에서 받아 사람이 읽기 쉬운 표로 보여준다.
// 세율 값은 참고용 추정치이며, 계산 경로와 무관한 읽기 전용 조회다.
function toggleRateTablePanel() {
  var panel = document.getElementById('calcRateTablePanel');
  if (!panel) return;
  if (!panel.classList.contains('hidden')) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }
  panel.classList.remove('hidden');
  loadRateTablePanel();
}

async function loadRateTablePanel() {
  var panel = document.getElementById('calcRateTablePanel');
  if (!panel || !currentCalculator) return;
  var config = calculatorConfigs[currentCalculator];
  if (!config) return;

  // 현재 선택된 기준연도(없으면 사용 가능 목록의 최신)를 사용한다.
  var yearEl = calcFields.querySelector('[data-field="baseYear"]');
  var baseYear = yearEl && yearEl.value ? Number(yearEl.value) :
    (calcAvailableBaseYears && calcAvailableBaseYears.length ? calcAvailableBaseYears[0] : null);

  panel.innerHTML = '<p class="text-sm text-gray-500">세율 정보를 불러오는 중...</p>';

  try {
    var url = '/calculators/rate-tables?type=' + encodeURIComponent(config.calculatorType) +
      (baseYear != null ? '&baseYear=' + encodeURIComponent(baseYear) : '');
    var res = await fetch(url);
    var body = await res.json();
    if (!body || !body.success || !body.data || body.data.found === false || !body.data.rateData) {
      panel.innerHTML = '<p class="text-sm text-red-700">세율 정보를 불러오지 못했습니다.</p>';
      return;
    }
    panel.innerHTML = renderRateTablePanel(config.calculatorType, body.data);
  } catch (e) {
    panel.innerHTML = '<p class="text-sm text-red-700">세율 정보를 불러오지 못했습니다.</p>';
  }
}

function renderRateTablePanel(type, data) {
  var rd = data.rateData;
  var head =
    '<div class="flex items-center justify-between mb-2">' +
      '<h3 class="font-bold text-gray-800 text-sm">📊 현재 기준표 세율 (참고용 추정치)</h3>' +
      '<button type="button" onclick="toggleRateTablePanel()" class="text-xs text-gray-400 hover:text-gray-700">닫기 ✕</button>' +
    '</div>' +
    '<p class="text-xs text-gray-500 mb-3">기준연도 <b>' + escapeHtml(String(data.baseYear)) + '년</b>' +
      (data.version ? ' · 버전 ' + escapeHtml(String(data.version)) : '') +
      ' · 아래 세율/요율은 <b>참고용 추정치</b>이며 실제 세액은 최신 법령·지역 조례에 따라 다를 수 있습니다.</p>';

  var body;
  if (type === 'acquisition') body = renderAcquisitionRateTable(rd);
  else if (type === 'transfer_tax') body = renderTransferRateTable(rd);
  else if (type === 'brokerage') body = renderBrokerageRateTable(rd);
  else body = '<p class="text-sm text-gray-500">지원하지 않는 유형입니다.</p>';

  return head + body;
}

// 표 헬퍼: 제목 + 행 배열([[c1,c2,...], ...]) → HTML 표
function rateTableSection(title, headers, rows) {
  var thead = '<tr>' + headers.map(function(h) {
    return '<th class="text-left px-2 py-1 font-medium text-gray-600 border-b border-gray-200">' + escapeHtml(h) + '</th>';
  }).join('') + '</tr>';
  var tbody = rows.map(function(r) {
    return '<tr>' + r.map(function(c) {
      return '<td class="px-2 py-1 border-b border-gray-100 text-gray-700">' + escapeHtml(String(c)) + '</td>';
    }).join('') + '</tr>';
  }).join('');
  return '<div class="mb-4">' +
    '<h4 class="text-xs font-bold text-gray-700 mb-1">' + escapeHtml(title) + '</h4>' +
    '<div class="overflow-x-auto"><table class="w-full text-xs border-collapse">' +
      '<thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table></div></div>';
}

function priceRangeLabel(min, max) {
  var lo = formatKRW(min || 0);
  return max != null ? (lo + ' ~ ' + formatKRW(max)) : (lo + ' 초과');
}

var HOUSING_COUNT_LABEL = { one: '1주택', two: '2주택', three_or_more: '3주택 이상' };
var NON_HOUSE_TYPE_LABEL = { general: '일반(상가·건물·토지 등)', farmland: '농지', original_acquisition: '원시취득(신축 보존등기)' };

function renderAcquisitionRateTable(rd) {
  var html = '';

  // 취득세: 주택 조건별 + 비주택 유형별로 분리 표시
  var brackets = rd.acquisitionTaxBrackets || [];
  var houseRows = brackets.filter(function(b) { return b.propertyType === 'house'; }).map(function(b) {
    return [
      HOUSING_COUNT_LABEL[b.housingCount] || b.housingCount,
      b.isAdjustmentArea ? '조정지역' : '비조정',
      priceRangeLabel(b.minPrice, b.maxPrice),
      formatRate(b.rate),
    ];
  });
  html += rateTableSection('취득세율 — 주택', ['주택 수', '조정지역', '취득가액 구간', '세율'], houseRows);

  var nonHouseRows = brackets.filter(function(b) { return b.propertyType === 'non_house'; })
    .reduce(function(acc, b) {
      // 유형별 단일세율이므로 유형당 1행만 표시(중복 제거).
      var key = b.nonHouseType || 'general';
      if (!acc.seen[key]) {
        acc.seen[key] = true;
        acc.rows.push([NON_HOUSE_TYPE_LABEL[key] || key, formatRate(b.rate)]);
      }
      return acc;
    }, { seen: {}, rows: [] }).rows;
  html += rateTableSection('취득세율 — 비주택 (유형별 단일세율)', ['비주택 유형', '세율'], nonHouseRows);

  // 부가 세율
  html += rateTableSection('부가 세율', ['항목', '값'], [
    ['지방교육세율 (취득세 대비)', formatRate(rd.localEducationTaxRate)],
    ['농어촌특별세율 (전용면적 > ' + rd.ruralSpecialTaxAreaThreshold + '㎡ 적용)', formatRate(rd.ruralSpecialTaxRate)],
    ['1억원 이하 다주택 중과 제외 특례 임계값', formatKRW(rd.lowValueExemptionThreshold)],
  ]);

  // 국민주택채권 요율
  if (Array.isArray(rd.housingBondRates)) {
    html += rateTableSection('국민주택채권 매입 요율 (공시가격 구간별)', ['공시가격 구간', '요율'],
      rd.housingBondRates.map(function(b) {
        return [priceRangeLabel(b.minOfficialPrice, b.maxOfficialPrice), formatRate(b.rate)];
      }));
  }

  // 인지세
  if (Array.isArray(rd.stampTaxBrackets)) {
    html += rateTableSection('인지세 (취득가액 구간별 정액)', ['취득가액 구간', '인지세'],
      rd.stampTaxBrackets.map(function(b) {
        return [priceRangeLabel(b.minPrice, b.maxPrice), formatKRW(b.stampTax)];
      }));
  }

  // 감면
  if (Array.isArray(rd.reductions)) {
    html += rateTableSection('감면 유형별 감면율', ['감면 유형', '감면율'],
      rd.reductions.map(function(r) {
        return [r.reductionType, formatRate(r.reductionRate)];
      }));
  }

  return html;
}

function renderTransferRateTable(rd) {
  var html = '';
  if (Array.isArray(rd.basicRateBrackets)) {
    html += rateTableSection('기본세율 (과세표준 누진 구간)', ['과세표준 구간', '세율', '누진공제'],
      rd.basicRateBrackets.map(function(b) {
        return [priceRangeLabel(b.minTaxBase, b.maxTaxBase), formatRate(b.rate), formatKRW(b.progressiveDeduction)];
      }));
  }
  if (rd.heavyMultiSurcharge) {
    html += rateTableSection('다주택 조정지역 중과 가산', ['구분', '가산율'], [
      ['2주택', formatRate(rd.heavyMultiSurcharge.twoHouse)],
      ['3주택 이상', formatRate(rd.heavyMultiSurcharge.threeOrMoreHouse)],
    ]);
  }
  if (rd.shortTermRates) {
    html += rateTableSection('단기보유 중과세율', ['보유기간', '세율'], [
      ['1년 미만', formatRate(rd.shortTermRates.under1Year)],
      ['1년 이상 2년 미만', formatRate(rd.shortTermRates.from1To2Year)],
    ]);
  }
  html += rateTableSection('기타', ['항목', '값'], [
    ['양도소득 기본공제(연)', formatKRW(rd.basicDeductionAmount)],
    ['1세대1주택 비과세 양도가액 상한', formatKRW(rd.oneHouseExemptionThreshold)],
    ['지방소득세율 (양도세 대비)', formatRate(rd.localIncomeTaxRate)],
  ]);
  return html;
}

function renderBrokerageRateTable(rd) {
  var html = '';
  var TX = { sale_exchange: '매매/교환', lease: '임대차' };
  var PT = { house: '주택', officetel: '오피스텔', other: '주택 외' };
  if (Array.isArray(rd.rateBrackets)) {
    html += rateTableSection('중개수수료 상한 요율·한도액', ['거래유형', '물건유형', '금액 구간', '상한 요율', '한도액'],
      rd.rateBrackets.map(function(b) {
        return [
          TX[b.transactionType] || b.transactionType,
          PT[b.propertyType] || b.propertyType,
          priceRangeLabel(b.minAmount, b.maxAmount),
          formatRate(b.upperRate),
          b.capAmount != null ? formatKRW(b.capAmount) : '한도 없음',
        ];
      }));
  }
  html += rateTableSection('임대차 환산 기준', ['항목', '값'], [
    ['환산 배수(기본)', String(rd.leaseConversionMultiplier)],
    ['재산정 배수', String(rd.leaseConversionFallbackMultiplier)],
    ['재산정 기준 금액', formatKRW(rd.leaseConversionThreshold)],
  ]);
  return html;
}

// ===== 포맷 유틸 =====
function formatKRW(n) {
  if (typeof n !== 'number' || isNaN(n)) return '-';
  return Math.round(n).toLocaleString('ko-KR') + '원';
}

// 복사(텍스트)용: "18,050,000원 (1,805만원)". 한글 표기가 없으면(0/빈값) 원 표기만.
function formatKRWWithKoreanText(n) {
  var krw = formatKRW(n);
  var ko = formatKoreanMoney(n);
  return ko ? krw + ' (' + ko + ')' : krw;
}

// 표시(HTML)용: 위에 원 표기, 아래 작은 회색 한글 표기(있을 때만).
function formatKRWWithKoreanHtml(n) {
  var krw = formatKRW(n);
  var ko = formatKoreanMoney(n);
  if (!ko) return krw;
  return krw + '<span class="calc-amount-krw">' + escapeHtml(ko) + '</span>';
}

function formatRate(r) {
  if (typeof r !== 'number' || isNaN(r)) return '-';
  // 0~1 사이면 백분율로, 그 외(정액/배수)면 그대로 표기.
  if (r > 0 && r <= 1) return (r * 100).toFixed(2).replace(/\.?0+$/, '') + '%';
  return String(r);
}

function scrollCalcToResult() {
  requestAnimationFrame(function() {
    var area = document.getElementById('calcArea');
    if (area) area.scrollTop = area.scrollHeight;
  });
}

// 따옴표로 감싼 속성값 선택자([data-field="VALUE"])에 안전하게 넣기 위한 이스케이프.
// 따옴표 안에서는 점(.)을 CSS-escape 하면 오히려 매칭되지 않으므로, 역슬래시와
// 큰따옴표만 이스케이프한다. 필드명은 영문/숫자/./_ 로 제한적이라 안전하다.
function cssEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ===== SPLASH INTRO =====
// 첫 진입에만 집 로고 스플래시를 재생하고, 종료 후 메인 메뉴를 등장 애니메이션과 함께 표시한다.
// 세션 재방문/서비스 화면 복원 시엔 스플래시를 건너뛴다.
// ===== GREETING + TIP (메인 메뉴 상단) =====
// 오늘의 부동산 팁 목록 (법률/세무/계약/거래 골고루). 참고용 정보이며 정확한 사항은 전문가 상담 권장.
const realEstateTips = [
  '전세 계약 시 확정일자는 잔금일 당일 받으면 대항력·우선변제권 확보에 유리해요.',
  '취득세 신고·납부 기한은 취득일로부터 60일 이내예요.',
  '1세대 1주택 양도세 비과세는 2년 이상 보유(조정지역은 2년 거주)가 기본 요건이에요.',
  '중개보수는 법정 상한 요율이 있어요. 계약 전 요율을 미리 확인하세요.',
  '등기부등본은 계약·중도금·잔금 시점마다 다시 확인하는 게 안전해요.',
  '공시가격 1억원 이하 주택은 취득세 다주택 중과에서 제외될 수 있어요.',
  '전입신고와 확정일자를 함께 갖춰야 보증금 보호에 효과적이에요.',
  '다주택자 양도세 중과는 주택 소재지의 조정대상지역 여부에 따라 달라져요.',
  '계약서 특약사항은 구두 약속 대신 반드시 문서로 남겨야 분쟁을 줄일 수 있어요.',
  '잔금 지급 전 근저당·가압류 등 권리관계 변동이 없는지 등기부로 확인하세요.',
  '재산세는 매년 6월 1일 소유자 기준으로 부과되니 잔금일 조정 시 참고하세요.',
  '전세보증금 반환보증(보증보험)에 가입하면 미반환 위험을 낮출 수 있어요.',
];

// 실제 현재 날짜와 시간대를 기준으로 인사말을 렌더한다. (하드코딩 금지)
function renderGreeting() {
  var titleEl = document.getElementById('greetingTitle');
  var subEl = document.getElementById('greetingSubtitle');
  var dateEl = document.getElementById('greetingDate');
  if (!titleEl && !dateEl) return;

  var now = new Date();
  var hour = now.getHours();
  var greeting;
  if (hour < 11) {
    greeting = '좋은 아침이에요 \u2600\uFE0F';
  } else if (hour < 18) {
    greeting = '안녕하세요 \uD83D\uDC4B';
  } else {
    greeting = '편안한 저녁이에요 \uD83C\uDF19';
  }

  var days = ['일', '월', '화', '수', '목', '금', '토'];
  var dateStr = now.getFullYear() + '년 ' + (now.getMonth() + 1) + '월 ' +
    now.getDate() + '일 ' + days[now.getDay()] + '요일';

  if (titleEl) titleEl.textContent = greeting;
  if (subEl) subEl.textContent = '오늘도 안전한 부동산 거래 되세요';
  if (dateEl) dateEl.textContent = dateStr;
}

// 팁 목록 중 하나를 랜덤으로 표시한다. 버튼 클릭 시 다음 팁으로 교체.
function renderTip() {
  var tipEl = document.getElementById('tipText');
  if (!tipEl) return;
  var idx = Math.floor(Math.random() * realEstateTips.length);
  var next = realEstateTips[idx];
  // 같은 팁 연속 표시 방지 (목록이 2개 이상일 때)
  if (realEstateTips.length > 1 && next === tipEl.textContent) {
    idx = (idx + 1) % realEstateTips.length;
    next = realEstateTips[idx];
  }
  var prefersReduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced || !tipEl.textContent) {
    tipEl.textContent = next;
    return;
  }
  tipEl.classList.add('tip-swap');
  setTimeout(function() {
    tipEl.textContent = next;
    tipEl.classList.remove('tip-swap');
  }, 200);
}

function playSplashThenMenu() {
  var splash = document.getElementById('splashScreen');
  var prefersReduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 스플래시 없이 곧바로 메뉴를 부드럽게 표시
  function showMenu() {
    if (splash) splash.classList.add('hidden');
    mainMenuScreen.classList.add('menu-enter');
  }

  // 접근성: 모션 최소화 설정이면 스플래시 생략
  if (prefersReduced || !splash) {
    showMenu();
    return;
  }

  splash.classList.remove('hidden');
  var done = false;
  function finish() {
    if (done) return;
    done = true;
    showMenu();
  }
  var animTarget = splash.querySelector('.splash-anim');
  if (animTarget) {
    animTarget.addEventListener('animationend', finish, { once: true });
  }
  // animationend 미발화 대비 fallback (애니메이션 4s)
  setTimeout(finish, 4200);
}

// ===================================================================
// ===== THEME (다크 모드) =====
// ===================================================================
//
// body에 'dark' 클래스를 토글하고 localStorage('theme')에 'dark'/'light'를
// 저장한다. 초기값은 저장된 값 → 없으면 시스템 prefers-color-scheme를 존중.
// 세 화면(메뉴/서비스/계산기)은 body 레벨 오버라이드로 일관 적용된다.

// 지정한 테마('dark' | 'light')를 body에 반영하고 토글 아이콘을 갱신한다.
function applyTheme(theme) {
  var isDark = theme === 'dark';
  document.body.classList.toggle('dark', isDark);
  var icon = document.getElementById('themeToggleIcon');
  if (icon) icon.textContent = isDark ? '☀️' : '🌙';
  var btn = document.getElementById('themeToggle');
  if (btn) {
    var label = isDark ? '라이트 모드 전환' : '다크 모드 전환';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
  }
}

// 저장값(없으면 시스템 설정)으로 초기 테마를 결정해 적용한다.
function initTheme() {
  var saved = null;
  try { saved = localStorage.getItem('theme'); } catch (e) { saved = null; }
  var theme;
  if (saved === 'dark' || saved === 'light') {
    theme = saved;
  } else {
    var prefersDark = window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    theme = prefersDark ? 'dark' : 'light';
  }
  applyTheme(theme);
}

// 토글: 현재 상태를 뒤집어 적용하고 localStorage에 저장한다.
function toggleTheme() {
  var isDark = document.body.classList.contains('dark');
  var next = isDark ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('theme', next); } catch (e) { /* 저장 실패는 무시 */ }
}

// ===== INITIALIZATION =====
function init() {
  initTheme();
  renderServiceGrid();
  renderGreeting();
  renderTip();

  // Restore screen from sessionStorage
  var savedScreen = sessionStorage.getItem('currentScreen');
  var hasRestoredScreen = savedScreen && (serviceConfigs[savedScreen] || calculatorConfigs[savedScreen]);

  if (hasRestoredScreen) {
    // 서비스/계산기 화면 복원 중이면 스플래시를 띄우지 않는다.
    sessionStorage.setItem('splashShown', '1');
    if (document.getElementById('splashScreen')) {
      document.getElementById('splashScreen').classList.add('hidden');
    }
    openService(savedScreen);
    return;
  }

  // 세션 내 재방문이면 스플래시 스킵, 최초 진입이면 스플래시 재생
  if (sessionStorage.getItem('splashShown')) {
    if (document.getElementById('splashScreen')) {
      document.getElementById('splashScreen').classList.add('hidden');
    }
  } else {
    sessionStorage.setItem('splashShown', '1');
    playSplashThenMenu();
  }
}

init();
