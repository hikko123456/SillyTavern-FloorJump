// SillyTavern 楼层跳转 Floor Jump
const MODULE = 'floorJump';
const DEFAULTS = { showFab: true, smooth: true, fabPos: null };

const ctx = () => SillyTavern.getContext();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

/* ---------- 设置 ---------- */
function settings() {
    const all = ctx().extensionSettings;
    all[MODULE] ??= {};
    for (const [k, v] of Object.entries(DEFAULTS)) {
        if (all[MODULE][k] === undefined) all[MODULE][k] = v;
    }
    return all[MODULE];
}
const save = () => ctx().saveSettingsDebounced();
const toast = (msg, type = 'info') => window.toastr?.[type]?.(msg, '楼层跳转');

/* ---------- 楼层工具 ---------- */
const getMes = (id) => document.querySelector(`#chat .mes[mesid="${id}"]`);
const lastId = () => (ctx().chat?.length ?? 0) - 1;
const mesCount = () => document.querySelectorAll('#chat .mes').length;

// 当前视口顶部的楼层
function currentId() {
    const chat = document.getElementById('chat');
    if (!chat) return 0;
    const top = chat.getBoundingClientRect().top;
    for (const m of chat.querySelectorAll('.mes')) {
        if (m.getBoundingClientRect().bottom > top + 10) return Number(m.getAttribute('mesid'));
    }
    return lastId();
}

// 解析输入：支持 "25"、"#25"、"-1"（倒数第一）
function resolveId(raw) {
    const n = parseInt(String(raw ?? '').trim().replace(/^#/, ''), 10);
    if (Number.isNaN(n)) return null;
    const max = lastId();
    return clamp(n < 0 ? max + 1 + n : n, 0, max);
}

// 酒馆默认只渲染最近 N 楼；目标未加载时反复点击"显示更多消息"
async function ensureLoaded(id) {
    for (let round = 0; round < 1000; round++) {
        const el = getMes(id);
        if (el) return el;
        const more = document.getElementById('show_more_messages');
        if (!more) return null;
        const before = mesCount();
        more.click();
        let changed = false;
        for (let t = 0; t < 60; t++) {
            await sleep(50);
            if (mesCount() !== before) { changed = true; break; }
        }
        if (!changed) return getMes(id); // 加载卡住，放弃
    }
    return getMes(id);
}

/* ---------- 跳转 ---------- */
let busy = false;
async function jumpTo(raw) {
    if (busy) return false;
    if (lastId() < 0) { toast('当前没有打开的聊天', 'warning'); return false; }
    const id = resolveId(raw);
    if (id === null) { toast('请输入有效的楼层号', 'warning'); return false; }

    busy = true;
    try {
        const el = await ensureLoaded(id);
        if (!el) { toast(`没找到第 ${id} 楼`, 'error'); return false; }
        el.scrollIntoView({ behavior: settings().smooth ? 'smooth' : 'auto', block: 'start' });
        el.classList.remove('fj-highlight');
        void el.offsetWidth; // 重启动画
        el.classList.add('fj-highlight');
        setTimeout(() => el.classList.remove('fj-highlight'), 2000);
        updateInfo(id);
        return true;
    } finally {
        busy = false;
    }
}

/* ---------- 面板 ---------- */
let panel, input, range;

function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'fj-panel';
    panel.innerHTML = `
        <div class="fj-head">
            <span>楼层跳转</span>
            <span id="fj-info"></span>
            <i class="fa-solid fa-xmark fj-close" title="关闭"></i>
        </div>
        <div class="fj-row">
            <input id="fj-input" class="text_pole" type="number" placeholder="楼层号（-1 = 最后一楼）">
            <div id="fj-go" class="menu_button">跳转</div>
        </div>
        <div class="fj-row">
            <input id="fj-range" type="range" min="0" max="0" step="1" value="0">
        </div>
        <div class="fj-row fj-quick">
            <div class="menu_button" data-act="first" title="第一楼"><i class="fa-solid fa-angles-up"></i></div>
            <div class="menu_button" data-act="prev"  title="上一楼"><i class="fa-solid fa-angle-up"></i></div>
            <div class="menu_button" data-act="next"  title="下一楼"><i class="fa-solid fa-angle-down"></i></div>
            <div class="menu_button" data-act="last"  title="最后一楼"><i class="fa-solid fa-angles-down"></i></div>
        </div>`;
    document.body.appendChild(panel);

    input = panel.querySelector('#fj-input');
    range = panel.querySelector('#fj-range');

    panel.querySelector('#fj-go').addEventListener('click', () => jumpTo(input.value));
    panel.querySelector('.fj-close').addEventListener('click', hidePanel);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); jumpTo(input.value); }
        if (e.key === 'Escape') hidePanel();
    });
    range.addEventListener('input', () => { input.value = range.value; });
    range.addEventListener('change', () => jumpTo(range.value));

    panel.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const cur = currentId();
            const max = lastId();
            const target = {
                first: 0,
                prev: Math.max(cur - 1, 0),
                next: Math.min(cur + 1, max),
                last: max,
            }[btn.dataset.act];
            jumpTo(target);
        });
    });
}

function updateInfo(cur = currentId()) {
    if (!panel) return;
    const max = Math.max(lastId(), 0);
    panel.querySelector('#fj-info').textContent = `第 ${cur} 楼 / 共 ${max} 楼`;
    range.max = String(max);
    range.value = String(cur);
}

function showPanel() {
    updateInfo();
    input.value = '';
    panel.style.display = 'block';
    if (!matchMedia('(pointer: coarse)').matches) input.focus(); // 手机上不自动弹键盘
}
function hidePanel() { if (panel) panel.style.display = 'none'; }
function togglePanel() { panel.style.display === 'block' ? hidePanel() : showPanel(); }

/* ---------- 悬浮按钮（可拖动） ---------- */
let fab;

function buildFab() {
    fab = document.createElement('div');
    fab.id = 'fj-fab';
    fab.title = '楼层跳转（可拖动）';
    fab.innerHTML = '<i class="fa-solid fa-list-ol"></i>';
    document.body.appendChild(fab);

    let sx, sy, ox, oy, dragging = false, moved = false;
    fab.addEventListener('pointerdown', (e) => {
        dragging = true; moved = false;
        sx = e.clientX; sy = e.clientY;
        const r = fab.getBoundingClientRect();
        ox = r.left; oy = r.top;
        fab.setPointerCapture(e.pointerId);
    });
    fab.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (!moved && Math.hypot(dx, dy) < 5) return;
        moved = true;
        placeFab(ox + dx, oy + dy);
    });
    fab.addEventListener('pointerup', () => {
        if (!dragging) return;
        dragging = false;
        if (moved) {
            const r = fab.getBoundingClientRect();
            settings().fabPos = { x: r.left, y: r.top };
            save();
        } else {
            togglePanel();
        }
    });
    applyFab();
}

function placeFab(x, y) {
    fab.style.left = clamp(x, 0, innerWidth - fab.offsetWidth) + 'px';
    fab.style.top = clamp(y, 0, innerHeight - fab.offsetHeight) + 'px';
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
}

function applyFab() {
    const s = settings();
    fab.style.display = s.showFab ? 'flex' : 'none';
    if (s.fabPos) {
        placeFab(s.fabPos.x, s.fabPos.y);
    } else {
        fab.style.left = fab.style.top = '';
        fab.style.right = ''; fab.style.bottom = '';
    }
}

/* ---------- 扩展菜单入口（魔法棒） ---------- */
function buildMenuItem() {
    const item = $(`
        <div id="fj-menu-item" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
            <div class="fa-solid fa-list-ol extensionsMenuExtensionButton"></div>
            <span>楼层跳转</span>
        </div>`);
    item.on('click', showPanel);
    $('#extensionsMenu').append(item);
}

/* ---------- 扩展设置面板 ---------- */
function buildSettings() {
    const html = `
    <div class="fj-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>楼层跳转 Floor Jump</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label"><input id="fj-set-fab" type="checkbox"><span>显示悬浮按钮</span></label>
                <label class="checkbox_label"><input id="fj-set-smooth" type="checkbox"><span>平滑滚动</span></label>
                <div id="fj-set-reset" class="menu_button">重置悬浮按钮位置</div>
                <small>斜杠命令：<code>/floor 楼层号</code>，负数从末尾数，如 <code>/floor -1</code></small>
            </div>
        </div>
    </div>`;
    $('#extensions_settings2').append(html);

    const s = settings();
    $('#fj-set-fab').prop('checked', s.showFab).on('change', function () {
        settings().showFab = this.checked; save(); applyFab();
    });
    $('#fj-set-smooth').prop('checked', s.smooth).on('change', function () {
        settings().smooth = this.checked; save();
    });
    $('#fj-set-reset').on('click', () => {
        settings().fabPos = null; save(); applyFab(); toast('已重置', 'success');
    });
}

/* ---------- 斜杠命令 ---------- */
function registerCommand() {
    const c = ctx();
    const callback = async (_args, value) => { await jumpTo(value); return ''; };
    try {
        c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
            name: 'floor',
            aliases: ['jumpto'],
            callback,
            unnamedArgumentList: [
                c.SlashCommandArgument.fromProps({
                    description: '楼层号，负数从末尾数（-1 = 最后一楼）',
                    typeList: [c.ARGUMENT_TYPE.NUMBER],
                    isRequired: true,
                }),
            ],
            helpString: '跳转到指定楼层。例：<code>/floor 25</code>、<code>/floor -1</code>',
        }));
    } catch (e) {
        // 旧版酒馆兼容
        c.registerSlashCommand?.('floor', callback, ['jumpto'], '跳转到指定楼层', true, true);
    }
}

/* ---------- 启动 ---------- */
jQuery(() => {
    settings();
    buildPanel();
    buildFab();
    buildMenuItem();
    buildSettings();
    registerCommand();
    ctx().eventSource.on(ctx().event_types.CHAT_CHANGED, hidePanel);
    console.log('[FloorJump] loaded');
});
