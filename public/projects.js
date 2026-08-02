import { API, state } from './state.js';
import { escapeHtml, openModal, closeModals } from './utils.js';

let projectActionTarget = null;

const projectsGrid = document.getElementById('projects-grid');

export async function loadProjects() {
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
      <div class="project-card-actions">
        <button class="btn-project-rename" data-id="${p.id}" title="이름 변경">&#9998;</button>
        <button class="btn-project-delete" data-id="${p.id}" title="삭제">&times;</button>
      </div>
    </div>`
    )
    .join('');

  projectsGrid.querySelectorAll('.project-card').forEach((card) => {
    card.addEventListener('click', async (e) => {
      if (e.target.closest('.btn-project-rename') || e.target.closest('.btn-project-delete')) return;
      const proj = projects.find((p) => p.id === card.dataset.id);
      const { goToWorkspace } = await import('./navigation.js');
      goToWorkspace(proj);
    });
  });

  projectsGrid.querySelectorAll('.btn-project-rename').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const proj = projects.find((p) => p.id === btn.dataset.id);
      projectActionTarget = proj;
      document.getElementById('input-rename-project').value = proj.name;
      openModal('modal-rename-project');
    });
  });

  projectsGrid.querySelectorAll('.btn-project-delete').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const proj = projects.find((p) => p.id === btn.dataset.id);
      projectActionTarget = proj;
      openModal('modal-delete-project');
    });
  });
}

export async function renameProject() {
  if (!projectActionTarget) return;
  const nameInput = document.getElementById('input-rename-project');
  const name = nameInput.value.trim();
  if (!name) return;

  const btn = document.getElementById('btn-rename-project');
  btn.disabled = true;

  try {
    const res = await fetch(`${API}/api/projects/${projectActionTarget.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error('이름 변경 실패');
    projectActionTarget = null;
    closeModals();
    loadProjects();
  } catch (err) {
    alert('프로젝트 이름 변경에 실패했습니다.');
  } finally {
    btn.disabled = false;
  }
}

export async function deleteProject() {
  if (!projectActionTarget) return;

  const btn = document.getElementById('btn-confirm-delete-project');
  btn.disabled = true;

  try {
    const res = await fetch(`${API}/api/projects/${projectActionTarget.id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('삭제 실패');
    projectActionTarget = null;
    closeModals();
    loadProjects();
  } catch (err) {
    alert('프로젝트 삭제에 실패했습니다.');
  } finally {
    btn.disabled = false;
  }
}

export async function createProject() {
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
