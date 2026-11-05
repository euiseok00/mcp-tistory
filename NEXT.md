# 남은 작업 (2026-11-05 기준)

### 2.6 Chrome 웹 스토어 등록 (추후 진행)

- [x] `manifest.template.json`에서 `localhost` 권한을 제거한다. 이제 로컬 서버(`localhost`)에서는 확장 프로그램이 동작하지 않는다.
- [ ] 아이콘(16·48·128 PNG)을 만들어 `manifest.template.json`의 `icons`에 넣는다. 스토어 등록정보용 128×128 아이콘, 1280×800 스크린샷 1장 이상(미리보기 페이지 저장 버튼 화면)도 준비한다.
- [ ] `npm run ext:config`로 `manifest.json`을 만들고 `manifest.json`, `background.js`, `classify.js`, `content.js`만 zip으로 묶는다. 서버 주소가 바뀌면 다시 심사받아야 한다.
- [ ] https://chrome.google.com/webstore/devconsole 에서 개발자 등록(1회 5달러, 이메일 인증) 후 "새 항목"으로 zip을 업로드한다.
- [ ] 스토어 등록정보: 설명, 카테고리(생산성), 언어(한국어), 아이콘, 스크린샷.
- [ ] 개인정보 보호 탭에 아래 문구를 넣는다.
  - 단일 목적: Claude 대화에서 만든 글 미리보기 페이지에서 사용자가 버튼을 누르면, 그 글을 사용자의 티스토리 블로그에 임시저장합니다.
  - `https://*.tistory.com/*`: 사용자의 로그인된 브라우저 세션으로 티스토리 블로그 목록 조회, 이미지 업로드, 임시저장 요청을 보내기 위해 필요합니다. 쿠키를 읽거나 외부로 전송하지 않습니다.
  - `https://mcp-tistory-production.up.railway.app/*`: 미리보기 페이지에 저장 버튼을 표시하고, 저장할 글을 받아오고, 저장 결과를 알리기 위해 필요합니다.
  - 원격 코드: 아니요
  - 데이터 사용: "웹사이트 콘텐츠"만 체크, 판매·무관한 용도·신용 평가 금지 3개 항목 동의
  - 개인정보처리방침 URL: `https://mcp-tistory-production.up.railway.app/privacy`
- [ ] 배포 탭에서 공개 범위(공개/일부 공개/비공개)를 골라 심사를 제출한다. 심사 기간은 예측할 수 없다.
