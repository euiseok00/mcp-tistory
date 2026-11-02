const slot = document.getElementById('save-slot');
const token = location.pathname.split('/')[2];

const MESSAGES = {
  LINK_EXPIRED: '링크가 만료되었거나 이미 저장되었습니다. Claude에서 다시 요청하세요.',
  IN_PROGRESS: '다른 탭에서 저장 중입니다. 1분 뒤 다시 시도하세요.',
  TISTORY_REJECTED: '티스토리가 저장을 거부했습니다. 잠시 후 다시 시도하세요.',
  UNKNOWN: '저장하지 못했습니다. 잠시 후 다시 시도하세요.',
};

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
    const result = await chrome.runtime.sendMessage({ kind: 'save', token, blog: select.value });
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
