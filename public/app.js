import { state } from './state.js';
import { openModal, closeModals } from './utils.js';
import { loadProjects, createProject } from './projects.js';
import { goToProjects } from './navigation.js';
import { loadVideos, uploadVideo, deleteVideo, closeVideoPreview } from './videos.js';
import { executeSearch } from './search.js';
import { executeAnalyze } from './analyze.js';

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
document.getElementById('btn-search').addEventListener('click', executeSearch);
document.getElementById('btn-analyze').addEventListener('click', executeAnalyze);

// Main tabs
document.getElementById('tab-search').addEventListener('click', () => {
  document.getElementById('tab-search').classList.add('active');
  document.getElementById('tab-analyze').classList.remove('active');
  document.getElementById('panel-search').classList.add('active');
  document.getElementById('panel-analyze').classList.remove('active');
  loadVideos();
});

document.getElementById('tab-analyze').addEventListener('click', () => {
  document.getElementById('tab-analyze').classList.add('active');
  document.getElementById('tab-search').classList.remove('active');
  document.getElementById('panel-analyze').classList.add('active');
  document.getElementById('panel-search').classList.remove('active');
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

document.getElementById('search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') executeSearch();
});

document.getElementById('analyze-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') executeAnalyze();
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
