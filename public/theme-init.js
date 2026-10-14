// 첫 화면 깜빡임 방지: 저장된 테마/글자 크기를 렌더 전에 적용 (CSP 때문에 인라인 대신 파일로 둔다)
try {
  var p = JSON.parse(localStorage.getItem('prefs') || '{}');
  var dark = p.theme === 'dark' || ((!p.theme || p.theme === 'system') && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.fontSize = { sm: '14px', md: '16px', lg: '18px' }[p.fontSize || 'md'];
} catch (e) {}
