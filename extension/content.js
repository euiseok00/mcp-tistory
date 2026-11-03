const slot = document.getElementById('save-slot');
const token = location.pathname.split('/')[2];

const MESSAGES = {
  LINK_EXPIRED: '링크가 만료되었거나 이미 저장되었습니다. Claude에서 다시 요청하세요.',
  IN_PROGRESS: '다른 탭에서 저장 중입니다. 1분 뒤 다시 시도하세요.',
  TISTORY_REJECTED: '티스토리가 저장을 거부했습니다. 잠시 후 다시 시도하세요.',
  DIAGRAM_FAILED: '다이어그램을 이미지로 바꾸지 못했습니다. Claude에서 다이어그램을 고쳐 다시 요청하세요.',
  UNKNOWN: '저장하지 못했습니다. 잠시 후 다시 시도하세요.',
};

// 2배로 그려 고해상도 화면에서도 선명하게 한다. 치환자에는 원래 크기를 넣는다
const SCALE = 2;

/** 미리보기의 SVG 다이어그램을 순서대로 PNG로 바꾼다. 서비스 워커에는 SVG를 그릴 canvas가 없어 여기서 한다. */
async function renderDiagrams() {
  const images = [...document.querySelectorAll('article img[data-mcp-svg]')];
  return Promise.all(images.map(async (img) => {
    await img.decode();
    // width·height가 없는 SVG는 크기가 0일 수 있다
    const width = img.naturalWidth || 800;
    const height = img.naturalHeight || 450;
    const canvas = document.createElement('canvas');
    canvas.width = width * SCALE;
    canvas.height = height * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/png'), width, height };
  }));
}

function showLogin() {
  const link = document.createElement('a');
  link.href = 'https://www.tistory.com/auth/login';
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = '티스토리 로그인';
  slot.replaceChildren(link, ' 후 이 페이지를 새로고침하세요.');
}

function showSaved(blog, draftId) {
  const link = document.createElement('a');
  link.href = `https://${blog}.tistory.com/manage/newpost/`;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = '글쓰기 화면 열기';
  slot.replaceChildren(`임시저장했습니다 (번호 ${draftId}). 임시저장 목록에서 불러와 발행하세요. `, link);
}

function showForm(blogs) {
  const label = document.createElement('label');
  label.textContent = '블로그 ';
  const select = document.createElement('select');
  for (const blog of blogs) select.add(new Option(`${blog.title} (${blog.name})`, blog.name, blog.defaultBlog, blog.defaultBlog));
  label.append(select);

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '임시저장';
  const status = document.createElement('p');
  status.setAttribute('role', 'alert');

  button.addEventListener('click', async (event) => {
    // 저장은 사용자의 실제 클릭으로만 시작한다
    if (!event.isTrusted) return;
    button.disabled = true;
    status.textContent = '저장 중…';
    let diagrams;
    try {
      diagrams = await renderDiagrams();
    } catch {
      status.textContent = MESSAGES.DIAGRAM_FAILED;
      button.disabled = false;
      return;
    }
    const result = await chrome.runtime.sendMessage({ kind: 'save', token, blog: select.value, diagrams });
    if (result.ok) return showSaved(select.value, result.draftId);
    if (result.errorCode === 'SESSION_EXPIRED') return showLogin();
    status.textContent = MESSAGES[result.errorCode] ?? MESSAGES.UNKNOWN;
    button.disabled = result.errorCode === 'LINK_EXPIRED';
  });

  slot.replaceChildren(label, ' ', button, status);
}

async function init() {
  const result = await chrome.runtime.sendMessage({ kind: 'blogs' });
  if (result.ok && result.blogs.length > 0) showForm(result.blogs);
  else if (result.ok) slot.textContent = '이 계정에 블로그가 없습니다.';
  else if (result.errorCode === 'SESSION_EXPIRED') showLogin();
  else slot.textContent = '블로그 목록을 불러오지 못했습니다. 페이지를 새로고침하세요.';
}

// 만료 페이지에는 slot이 없다
if (slot) init();
