import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { getPresetApplicationPromise, oai_settings } from '../../../openai.js';

const extensionName = 'api-connection-presets';
const defaults = { presets: [], selectedId: '', autoRestore: true };
const selectors = {
    main: '#main_api',
    source: '#chat_completion_source',
    url: '#custom_api_url_text',
    model: '#custom_model_id',
    processing: '#custom_prompt_post_processing',
    stPreset: '#settings_preset_openai',
};

let settings;
let restoring = false;
let pendingRestore;

function save() {
    saveSettingsDebounced();
}

function readCurrent() {
    return {
        url: $(selectors.url).val().trim(),
        model: $(selectors.model).val().trim(),
        processing: $(selectors.processing).val() || '',
    };
}

function selectedPreset() {
    return settings.presets.find(preset => preset.id === settings.selectedId);
}

function setStatus(message, kind = '') {
    $('#acp-status').text(message).attr('data-kind', kind);
}

function refresh() {
    const $select = $('#acp-select').empty();
    $select.append($('<option>').val('').text('연결 프리셋 선택'));
    for (const preset of settings.presets) {
        $select.append($('<option>').val(preset.id).text(preset.name));
    }
    $select.val(selectedPreset()?.id || '');
    const hasSelection = !!selectedPreset();
    $('#acp-apply, #acp-update, #acp-rename, #acp-delete').prop('disabled', !hasSelection);
    $('#acp-auto').prop('checked', settings.autoRestore);
    $('#acp-count').text(`${settings.presets.length}개`);
}

function showEditor(mode) {
    const preset = selectedPreset();
    $('#acp-editor').prop('hidden', false).data('mode', mode);
    $('#acp-name').val(mode === 'rename' ? preset?.name || '' : '').trigger('focus');
    $('#acp-editor-label').text(mode === 'rename' ? '이름 변경' : '현재 설정 저장');
}

function hideEditor() {
    $('#acp-editor').prop('hidden', true);
    $('#acp-name').val('');
}

function commitEditor() {
    const name = $('#acp-name').val().trim();
    const mode = $('#acp-editor').data('mode');
    if (!name) return setStatus('이름을 입력하세요.', 'error');
    if (settings.presets.some(preset => preset.name.toLocaleLowerCase() === name.toLocaleLowerCase() && (mode !== 'rename' || preset.id !== settings.selectedId))) {
        return setStatus('같은 이름의 프리셋이 있습니다.', 'error');
    }
    if (mode === 'rename') {
        selectedPreset().name = name;
        setStatus('이름을 변경했습니다.', 'success');
    } else {
        const current = readCurrent();
        if (!current.url || !current.model) return setStatus('주소와 모델 ID를 먼저 입력하세요.', 'error');
        const preset = { id: crypto.randomUUID(), name, ...current };
        settings.presets.push(preset);
        settings.selectedId = preset.id;
        setStatus('현재 연결 설정을 저장했습니다.', 'success');
    }
    save();
    hideEditor();
    refresh();
}

function applyPreset({ quiet = false } = {}) {
    const preset = selectedPreset();
    if (!preset) return;
    if (!document.querySelector(selectors.url)) return;
    restoring = true;
    try {
        if ($(selectors.main).val() !== 'openai') $(selectors.main).val('openai').trigger('change');
        if ($(selectors.source).val() !== 'custom') $(selectors.source).val('custom').trigger('change');
        $(selectors.url).val(preset.url).trigger('input');
        $(selectors.model).val(preset.model).trigger('input');
        $(selectors.processing).val(preset.processing || '').trigger('change');
        // ST owns these values. The input events above invoke its normal save handlers.
        // Assigning them too covers versions where the handler is initialized later.
        oai_settings.custom_url = preset.url;
        oai_settings.custom_model = preset.model;
        oai_settings.custom_prompt_post_processing = preset.processing || '';
        saveSettingsDebounced();
        if (!quiet) setStatus('연결 설정을 적용했습니다. API 키는 ST의 현재 선택을 사용합니다.', 'success');
    } finally {
        restoring = false;
    }
}

function scheduleRestore() {
    if (restoring || !settings.autoRestore || !selectedPreset()) return;
    clearTimeout(pendingRestore);
    pendingRestore = setTimeout(async () => {
        try {
            await getPresetApplicationPromise();
            if (settings.autoRestore && selectedPreset()) applyPreset({ quiet: true });
        } catch (error) {
            console.warn(`[${extensionName}] Could not restore connection after preset change`, error);
        }
    }, 0);
}

function mount() {
    if ($('#acp-panel').length || !$(selectors.source).length) return;
    const $panel = $(`
        <section id="acp-panel" aria-label="API 연결 프리셋">
            <div class="acp-heading"><span><i class="fa-solid fa-layer-group"></i> 연결 프리셋</span><small id="acp-count">0개</small></div>
            <div class="acp-main-row">
                <select id="acp-select" aria-label="저장된 연결 프리셋"></select>
                <button type="button" id="acp-apply" class="acp-primary" title="선택한 설정 적용">적용</button>
                <button type="button" id="acp-new" title="현재 설정을 새 프리셋으로 저장" aria-label="새 프리셋 저장"><i class="fa-solid fa-plus"></i></button>
            </div>
            <div class="acp-tools">
                <button type="button" id="acp-update" title="현재 입력값으로 덮어쓰기"><i class="fa-solid fa-floppy-disk"></i> 덮어쓰기</button>
                <button type="button" id="acp-rename" title="프리셋 이름 변경"><i class="fa-solid fa-pen"></i> 이름</button>
                <button type="button" id="acp-delete" title="선택한 프리셋 삭제"><i class="fa-solid fa-trash"></i> 삭제</button>
                <label class="acp-auto"><input type="checkbox" id="acp-auto"> 프롬프트 프리셋 변경 시 복원</label>
            </div>
            <div id="acp-editor" hidden>
                <label id="acp-editor-label" for="acp-name">현재 설정 저장</label>
                <div class="acp-editor-row"><input id="acp-name" type="text" maxlength="64" placeholder="프리셋 이름" autocomplete="off"><button type="button" id="acp-confirm" class="acp-primary">저장</button><button type="button" id="acp-cancel">취소</button></div>
            </div>
            <div id="acp-status" role="status" aria-live="polite"></div>
        </section>`);
    $(selectors.source).after($panel);
    refresh();

    $('#acp-select').on('change', function () {
        settings.selectedId = this.value;
        save();
        refresh();
        setStatus(this.value ? '적용을 누르면 주소·모델·후처리가 바뀝니다.' : '');
    });
    $('#acp-apply').on('click', () => applyPreset());
    $('#acp-new').on('click', () => showEditor('new'));
    $('#acp-rename').on('click', () => showEditor('rename'));
    $('#acp-confirm').on('click', commitEditor);
    $('#acp-cancel').on('click', hideEditor);
    $('#acp-name').on('keydown', event => {
        if (event.key === 'Enter') commitEditor();
        if (event.key === 'Escape') hideEditor();
    });
    $('#acp-update').on('click', () => {
        const preset = selectedPreset();
        if (!preset) return;
        const current = readCurrent();
        if (!current.url || !current.model) return setStatus('주소와 모델 ID를 먼저 입력하세요.', 'error');
        Object.assign(preset, current);
        save();
        setStatus('현재 연결 설정으로 덮어썼습니다.', 'success');
    });
    $('#acp-delete').on('click', () => {
        const preset = selectedPreset();
        if (!preset || !window.confirm(`“${preset.name}” 연결 프리셋을 삭제할까요?`)) return;
        settings.presets = settings.presets.filter(item => item.id !== preset.id);
        settings.selectedId = '';
        save();
        hideEditor();
        refresh();
        setStatus('프리셋을 삭제했습니다.', 'success');
    });
    $('#acp-auto').on('change', function () {
        settings.autoRestore = this.checked;
        save();
    });
    $(selectors.stPreset).on('change.apiConnectionPresets', scheduleRestore);
    if (settings.autoRestore && selectedPreset()) scheduleRestore();
}

jQuery(async () => {
    settings = extension_settings[extensionName] ||= structuredClone(defaults);
    settings.presets = Array.isArray(settings.presets) ? settings.presets : [];
    settings.selectedId ||= '';
    settings.autoRestore ??= true;
    mount();
    eventSource.on(event_types.APP_READY, scheduleRestore);
});
