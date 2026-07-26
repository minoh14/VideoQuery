const API = '';

// State
let currentProject = null;
let queryMode = 'search';
let deleteTarget = null;
let pollInterval = null;

// DOM refs
const projectsView = document.getElementById('projects-view');
const workspaceView = document.getElementById('workspace-view');
const projectsGrid = document.getElementById('projects-grid');
const workspaceTitle = document.getElementById('workspace-title');
const videoList = document.getElementById('video-list');
const queryInput = document.getElementById('query-input');
const resultsArea = document.getElementById('results-area');

// --- Navigation ---

function showView(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  view.classList.add('active');
}

function goToProjects() {
  currentProject = null;
  stopPolling();
  showView(projectsView);
  loadProjects();
}

function goToWorkspace(project) {
  currentProject = project;
  workspaceTitle.textContent = project.name;
  resultsArea.innerHTML = '<p class="placeholder-text">검색 또는 분석 결과가 여기에 표시됩니다.</p>';
  showView(workspaceView);
  loadVideos();
  startPolling();
}

// --- Projects ---

async function loadProjects() {
  try {
    const res = await fetch(`${API}/api/projects`);
    const projects = await res.json();
    renderProjects(projects);
  } catch (err) {
    projectsGrid.innerHTML = '<p class="placeholder-text">프로젝트를 불러오지 못했습니다.</p>';
  }
}

function renderProjects(projects) {
  if (!projects.length) {
    projectsGrid.innerHTML = '<p class="placeholder-text">프로젝트가 없습니다. 새 프로젝트를 생성하세요.</p>';
    return;
  }
  projectsGrid.innerHTML = projects
    .map(
      (p) => `
    <div class="project-card" data-id="${p.id}">
      <h3>${escapeHtml(p.name)}</h3>
      <div class="meta">영상 ${p.videoCount || 0}개</div>
    </div>`
    )
    .join('');

  projectsGrid.querySelectorAll('.project-card').forEach((card) => {
    card.addEventListener('click', () => {
      const proj = projects.find((p) => p.id === card.dataset.id);
      goToWorkspace(proj);
    });
  });
}

async function createProject() {
  const nameInput = document.getElementById('input-project-name');
  const name = nameInput.value.trim();
  if (!name) return;

  const btn = document.getElementById('btn-create-project');
  btn.disabled = true;

  try {
    const res = await fetch(`${API}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error('생성 실패');
    nameInput.value = '';
    closeModals();
    loadProjects();
  } catch (err) {
    alert('프로젝트 생성에 실패했습니다.');
  } finally {
    btn.disabled = false;
  }
}

// --- Videos ---

async function loadVideos() {
  if (!currentProject) return;

  try {
    const res = await fetch(`${API}/api/videos?indexId=${currentProject.id}`);
    const videos = await res.json();
    renderVideos(videos);
  } catch (err) {
    videoList.innerHTML = '<li>영상 목록을 불러오지 못했습니다.</li>';
  }
}

function renderVideos(videos) {
  if (!videos.length) {
    videoList.innerHTML = '<li style="color:#71717a">영상이 없습니다.</li>';
    return;
  }

  videoList.innerHTML = videos
    .map((v) => {
      const badge = getBadge(v.status);
      return `
      <li data-id="${v.id}" data-asset-id="${v.assetId || ''}">
        <span class="video-name">${escapeHtml(v.name || '제목 없음')}</span>
        <span class="badge ${badge.cls}">${badge.label}</span>
        <button class="btn-delete-video" data-id="${v.id}" title="삭제">&times;</button>
      </li>`;
    })
    .join('');

  videoList.querySelectorAll('.btn-delete-video').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTarget = btn.dataset.id;
      openModal('modal-delete');
    });
  });
}

function getBadge(status) {
  switch (status) {
    case 'ready':
      return { cls: 'badge-ready', label: '검색 가능' };
    case 'indexing':
      return { cls: 'badge-indexing', label: '인덱싱 중' };
    case 'pending':
      return { cls: 'badge-uploading', label: '대기 중' };
    case 'failed':
      return { cls: 'badge-failed', label: '실패' };
    default:
      return { cls: 'badge-uploading', label: '처리 중' };
  }
}

async function uploadVideo() {
  const urlInput = document.getElementById('input-video-url');
  const titleInput = document.getElementById('input-video-title');
  const url = urlInput.value.trim();
  if (!url) return;

  const btn = document.getElementById('btn-upload-video');
  btn.disabled = true;

  try {
    const res = await fetch(`${API}/api/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        indexId: currentProject.id,
        url,
        title: titleInput.value.trim() || undefined,
      }),
    });
    if (!res.ok) throw new Error('업로드 실패');
    urlInput.value = '';
    titleInput.value = '';
    closeModals();
    loadVideos();
  } catch (err) {
    alert('영상 추가에 실패했습니다.');
  } finally {
    btn.disabled = false;
  }
}

async function deleteVideo() {
  if (!deleteTarget || !currentProject) return;

  const btn = document.getElementById('btn-confirm-delete');
  btn.disabled = true;

  try {
    const res = await fetch(
      `${API}/api/videos/${deleteTarget}?indexId=${currentProject.id}`,
      { method: 'DELETE' }
    );
    if (!res.ok) throw new Error('삭제 실패');
    deleteTarget = null;
    closeModals();
    loadVideos();
  } catch (err) {
    alert('영상 삭제에 실패했습니다.');
  } finally {
    btn.disabled = false;
  }
}

// --- Query ---

async function executeQuery() {
  const query = queryInput.value.trim();
  if (!query || !currentProject) return;

  resultsArea.innerHTML = '<div class="loading">처리 중...</div>';

  try {
    if (queryMode === 'search') {
      const res = await fetch(`${API}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          indexId: currentProject.id,
          query,
          searchOptions: ['visual', 'audio'],
        }),
      });
      if (!res.ok) throw new Error('검색 실패');
      const data = await res.json();
      renderSearchResults(data.clips);
    } else {
      const res = await fetch(`${API}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: getFirstReadyAssetId(),
          prompt: query,
        }),
      });
      if (!res.ok) throw new Error('분석 실패');
      const data = await res.json();
      renderAnalyzeResult(data.text);
    }
  } catch (err) {
    resultsArea.innerHTML = `<p class="placeholder-text">오류: ${escapeHtml(err.message)}</p>`;
  }
}

function getFirstReadyAssetId() {
  const item = videoList.querySelector('li[data-asset-id]');
  return item ? item.dataset.assetId : null;
}

function renderSearchResults(clips) {
  if (!clips || !clips.length) {
    resultsArea.innerHTML = '<p class="placeholder-text">검색 결과가 없습니다.</p>';
    return;
  }

  resultsArea.innerHTML = clips
    .map(
      (clip) => `
    <div class="clip-card" data-video-id="${clip.videoId}" data-start="${clip.start}">
      <div class="clip-info">
        <span class="clip-title">${escapeHtml(clip.videoTitle || clip.videoId)}</span>
        <span class="clip-time">${formatTime(clip.start)} – ${formatTime(clip.end)}</span>
      </div>
      ${clip.transcription ? `<p style="font-size:0.8rem;color:#a1a1aa">${escapeHtml(clip.transcription)}</p>` : ''}
    </div>`
    )
    .join('');
}

function renderAnalyzeResult(text) {
  if (!text) {
    resultsArea.innerHTML = '<p class="placeholder-text">분석 결과가 없습니다.</p>';
    return;
  }
  resultsArea.innerHTML = `<div class="analyze-result">${escapeHtml(text)}</div>`;
}

// --- Polling ---

function startPolling() {
  stopPolling();
  pollInterval = setInterval(loadVideos, 5000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// --- Modals ---

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModals() {
  document.querySelectorAll('.modal-overlay').forEach((m) => m.classList.add('hidden'));
}

// --- Utilities ---

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(seconds) {
  if (seconds == null) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// --- Event Listeners ---

document.getElementById('btn-new-project').addEventListener('click', () => openModal('modal-new-project'));
document.getElementById('btn-create-project').addEventListener('click', createProject);
document.getElementById('btn-back').addEventListener('click', goToProjects);
document.getElementById('btn-add-video').addEventListener('click', () => openModal('modal-add-video'));
document.getElementById('btn-upload-video').addEventListener('click', uploadVideo);
document.getElementById('btn-confirm-delete').addEventListener('click', deleteVideo);
document.getElementById('btn-query').addEventListener('click', executeQuery);

document.getElementById('mode-search').addEventListener('click', () => {
  queryMode = 'search';
  document.getElementById('mode-search').classList.add('active');
  document.getElementById('mode-analyze').classList.remove('active');
  queryInput.placeholder = '검색할 장면을 설명하세요...';
});

document.getElementById('mode-analyze').addEventListener('click', () => {
  queryMode = 'analyze';
  document.getElementById('mode-analyze').classList.add('active');
  document.getElementById('mode-search').classList.remove('active');
  queryInput.placeholder = '영상에 대해 질문하세요...';
});

queryInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') executeQuery();
});

document.querySelectorAll('.modal-cancel').forEach((btn) => {
  btn.addEventListener('click', closeModals);
});

document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModals();
  });
});

// --- Init ---
loadProjects();
