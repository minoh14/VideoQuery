import { state } from './state.js';
import { openModal, closeModals } from './utils.js';
import { loadProjects, createProject, renameProject, deleteProject } from './projects.js';
import { goToProjects } from './navigation.js';
import { loadVideos, uploadVideo, deleteVideo, closeVideoPreview } from './videos.js';
import { executeSearch } from './search.js';
import { executeAnalyze } from './analyze.js';
import { getUserName, login, logout, restoreSession } from './auth.js';

// --- Theme Toggle ---

const THEME_KEY = 'videoquery_theme';
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('btn-toggle-theme').textContent = theme === 'dark' ? '☀️' : '🌙';
  localStorage.setItem(THEME_KEY, theme);
}
applyTheme(localStorage.getItem(THEME_KEY) || 'light');
document.getElementById('btn-toggle-theme').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// --- Sidebar Resize ---

(function initSidebarResize() {
  const resizer = document.getElementById('sidebar-resizer');
  const sidebar = document.getElementById('video-sidebar');
  if (!resizer || !sidebar) return;

  let startX, startWidth;

  resizer.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    resizer.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMouseMove(e) {
      const newWidth = startWidth + (e.clientX - startX);
      const clamped = Math.max(180, Math.min(newWidth, window.innerWidth * 0.5));
      sidebar.style.width = clamped + 'px';
    }

    function onMouseUp() {
      resizer.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
})();

// --- Event Listeners ---

document.getElementById('btn-new-project').addEventListener('click', () => openModal('modal-new-project'));
document.getElementById('btn-create-project').addEventListener('click', createProject);
document.getElementById('btn-rename-project').addEventListener('click', renameProject);
document.getElementById('btn-confirm-delete-project').addEventListener('click', deleteProject);
document.getElementById('btn-back').addEventListener('click', goToProjects);
document.getElementById('btn-add-video').addEventListener('click', () => openModal('modal-add-video'));
document.getElementById('btn-upload-video').addEventListener('click', uploadVideo);
document.getElementById('btn-confirm-delete').addEventListener('click', deleteVideo);
document.getElementById('btn-close-video-preview').addEventListener('click', closeVideoPreview);
document.getElementById('modal-video-preview').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeVideoPreview();
});
document.getElementById('btn-search').addEventListener('click', executeSearch);
document.getElementById('btn-analyze').addEventListener('click', executeAnalyze);

// Main tabs
document.getElementById('tab-search').addEventListener('click', () => {
  document.getElementById('tab-search').classList.add('active');
  document.getElementById('tab-analyze').classList.remove('active');
  document.getElementById('panel-search').classList.add('active');
  document.getElementById('panel-analyze').classList.remove('active');
  document.getElementById('video-filter-wrapper').classList.add('hidden');
  document.getElementById('video-filter-input').value = '';
  document.getElementById('btn-clear-video-filter').classList.add('hidden');
  loadVideos();
});

document.getElementById('tab-analyze').addEventListener('click', () => {
  document.getElementById('tab-analyze').classList.add('active');
  document.getElementById('tab-search').classList.remove('active');
  document.getElementById('panel-analyze').classList.add('active');
  document.getElementById('panel-search').classList.remove('active');
  document.getElementById('video-filter-wrapper').classList.remove('hidden');
  loadVideos();
});

// Upload tabs
document.getElementById('tab-url').addEventListener('click', () => {
  state.uploadMode = 'url';
  document.getElementById('tab-url').classList.add('active');
  document.getElementById('tab-file').classList.remove('active');
  document.getElementById('upload-panel-url').classList.remove('hidden');
  document.getElementById('upload-panel-file').classList.add('hidden');
});

document.getElementById('tab-file').addEventListener('click', () => {
  state.uploadMode = 'file';
  document.getElementById('tab-file').classList.add('active');
  document.getElementById('tab-url').classList.remove('active');
  document.getElementById('upload-panel-file').classList.remove('hidden');
  document.getElementById('upload-panel-url').classList.add('hidden');
});

// File input display
document.getElementById('input-video-file').addEventListener('change', (e) => {
  const files = e.target.files;
  if (files.length === 1) {
    document.getElementById('file-drop-name').textContent = files[0].name;
  } else if (files.length > 1) {
    document.getElementById('file-drop-name').textContent = `${files.length}개 파일 선택됨`;
  } else {
    document.getElementById('file-drop-name').textContent = '';
  }
});

// Drag and drop
const dropArea = document.getElementById('file-drop-area');
dropArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropArea.classList.add('dragover');
});
dropArea.addEventListener('dragleave', () => {
  dropArea.classList.remove('dragover');
});
dropArea.addEventListener('drop', (e) => {
  e.preventDefault();
  dropArea.classList.remove('dragover');
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    const fileInput = document.getElementById('input-video-file');
    const dt = new DataTransfer();
    for (const file of files) {
      dt.items.add(file);
    }
    fileInput.files = dt.files;
    if (files.length === 1) {
      document.getElementById('file-drop-name').textContent = files[0].name;
    } else {
      document.getElementById('file-drop-name').textContent = `${files.length}개 파일 선택됨`;
    }
  }
});

document.getElementById('video-filter-input').addEventListener('input', () => {
  const val = document.getElementById('video-filter-input').value;
  document.getElementById('btn-clear-video-filter').classList.toggle('hidden', !val);
  state.videoPage = 1;
  loadVideos();
});

document.getElementById('btn-clear-video-filter').addEventListener('click', () => {
  document.getElementById('video-filter-input').value = '';
  document.getElementById('btn-clear-video-filter').classList.add('hidden');
  state.videoPage = 1;
  loadVideos();
});

document.getElementById('video-sort').addEventListener('change', () => {
  state.videoPage = 1;
  loadVideos();
});

document.getElementById('search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') executeSearch();
});

document.getElementById('analyze-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') executeAnalyze();
});

document.getElementById('input-project-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createProject();
});

document.getElementById('input-rename-project').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') renameProject();
});

document.getElementById('input-video-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') uploadVideo();
});

document.getElementById('input-video-title').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') uploadVideo();
});

document.querySelectorAll('.modal-cancel').forEach((btn) => {
  btn.addEventListener('click', closeModals);
});

document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModals();
  });
});

// --- Auth ---

function showView(viewId) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
}

function updateUserDisplay() {
  const name = getUserName();
  document.getElementById('user-display-name').textContent = name;
  document.getElementById('user-display-name-ws').textContent = name;
}

async function handleLogin() {
  const nameInput = document.getElementById('input-login-name');
  const apiKeyInput = document.getElementById('input-login-apikey');
  const errorEl = document.getElementById('login-error');
  const loginBtn = document.getElementById('btn-login');
  const name = nameInput.value.trim();
  const apiKey = apiKeyInput.value.trim();

  errorEl.classList.add('hidden');

  if (!name || !apiKey) {
    errorEl.textContent = '이름과 API Key를 모두 입력하세요.';
    errorEl.classList.remove('hidden');
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = '확인 중...';

  try {
    await login(name, apiKey);
    apiKeyInput.value = '';
    updateUserDisplay();
    showView('projects-view');
    loadProjects();
  } catch (err) {
    errorEl.textContent = err.message || '서버에 연결할 수 없습니다.';
    errorEl.classList.remove('hidden');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = '로그인';
  }
}

async function handleLogout() {
  await logout();
  showView('login-view');
  document.getElementById('input-login-name').value = '';
  document.getElementById('input-login-apikey').value = '';
}

document.getElementById('btn-login').addEventListener('click', handleLogin);
document.getElementById('input-login-apikey').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleLogin();
});
document.getElementById('input-login-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('input-login-apikey').focus();
});
document.getElementById('btn-logout').addEventListener('click', handleLogout);

// --- Init ---
async function initializeApp() {
  const session = await restoreSession();
  if (session) {
    updateUserDisplay();
    showView('projects-view');
    loadProjects();
  } else {
    showView('login-view');
  }
}

initializeApp();
