const API = '';

// State
let currentProject = null;
let queryMode = 'search';
let deleteTarget = null;
let pollInterval = null;
let queryController = null;
let pendingUploads = [];
let videoPage = 1;
let videoTotalPage = 1;

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
  videoPage = 1;
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
    const res = await fetch(`${API}/api/videos?indexId=${currentProject.id}&page=${videoPage}&pageLimit=10`);
    const data = await res.json();
    videoTotalPage = data.pageInfo?.totalPage || 1;
    renderVideos(data.videos, data.pageInfo?.totalResults || data.videos.length);
  } catch (err) {
    videoList.innerHTML = '<li>영상 목록을 불러오지 못했습니다.</li>';
  }
}

function renderVideos(videos, totalResults) {
  const videoAssetIds = new Set(videos.map((v) => v.assetId).filter(Boolean));
  pendingUploads = pendingUploads.filter((p) => !videoAssetIds.has(p.assetId));

  const totalCount = totalResults + pendingUploads.length;
  document.getElementById('video-count').textContent = totalCount > 0 ? `(${totalCount})` : '';

  const pendingHtml = pendingUploads
    .map((p) => `
      <li class="pending-upload">
        <div class="video-item-content">
          <div class="video-item-row">
            <span class="video-name">${escapeHtml(p.title)}</span>
            <span class="badge badge-uploading">업로드 중</span>
          </div>
          <div class="progress-bar"><div class="progress-bar-fill"></div></div>
        </div>
      </li>`)
    .join('');

  if (!videos.length && !pendingUploads.length) {
    videoList.innerHTML = '<li style="color:#6b7280">영상이 없습니다.</li>';
    return;
  }

  const videosHtml = videos
    .map((v) => {
      const badge = getBadge(v.status);
      const isProcessing = v.status !== 'ready' && v.status !== 'failed';
      const thumb = v.thumbnailUrl
        ? `<img class="video-item-thumb" src="${v.thumbnailUrl}" alt="">`
        : '<div class="video-item-thumb video-item-thumb-empty"></div>';
      return `
      <li data-id="${v.id}" data-asset-id="${v.assetId || ''}">
        <div class="video-item-content">
          <div class="video-item-row">
            ${thumb}
            <span class="video-name">${escapeHtml(v.filename || '제목 없음')}</span>
            <span class="badge ${badge.cls}">${badge.label}</span>
            <button class="btn-delete-video" data-id="${v.id}" title="삭제">&times;</button>
          </div>
          ${isProcessing ? '<div class="progress-bar"><div class="progress-bar-fill"></div></div>' : ''}
        </div>
      </li>`;
    })
    .join('');

  videoList.innerHTML = pendingHtml + videosHtml;

  const paginationEl = document.getElementById('video-pagination');
  if (videoTotalPage > 1) {
    paginationEl.innerHTML = `
      <button class="btn-page${videoPage <= 1 ? ' disabled' : ''}" id="btn-prev-page">&lsaquo;</button>
      <span class="page-info">${videoPage} / ${videoTotalPage}</span>
      <button class="btn-page${videoPage >= videoTotalPage ? ' disabled' : ''}" id="btn-next-page">&rsaquo;</button>`;
  } else {
    paginationEl.innerHTML = '';
  }

  videoList.querySelectorAll('.btn-delete-video').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTarget = btn.dataset.id;
      openModal('modal-delete');
    });
  });

  videoList.querySelectorAll('li[data-id]').forEach((li) => {
    li.addEventListener('click', () => {
      const video = videos.find((v) => v.id === li.dataset.id);
      if (video) showVideoPreview(video);
    });
  });

  const prevBtn = document.getElementById('btn-prev-page');
  const nextBtn = document.getElementById('btn-next-page');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (videoPage > 1) { videoPage--; loadVideos(); }
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (videoPage < videoTotalPage) { videoPage++; loadVideos(); }
    });
  }
}

function showVideoPreview(video) {
  const modal = document.getElementById('modal-video-preview');
  const title = document.getElementById('modal-video-title');
  const body = document.getElementById('modal-video-body');

  title.textContent = video.filename || '제목 없음';

  const thumbSrc = video.thumbnailUrl || '';
  body.innerHTML = `
    <div class="video-preview-thumbnail" id="video-preview-player">
      ${thumbSrc ? `<img src="${thumbSrc}" alt="thumbnail">` : '<div class="clip-thumbnail-placeholder" style="height:300px"></div>'}
      <div class="clip-play-icon">&#9654;</div>
    </div>`;

  modal.classList.remove('hidden');

  document.getElementById('video-preview-player').addEventListener('click', () => {
    if (!video.hlsUrl) {
      body.innerHTML = '<p style="color:#6b7280;font-size:0.85rem;padding:16px">재생 가능한 스트림이 없습니다.</p>';
      return;
    }
    const container = document.getElementById('video-preview-player');
    const videoEl = document.createElement('video');
    videoEl.controls = true;
    videoEl.autoplay = true;
    videoEl.style.width = '100%';
    videoEl.style.borderRadius = '8px';
    container.innerHTML = '';
    container.appendChild(videoEl);

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(video.hlsUrl);
      hls.attachMedia(videoEl);
      hls.on(Hls.Events.MANIFEST_PARSED, () => videoEl.play());
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.src = video.hlsUrl;
      videoEl.addEventListener('loadedmetadata', () => videoEl.play());
    }
  });
}

function closeVideoPreview() {
  const modal = document.getElementById('modal-video-preview');
  const body = document.getElementById('modal-video-body');
  body.querySelectorAll('video').forEach((v) => { v.pause(); v.src = ''; });
  body.innerHTML = '';
  modal.classList.add('hidden');
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

let uploadMode = 'url';

async function uploadVideo() {
  if (uploadMode === 'url') {
    await uploadVideoByUrl();
  } else {
    await uploadVideoByFile();
  }
}

async function uploadVideoByUrl() {
  const urlInput = document.getElementById('input-video-url');
  const titleInput = document.getElementById('input-video-title');
  const url = urlInput.value.trim();
  if (!url) return;

  const btn = document.getElementById('btn-upload-video');
  btn.disabled = true;

  const title = titleInput.value.trim() || url.split('/').pop() || '새 영상';
  const pending = { title, assetId: null };
  pendingUploads.push(pending);

  urlInput.value = '';
  titleInput.value = '';
  closeModals();
  loadVideos();

  try {
    const res = await fetch(`${API}/api/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        indexId: currentProject.id,
        url,
        title: title,
      }),
    });
    if (!res.ok) throw new Error('업로드 실패');
    const data = await res.json();
    pending.assetId = data.assetId;
    loadVideos();
  } catch (err) {
    pendingUploads = pendingUploads.filter((p) => p !== pending);
    loadVideos();
    alert('영상 추가에 실패했습니다.');
  } finally {
    btn.disabled = false;
  }
}

async function uploadVideoByFile() {
  const fileInput = document.getElementById('input-video-file');
  const file = fileInput.files[0];
  if (!file) return;

  const btn = document.getElementById('btn-upload-video');
  btn.disabled = true;

  const title = file.name;
  const pending = { title, assetId: null };
  pendingUploads.push(pending);

  fileInput.value = '';
  document.getElementById('file-drop-name').textContent = '';
  closeModals();
  loadVideos();

  try {
    const formData = new FormData();
    formData.append('indexId', currentProject.id);
    formData.append('file', file);

    const res = await fetch(`${API}/api/videos/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('업로드 실패');
    const data = await res.json();
    pending.assetId = data.assetId;
    loadVideos();
  } catch (err) {
    pendingUploads = pendingUploads.filter((p) => p !== pending);
    loadVideos();
    alert('파일 업로드에 실패했습니다.');
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
    resultsArea.innerHTML = '<p class="placeholder-text">검색 또는 분석 결과가 여기에 표시됩니다.</p>';
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

  if (queryController) queryController.abort();
  queryController = new AbortController();
  const signal = queryController.signal;

  resultsArea.querySelectorAll('video').forEach((v) => {
    v.pause();
    v.src = '';
  });
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
        signal,
      });
      if (!res.ok) throw new Error('검색 실패');
      const data = await res.json();
      if (signal.aborted) return;
      renderSearchResults(data.clips);
    } else {
      const res = await fetch(`${API}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: getFirstReadyAssetId(),
          prompt: query,
        }),
        signal,
      });
      if (!res.ok) throw new Error('분석 실패');
      const data = await res.json();
      if (signal.aborted) return;
      renderAnalyzeResult(data.text);
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    resultsArea.innerHTML = `<p class="placeholder-text">오류: ${escapeHtml(err.message)}</p>`;
  }
}

function getFirstReadyAssetId() {
  const item = videoList.querySelector('li[data-asset-id]');
  return item ? item.dataset.assetId : null;
}

function renderSearchResults(clips) {
  resultsArea.innerHTML = '';

  if (!clips || !clips.length) {
    resultsArea.innerHTML = '<p class="placeholder-text">검색 결과가 없습니다.</p>';
    return;
  }

  resultsArea.innerHTML = clips
    .map(
      (clip, i) => {
        const thumbSrc = clip.thumbnailUrl
          ? `${clip.thumbnailUrl}${clip.thumbnailUrl.includes('?') ? '&' : '?'}time=${clip.start || 0}`
          : '';
        return `
    <div class="clip-card" data-index="${i}">
      <div class="clip-info">
        <div class="clip-thumbnail">
          ${thumbSrc ? `<img src="${thumbSrc}" alt="thumbnail">` : '<div class="clip-thumbnail-placeholder"></div>'}
          <div class="clip-play-icon">&#9654;</div>
        </div>
        <div class="clip-meta">
          <span class="clip-title">${escapeHtml(clip.videoTitle || clip.videoId)}</span>
          <span class="clip-time">${formatTime(clip.start)} – ${formatTime(clip.end)}</span>
          ${clip.transcription ? `<p class="clip-transcription">${escapeHtml(clip.transcription)}</p>` : ''}
        </div>
      </div>
      <div class="clip-player-container" id="player-${i}"></div>
    </div>`;
      }
    )
    .join('');

  resultsArea.querySelectorAll('.clip-card').forEach((card) => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.index);
      const clip = clips[idx];
      playClip(idx, clip);
    });
  });
}

function playClip(index, clip) {
  const container = document.getElementById(`player-${index}`);
  if (container.querySelector('video')) {
    container.innerHTML = '';
    return;
  }

  if (!clip.hlsUrl) {
    container.innerHTML = '<p style="color:#6b7280;font-size:0.8rem;padding:8px">재생 가능한 스트림이 없습니다.</p>';
    return;
  }

  const video = document.createElement('video');
  video.controls = true;
  video.autoplay = true;
  video.style.width = '100%';
  video.style.borderRadius = '6px';
  video.style.marginTop = '10px';
  container.innerHTML = '';
  container.appendChild(video);

  const startTime = clip.start || 0;
  const endTime = clip.end;

  function onTimeUpdate() {
    if (endTime != null && video.currentTime >= endTime) {
      video.pause();
      video.removeEventListener('timeupdate', onTimeUpdate);
    }
  }
  video.addEventListener('timeupdate', onTimeUpdate);

  if (Hls.isSupported()) {
    const hls = new Hls();
    hls.loadSource(clip.hlsUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.currentTime = startTime;
      video.play();
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = clip.hlsUrl;
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = startTime;
      video.play();
    });
  }
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
document.getElementById('btn-back').addEventListener('click', goToProjects);
document.getElementById('btn-add-video').addEventListener('click', () => openModal('modal-add-video'));
document.getElementById('btn-upload-video').addEventListener('click', uploadVideo);
document.getElementById('btn-confirm-delete').addEventListener('click', deleteVideo);
document.getElementById('btn-close-video-preview').addEventListener('click', closeVideoPreview);
document.getElementById('modal-video-preview').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeVideoPreview();
});
document.getElementById('btn-query').addEventListener('click', executeQuery);

// Upload tabs
document.getElementById('tab-url').addEventListener('click', () => {
  uploadMode = 'url';
  document.getElementById('tab-url').classList.add('active');
  document.getElementById('tab-file').classList.remove('active');
  document.getElementById('upload-panel-url').classList.remove('hidden');
  document.getElementById('upload-panel-file').classList.add('hidden');
});

document.getElementById('tab-file').addEventListener('click', () => {
  uploadMode = 'file';
  document.getElementById('tab-file').classList.add('active');
  document.getElementById('tab-url').classList.remove('active');
  document.getElementById('upload-panel-file').classList.remove('hidden');
  document.getElementById('upload-panel-url').classList.add('hidden');
});

// File input display
document.getElementById('input-video-file').addEventListener('change', (e) => {
  const name = e.target.files[0]?.name || '';
  document.getElementById('file-drop-name').textContent = name;
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
  const file = e.dataTransfer.files[0];
  if (file) {
    const fileInput = document.getElementById('input-video-file');
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    document.getElementById('file-drop-name').textContent = file.name;
  }
});

document.getElementById('mode-search').addEventListener('click', () => {
  queryMode = 'search';
  document.getElementById('mode-search').classList.add('active');
  document.getElementById('mode-analyze').classList.remove('active');
  queryInput.placeholder = '검색할 장면을 설명하세요...';
  resultsArea.innerHTML = '<p class="placeholder-text">검색 또는 분석 결과가 여기에 표시됩니다.</p>';
});

document.getElementById('mode-analyze').addEventListener('click', () => {
  queryMode = 'analyze';
  document.getElementById('mode-analyze').classList.add('active');
  document.getElementById('mode-search').classList.remove('active');
  queryInput.placeholder = '영상에 대해 질문하세요...';
  resultsArea.innerHTML = '<p class="placeholder-text">검색 또는 분석 결과가 여기에 표시됩니다.</p>';
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
