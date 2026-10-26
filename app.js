/* ============================================================
   JSON Code — application UI
   ============================================================ */

(function () {
  "use strict";

  const Core = window.JSONCodeCore;

  if (!Core) {
    console.error("JSON Code: core script failed to load.");
    return;
  }

  const SAMPLE_JSON = `{
  "project": "JSON Code",
  "tagline": "清爽、离线的 JSON 工作台",
  "version": "1.0.0",
  "features": [
    "格式化与压缩",
    "语法校验和行列定位",
    "树形结构浏览",
    "大整数精度保留"
  ],
  "settings": {
    "theme": "auto",
    "indent": 2,
    "sortKeys": false,
    "telemetry": null
  },
  "stats": {
    "stars": 1280,
    "forks": 96,
    "rating": 4.9
  },
  "maintainers": [
    {
      "name": "Lin",
      "role": "design",
      "active": true
    },
    {
      "name": "Chen",
      "role": "engineering",
      "active": true
    }
  ],
  "largeNumber": 900719925474099312345,
  "released": "2026-10-26T10:30:00+08:00",
  "license": "MIT"
}`;

  const STORAGE_KEYS = {
    theme: "jsoncode.theme",
    indent: "jsoncode.indent",
    sort: "jsoncode.sort",
    split: "jsoncode.split",
  };

  const LIVE_VALIDATE_LIMIT = 2 * 1024 * 1024;
  const AUTO_FORMAT_LIMIT = 8 * 1024 * 1024;
  const AUTO_FORMAT_DELAY = 200;
  const MAX_FILE_SIZE = 40 * 1024 * 1024;
  const HIGHLIGHT_MAX_CHARS = 900000;
  const HIGHLIGHT_MAX_LINES = 15000;
  const TREE_CHILD_LIMIT = 200;
  const TREE_AUTO_EXPAND_LIMIT = 400;

  const SVG_NS = "http://www.w3.org/2000/svg";
  const isMac = /Mac|iPhone|iPad|iPod/.test(
    navigator.platform || navigator.userAgent
  );

  const dom = {
    html: document.documentElement,
    themeMeta: document.querySelector('meta[name="theme-color"]'),
    workspace: document.getElementById("workspace"),
    resizer: document.getElementById("resizer"),

    input: document.getElementById("input"),
    inputGutter: document.getElementById("inputGutter"),
    positionText: document.getElementById("positionText"),
    charCount: document.getElementById("charCount"),
    inputHint: document.getElementById("inputHint"),
    inputPane: document.querySelector(".input-pane"),
    paneTitle: document.querySelector(".input-pane .pane-title"),

    formatBtn: document.getElementById("formatBtn"),
    minifyBtn: document.getElementById("minifyBtn"),
    validateBtn: document.getElementById("validateBtn"),
    themeBtn: document.getElementById("themeBtn"),
    openBtn: document.getElementById("openBtn"),
    sampleBtn: document.getElementById("sampleBtn"),
    clearBtn: document.getElementById("clearBtn"),

    resultTab: document.getElementById("resultTab"),
    treeTab: document.getElementById("treeTab"),
    emptyState: document.getElementById("emptyState"),
    emptyTitle: document.querySelector("#emptyState h2"),
    emptyText: document.querySelector("#emptyState p"),
    emptySampleBtn: document.getElementById("emptySampleBtn"),
    errorView: document.getElementById("errorView"),
    resultPanel: document.getElementById("resultPanel"),
    treePanel: document.getElementById("treePanel"),
    staleBadge: document.getElementById("staleBadge"),
    resultMode: document.getElementById("resultMode"),
    copyBtn: document.getElementById("copyBtn"),
    downloadBtn: document.getElementById("downloadBtn"),

    warningNotice: document.getElementById("warningNotice"),
    warningText: document.getElementById("warningText"),
    codeScroll: document.getElementById("codeScroll"),
    outputGutter: document.getElementById("outputGutter"),
    outputCode: document.getElementById("outputCode"),
    resultStats: document.getElementById("resultStats"),

    indentSelect: document.getElementById("indentSelect"),
    sortBtn: document.getElementById("sortBtn"),

    treeSearch: document.getElementById("treeSearch"),
    treeMatch: document.getElementById("treeMatch"),
    treeScroll: document.getElementById("treeScroll"),
    treeRoot: document.getElementById("treeRoot"),
    treeNoMatch: document.getElementById("treeNoMatch"),
    expandAllBtn: document.getElementById("expandAllBtn"),
    collapseAllBtn: document.getElementById("collapseAllBtn"),

    statusPill: document.getElementById("statusPill"),
    statusText: document.getElementById("statusText"),
    formatKbd: document.getElementById("formatKbd"),
    hintFormat: document.getElementById("hintFormat"),
    hintMinify: document.getElementById("hintMinify"),

    fileInput: document.getElementById("fileInput"),
    dropOverlay: document.getElementById("dropOverlay"),
    toastRegion: document.getElementById("toastRegion"),
  };

  const state = {
    mode: "formatted",
    view: "empty", // empty | result | error
    activeTab: "result",

    ast: null,
    stats: null,
    warnings: [],
    error: null,

    resultText: "",
    resultHTML: null,
    resultLines: 0,
    resultBytes: 0,
    lastFormattedText: null,
    stale: false,

    indent: "2",
    sortKeys: false,
    split: 50,
    fileName: null,

    expanded: new Set(["$"]),
    fullPaths: new Set(),
    treeSearch: "",

    live: {
      status: "empty",
      stats: null,
      warnings: [],
      error: null,
    },

    validateTimer: null,
    autoFormatTimer: null,
    treeTimer: null,
    dragDepth: 0,
    dragState: null,
  };

  let lastGutterLineCount = -1;
  const lineNumberCache = new Map();

  /* ============================================================
     Small utilities
     ============================================================ */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function createIcon(id, className) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", className || "icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", "#" + id);
    svg.appendChild(use);
    return svg;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  const numberFormatter = new Intl.NumberFormat("zh-CN");

  function formatNumber(value) {
    return numberFormatter.format(value);
  }

  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) {
      const value = bytes / 1024;
      return (value >= 10 ? value.toFixed(0) : value.toFixed(1)) + " KB";
    }
    const value = bytes / (1024 * 1024);
    return (value >= 10 ? value.toFixed(0) : value.toFixed(1)) + " MB";
  }

  function utf8Size(text) {
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(text).length;
    }
    return new Blob([text]).size;
  }

  function countLines(text) {
    if (!text) return 1;
    let lines = 1;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) lines++;
    }
    return lines;
  }

  function getLineNumbers(count) {
    if (count > 50000) return "…";
    const cached = lineNumberCache.get(count);
    if (cached !== undefined) return cached;
    const numbers = new Array(count);
    for (let i = 0; i < count; i++) numbers[i] = i + 1;
    const result = numbers.join("\n");
    if (lineNumberCache.size > 4) lineNumberCache.clear();
    lineNumberCache.set(count, result);
    return result;
  }

  function indexToPosition(text, index) {
    const safeIndex = clamp(index, 0, text.length);
    let line = 1;
    let lineStart = 0;
    for (let i = 0; i < safeIndex; i++) {
      if (text.charCodeAt(i) === 10) {
        line++;
        lineStart = i + 1;
      }
    }
    return {
      line: line,
      column: safeIndex - lineStart + 1,
      lineStart: lineStart,
      index: safeIndex,
    };
  }

  function expandTabs(text) {
    return text.replace(/\t/g, "  ");
  }

  function syncInputGutter() {
    dom.inputGutter.scrollTop = dom.input.scrollTop;
  }

  function updateCaretPosition() {
    const position = indexToPosition(dom.input.value, dom.input.selectionStart);
    dom.positionText.textContent =
      "第 " + position.line + " 行，第 " + position.column + " 列";
  }

  function updateEditorMetrics() {
    const value = dom.input.value;
    const lines = countLines(value);

    if (lines !== lastGutterLineCount) {
      dom.inputGutter.textContent = getLineNumbers(lines);
      lastGutterLineCount = lines;
    }

    dom.charCount.textContent = formatNumber(value.length) + " 字符";
    dom.clearBtn.disabled = value.length === 0;
    updateCaretPosition();
    syncInputGutter();
  }

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      /* Local storage can be blocked; preferences are not essential. */
    }
  }

  function normalizeParseError(error, text) {
    const index =
      error && typeof error.index === "number" ? error.index : 0;
    return {
      message:
        error && error.message ? error.message : "无法解析这段 JSON",
      hint: error && error.hint ? error.hint : "",
      index: clamp(index, 0, text.length),
      text: text,
    };
  }

  /* ============================================================
     Theme, preferences, layout
     ============================================================ */

  function getInitialTheme() {
    const stored = storageGet(STORAGE_KEYS.theme);
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function applyTheme(theme, persist) {
    dom.html.dataset.theme = theme;
    if (dom.themeMeta) {
      dom.themeMeta.setAttribute(
        "content",
        theme === "dark" ? "#0e100f" : "#f3f1ea"
      );
    }
    if (dom.themeBtn) {
      dom.themeBtn.setAttribute(
        "aria-label",
        theme === "dark" ? "切换到浅色主题" : "切换到深色主题"
      );
      dom.themeBtn.title =
        theme === "dark" ? "切换到浅色主题" : "切换到深色主题";
    }
    if (persist) storageSet(STORAGE_KEYS.theme, theme);
  }

  function toggleTheme() {
    applyTheme(
      dom.html.dataset.theme === "dark" ? "light" : "dark",
      true
    );
  }

  function applySplit(percent, persist) {
    const safe = clamp(percent, 28, 72);
    state.split = safe;
    dom.workspace.style.gridTemplateColumns =
      "minmax(0, " +
      safe +
      "fr) 12px minmax(0, " +
      (100 - safe) +
      "fr)";
    dom.resizer.setAttribute("aria-valuemin", "28");
    dom.resizer.setAttribute("aria-valuemax", "72");
    dom.resizer.setAttribute("aria-valuenow", String(Math.round(safe)));
    if (persist) storageSet(STORAGE_KEYS.split, String(safe));
  }

  function loadPreferences() {
    const indent = storageGet(STORAGE_KEYS.indent);
    if (indent === "2" || indent === "4" || indent === "tab") {
      state.indent = indent;
    }
    dom.indentSelect.value = state.indent;

    state.sortKeys = storageGet(STORAGE_KEYS.sort) === "1";
    updateSortButton();

    const rawSplit = parseFloat(storageGet(STORAGE_KEYS.split));
    if (!isNaN(rawSplit)) applySplit(rawSplit, false);
    else applySplit(50, false);

    applyTheme(getInitialTheme(), false);
  }

  function updateSortButton() {
    dom.sortBtn.setAttribute(
      "aria-pressed",
      state.sortKeys ? "true" : "false"
    );
    dom.sortBtn.title = state.sortKeys
      ? "当前按键名排序，点击恢复原始顺序"
      : "按键名 A → Z 排序";
  }

  function getIndentUnit() {
    if (state.indent === "tab") return "\t";
    return " ".repeat(Number(state.indent) || 2);
  }

  function updateShortcutLabels() {
    const mod = isMac ? "⌘" : "Ctrl";
    dom.formatKbd.textContent = isMac ? "⌘↵" : "Ctrl ↵";
    dom.hintFormat.textContent = isMac ? "⌘↵" : "Ctrl ↵";
    dom.hintMinify.textContent = isMac ? "⌘⇧M" : "Ctrl Shift M";

    const openHint = document.querySelector(
      ".status-hints span:nth-child(3) kbd"
    );
    if (openHint) openHint.textContent = isMac ? "⌘O" : "Ctrl O";

    dom.formatBtn.title = "格式化 JSON（" + mod + " + Enter）";
    dom.minifyBtn.title = "压缩为一行（" + mod + " + Shift + M）";
    dom.openBtn.title = "打开本地 JSON 文件（" + mod + " + O）";

    dom.input.placeholder =
      "{\n" +
      '  "提示": "在这里粘贴 JSON",\n' +
      '  "快捷键": "' +
      mod +
      ' + Enter 格式化",\n' +
      '  "自动格式化": "输入后 ' +
      AUTO_FORMAT_DELAY +
      'ms 更新"\n' +
      "}";
  }

  /* ============================================================
     Status bar
     ============================================================ */

  const EMPTY_STATE_COPY = {
    title: "把 JSON 放进来",
    text: "在左侧粘贴、拖入文件，或载入示例。格式化、校验和结构浏览都会即时更新。",
  };

  function updateEmptyStateCopy() {
    if (!dom.emptyTitle || !dom.emptyText) return;

    const hasText = dom.input.value.trim().length > 0;
    const status = state.live.status;

    if (!hasText) {
      dom.emptyTitle.textContent = EMPTY_STATE_COPY.title;
      dom.emptyText.textContent = EMPTY_STATE_COPY.text;
      return;
    }

    if (status === "checking") {
      return;
    }

    if (status === "valid") {
      dom.emptyTitle.textContent = "JSON 已就绪";
      dom.emptyText.textContent =
        "语法检查通过，格式化结果会自动更新。也可以点击“格式化”，或按 " +
        (isMac ? "⌘ + Enter" : "Ctrl + Enter") +
        " 立即生成。";
    } else if (status === "invalid") {
      dom.emptyTitle.textContent = "JSON 还有语法错误";
      dom.emptyText.textContent =
        "底部状态栏会显示具体位置。点击“格式化”可以查看完整的错误上下文。";
    } else if (status === "skipped") {
      dom.emptyTitle.textContent = "内容较大";
      dom.emptyText.textContent =
        "已暂停自动校验。点击“格式化”开始处理这份 JSON。";
    } else {
      dom.emptyTitle.textContent = EMPTY_STATE_COPY.title;
      dom.emptyText.textContent = EMPTY_STATE_COPY.text;
    }
  }

  function updateStatus() {
    const live = state.live;
    let label = "等待输入";
    let tone = "empty";
    let title = "";

    if (live.status === "checking") {
      label = "正在校验…";
      tone = "checking";
    } else if (live.status === "valid") {
      const duplicates =
        live.warnings && live.warnings.length ? live.warnings.length : 0;
      if (duplicates > 0) {
        label =
          "JSON 有效 · " + formatNumber(duplicates) + " 个重复键";
        tone = "warning";
        title = "输入是有效 JSON，但存在重复键。点击查看重复位置。";
      } else {
        label =
          "JSON 有效 · " +
          formatNumber(live.stats ? live.stats.nodes : 0) +
          " 个节点";
        tone = "valid";
        title = "JSON 语法正确";
      }
    } else if (live.status === "invalid" && live.error) {
      const position = indexToPosition(
        live.error.text || dom.input.value,
        live.error.index
      );
      label =
        "第 " +
        position.line +
        " 行，第 " +
        position.column +
        " 列 · " +
        live.error.message;
      tone = "invalid";
      title = live.error.message + "，点击定位到错误";
    } else if (live.status === "skipped") {
      label = "内容较大 · 点击“格式化”校验";
      tone = "empty";
      title = "已暂停自动校验，手动格式化仍可处理";
    }

    dom.statusPill.dataset.state = tone;
    dom.statusText.textContent = label;
    dom.statusPill.title = title || label;

    dom.paneTitle.classList.toggle(
      "is-valid",
      tone === "valid" || tone === "warning"
    );
    dom.paneTitle.classList.toggle("is-invalid", tone === "invalid");
    dom.paneTitle.classList.toggle("is-warning", tone === "warning");
    updateEmptyStateCopy();
  }

  function scheduleValidation(delay) {
    if (state.validateTimer) {
      clearTimeout(state.validateTimer);
      state.validateTimer = null;
    }

    const text = dom.input.value;

    if (!text.trim()) {
      state.live = {
        status: "empty",
        stats: null,
        warnings: [],
        error: null,
      };
      if (state.view === "error") {
        clearOutputData();
        state.view = "empty";
        state.error = null;
        updateChrome();
      }
      updateStatus();
      return;
    }

    if (text.length > LIVE_VALIDATE_LIMIT) {
      state.live = {
        status: "skipped",
        stats: null,
        warnings: [],
        error: null,
      };
      updateStatus();
      return;
    }

    state.live = {
      status: "checking",
      stats: null,
      warnings: [],
      error: null,
    };
    updateStatus();

    state.validateTimer = setTimeout(
      runLiveValidation,
      typeof delay === "number" ? delay : 260
    );
  }

  function runLiveValidation() {
    state.validateTimer = null;
    const text = dom.input.value;

    if (!text.trim()) {
      state.live = {
        status: "empty",
        stats: null,
        warnings: [],
        error: null,
      };
      updateStatus();
      return;
    }

    try {
      const parsed = Core.parseJson(text);
      state.live = {
        status: "valid",
        stats: parsed.stats,
        warnings: parsed.warnings,
        error: null,
      };

      if (state.view === "error") {
        clearOutputData();
        state.view = "empty";
        state.error = null;
        updateChrome();
      }
    } catch (error) {
      state.live = {
        status: "invalid",
        stats: null,
        warnings: [],
        error: normalizeParseError(error, text),
      };

      if (state.view === "error") {
        state.error = state.live.error;
        renderError(state.error);
        updateChrome();
      }
    }

    updateStatus();
  }

  function cancelValidation() {
    if (state.validateTimer) {
      clearTimeout(state.validateTimer);
      state.validateTimer = null;
    }
  }

  function cancelAutoFormat() {
    if (state.autoFormatTimer) {
      clearTimeout(state.autoFormatTimer);
      state.autoFormatTimer = null;
    }
  }

  function scheduleAutoFormat() {
    cancelAutoFormat();

    if (dom.input.value.length > AUTO_FORMAT_LIMIT) return;

    state.autoFormatTimer = setTimeout(runAutoFormat, AUTO_FORMAT_DELAY);
  }

  function runAutoFormat() {
    state.autoFormatTimer = null;
    const text = dom.input.value;

    if (!text.trim()) {
      cancelValidation();
      state.live = {
        status: "empty",
        stats: null,
        warnings: [],
        error: null,
      };

      if (state.view !== "empty") {
        clearOutputData();
        state.view = "empty";
        state.activeTab = "result";
        updateChrome();
      }

      updateStatus();
      return;
    }

    if (text.length > AUTO_FORMAT_LIMIT) return;

    processJson("formatted", {
      quiet: true,
      auto: true,
      preserveScroll: true,
    });
  }

  /* ============================================================
     Output state and rendering
     ============================================================ */

  function createOutputData(ast, mode) {
    const minify = mode === "minified";
    const indentUnit = getIndentUnit();
    const text = Core.serializeJson(ast, {
      indentUnit: indentUnit,
      minify: minify,
      sortKeys: state.sortKeys,
    });
    const lines = countLines(text);
    const bytes = utf8Size(text);
    const canHighlight =
      text.length <= HIGHLIGHT_MAX_CHARS && lines <= HIGHLIGHT_MAX_LINES;

    return {
      text: text,
      lines: lines,
      bytes: bytes,
      html: canHighlight
        ? Core.highlightJson(ast, {
            indentUnit: indentUnit,
            minify: minify,
            sortKeys: state.sortKeys,
          })
        : null,
    };
  }

  function updateResultStats() {
    if (state.view !== "result" || !state.resultText) {
      return;
    }

    const parts = [
      "<strong>" + formatNumber(state.resultLines) + "</strong> 行",
      formatBytes(state.resultBytes),
      "<strong>" +
        formatNumber(state.stats ? state.stats.nodes : 0) +
        "</strong> 个节点",
      "深度 " + (state.stats ? state.stats.depth : 0),
    ];

    if (state.resultHTML === null) {
      parts.push("纯文本模式");
    }

    dom.resultStats.innerHTML = parts.join(" · ");
    dom.resultStats.title =
      "结果：" +
      formatNumber(state.resultLines) +
      " 行，" +
      formatBytes(state.resultBytes) +
      "，输入 " +
      formatNumber(dom.input.value.length) +
      " 字符";
  }

  function renderWarnings() {
    const warnings = state.warnings;
    if (!warnings.length) {
      dom.warningNotice.hidden = true;
      dom.warningText.textContent = "";
      return;
    }

    dom.warningNotice.hidden = false;
    dom.warningText.textContent = "";

    const lead = el("span");
    lead.textContent =
      "发现 " +
      formatNumber(warnings.length) +
      " 个重复键。格式化会完整保留，但大多数解析器只会采用最后一个值。";
    dom.warningText.appendChild(lead);

    const pathRow = el("div", "notice-paths");
    pathRow.appendChild(document.createTextNode("重复位置："));

    warnings.slice(0, 3).forEach(function (warning, index) {
      if (index > 0) pathRow.appendChild(document.createTextNode("、"));
      pathRow.appendChild(el("code", null, warning.path));
    });

    if (warnings.length > 3) {
      pathRow.appendChild(
        document.createTextNode(
          " 等 " + formatNumber(warnings.length) + " 处"
        )
      );
    }

    dom.warningText.appendChild(pathRow);
  }

  function renderOutput(options) {
    const opts = options || {};
    const preserveScroll = !!opts.preserveScroll;

    dom.warningNotice.hidden = true;
    dom.warningText.textContent = "";
    renderWarnings();

    if (state.resultHTML !== null) {
      dom.outputCode.innerHTML = state.resultHTML;
    } else {
      dom.outputCode.textContent = state.resultText;
    }

    if (state.resultLines <= 50000) {
      dom.outputGutter.style.display = "";
      dom.outputGutter.textContent = getLineNumbers(state.resultLines);
    } else {
      dom.outputGutter.style.display = "none";
      dom.outputGutter.textContent = "";
    }

    if (!preserveScroll) {
      dom.codeScroll.scrollTop = 0;
      dom.codeScroll.scrollLeft = 0;
    }

    updateResultStats();
    updateChrome();

    if (
      opts.animate &&
      dom.outputCode.animate &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      dom.outputCode.animate(
        [
          { opacity: 0.35, transform: "translateY(1px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 190, easing: "ease-out" }
      );
    }
  }

  function cancelTreeSearchTimer() {
    if (state.treeTimer) {
      clearTimeout(state.treeTimer);
      state.treeTimer = null;
    }
  }

  function clearOutputDom() {
    dom.outputCode.textContent = "";
    dom.outputGutter.textContent = "";
    dom.outputGutter.style.display = "";
    dom.warningNotice.hidden = true;
    dom.warningText.textContent = "";
    dom.errorView.textContent = "";
    dom.errorView.hidden = true;
  }

  function clearOutputData() {
    cancelTreeSearchTimer();
    state.ast = null;
    state.stats = null;
    state.warnings = [];
    state.error = null;
    state.resultText = "";
    state.resultHTML = null;
    state.resultLines = 0;
    state.resultBytes = 0;
    state.lastFormattedText = null;
    state.stale = false;
    state.expanded = new Set(["$"]);
    state.fullPaths = new Set();
    state.treeSearch = "";
    dom.treeSearch.value = "";
    dom.treeMatch.hidden = true;
    dom.treeNoMatch.hidden = true;
    dom.treeRoot.textContent = "";
    clearOutputDom();
  }

  function rebuildOutput() {
    if (state.view !== "result" || !state.ast) return;

    const output = createOutputData(state.ast, state.mode);
    state.resultText = output.text;
    state.resultLines = output.lines;
    state.resultBytes = output.bytes;
    state.resultHTML = output.html;

    renderOutput({ preserveScroll: true, animate: false });
    updateChrome();

    if (state.activeTab === "tree") {
      renderTree({ preserveScroll: true });
    }
  }

  /* ============================================================
     Error view
     ============================================================ */

  function focusInputAt(index) {
    const safeIndex = clamp(index, 0, dom.input.value.length);
    const position = indexToPosition(dom.input.value, safeIndex);
    const lineHeight =
      parseFloat(window.getComputedStyle(dom.input).lineHeight) || 24;

    dom.input.focus({ preventScroll: true });
    dom.input.setSelectionRange(
      safeIndex,
      Math.min(safeIndex + 1, dom.input.value.length)
    );

    const top =
      (position.line - 1) * lineHeight -
      dom.input.clientHeight / 2 +
      lineHeight;
    dom.input.scrollTop = Math.max(0, top);
    syncInputGutter();
    updateCaretPosition();
  }

  function buildErrorSnippet(error, position) {
    const text = error.text || "";
    const lines = text.split("\n");
    const activeLine = clamp(position.line - 1, 0, lines.length - 1);
    const start = Math.max(0, activeLine - 2);
    const end = Math.min(lines.length - 1, activeLine + 2);
    const wrapper = el("div", "error-snippet");

    for (let i = start; i <= end; i++) {
      let raw = lines[i];
      if (raw.endsWith("\r")) raw = raw.slice(0, -1);

      const row = el(
        "div",
        "snippet-line" + (i === activeLine ? " is-error" : "")
      );
      row.appendChild(el("span", "snippet-ln", String(i + 1)));
      const code = el("span", "snippet-code");

      if (i === activeLine) {
        const offset = clamp(position.column - 1, 0, raw.length);
        const before = expandTabs(raw.slice(0, offset));
        const rawChar = raw.slice(offset, offset + 1);
        const hitChar =
          rawChar === "\t" ? "  " : rawChar === "" ? " " : rawChar;
        const after = expandTabs(raw.slice(offset + rawChar.length));

        code.appendChild(document.createTextNode(before));
        const hit = el("span", "snippet-hit", hitChar);
        code.appendChild(hit);
        code.appendChild(document.createTextNode(after));
      } else {
        code.textContent = expandTabs(raw);
      }

      row.appendChild(code);
      wrapper.appendChild(row);

      if (i === activeLine) {
        const caret = el("div", "snippet-caret");
        caret.appendChild(el("span", "snippet-ln", ""));
        const caretCode = el("span", "snippet-code");
        const offset = clamp(position.column - 1, 0, raw.length);
        caretCode.textContent =
          expandTabs(raw.slice(0, offset)).replace(/./g, " ") + "^";
        caret.appendChild(caretCode);
        wrapper.appendChild(caret);
      }
    }

    return wrapper;
  }

  function renderError(error) {
    dom.errorView.textContent = "";
    const position = indexToPosition(error.text || "", error.index);
    const head = el("div", "error-head");

    const iconWrap = el("div", "error-icon");
    iconWrap.appendChild(createIcon("i-x-circle"));
    head.appendChild(iconWrap);

    const titleWrap = el("div");
    titleWrap.appendChild(el("div", "error-kicker", "JSON 语法错误"));
    titleWrap.appendChild(el("h2", "error-title", error.message));
    head.appendChild(titleWrap);

    const location = el("div", "error-location");
    location.appendChild(
      el("span", "location-pill", "第 " + position.line + " 行")
    );
    location.appendChild(
      el("span", "location-pill", "第 " + position.column + " 列")
    );
    location.appendChild(
      el(
        "span",
        "location-pill",
        "字符偏移 " + formatNumber(error.index)
      )
    );
    location.appendChild(
      el("span", null, "错误附近的内容在下方标出")
    );

    const snippet = buildErrorSnippet(error, position);

    const actions = el("div", "error-actions");
    const locateBtn = el("button", "btn btn-primary", "");
    locateBtn.type = "button";
    locateBtn.appendChild(createIcon("i-locate"));
    locateBtn.appendChild(document.createTextNode("定位到错误"));
    locateBtn.addEventListener("click", function () {
      focusInputAt(error.index);
    });
    actions.appendChild(locateBtn);

    const copyErrorBtn = el("button", "btn-secondary", "");
    copyErrorBtn.type = "button";
    copyErrorBtn.appendChild(createIcon("i-copy"));
    copyErrorBtn.appendChild(document.createTextNode("复制错误信息"));
    copyErrorBtn.addEventListener("click", async function () {
      const details = [
        error.message,
        "第 " + position.line + " 行，第 " + position.column + " 列",
        error.hint,
      ]
        .filter(Boolean)
        .join("\n");
      const copied = await copyText(details);
      showToast(copied ? "已复制错误信息" : "复制失败，请手动选择", {
        tone: copied ? "success" : "danger",
      });
    });
    actions.appendChild(copyErrorBtn);

    dom.errorView.appendChild(head);
    dom.errorView.appendChild(location);
    dom.errorView.appendChild(snippet);

    if (error.hint) {
      const hint = el("div", "error-hint");
      hint.appendChild(createIcon("i-alert"));
      hint.appendChild(el("span", null, error.hint));
      dom.errorView.appendChild(hint);
    }

    dom.errorView.appendChild(actions);
  }

  function showParseError(error, text) {
    const record = normalizeParseError(error, text);
    clearOutputData();
    state.mode = state.mode || "formatted";
    state.view = "error";
    state.error = record;
    state.activeTab = "result";
    state.live = {
      status: "invalid",
      stats: null,
      warnings: [],
      error: record,
    };
    renderError(record);
    updateStatus();
    updateChrome();
  }

  /* ============================================================
     Main actions
     ============================================================ */

  function processJson(mode, options) {
    const opts = options || {};
    const text = dom.input.value;

    cancelAutoFormat();

    if (!text.trim()) {
      if (!opts.quiet) {
        showToast("先粘贴或输入一些 JSON 再试", { tone: "warning" });
        dom.input.focus();
      }
      return false;
    }

    let parsed;
    try {
      parsed = Core.parseJson(text);
    } catch (error) {
      if (opts.auto) return false;
      cancelValidation();
      state.mode = mode;
      showParseError(error, text);
      return false;
    }

    cancelValidation();

    const sameDocument = state.lastFormattedText === text && !!state.ast;

    state.mode = mode;
    state.ast = parsed.ast;
    state.stats = parsed.stats;
    state.warnings = parsed.warnings;
    state.error = null;
    state.view = "result";
    state.lastFormattedText = text;
    state.stale = false;

    if (!sameDocument) {
      cancelTreeSearchTimer();
      state.expanded = defaultExpandedPaths(parsed.ast, parsed.stats);
      state.fullPaths = new Set();
      state.treeSearch = "";
      dom.treeSearch.value = "";
      dom.treeMatch.hidden = true;
      dom.treeNoMatch.hidden = true;
    }

    state.live = {
      status: "valid",
      stats: parsed.stats,
      warnings: parsed.warnings,
      error: null,
    };

    const output = createOutputData(parsed.ast, mode);
    state.resultText = output.text;
    state.resultLines = output.lines;
    state.resultBytes = output.bytes;
    state.resultHTML = output.html;

    if (state.activeTab !== "tree") state.activeTab = "result";

    renderOutput({
      animate: !opts.quiet && !opts.auto,
      preserveScroll: !!opts.preserveScroll,
    });
    updateStatus();
    updateChrome();

    if (state.activeTab === "tree") {
      renderTree({ preserveScroll: !!opts.preserveScroll });
    }

    return true;
  }

  function validateOnly() {
    const text = dom.input.value;

    if (!text.trim()) {
      showToast("先粘贴或输入一些 JSON 再试", { tone: "warning" });
      dom.input.focus();
      return;
    }

    let parsed;
    try {
      parsed = Core.parseJson(text);
    } catch (error) {
      const record = normalizeParseError(error, text);
      state.live = {
        status: "invalid",
        stats: null,
        warnings: [],
        error: record,
      };
      updateStatus();

      if (state.view === "result" && state.resultText) {
        const position = indexToPosition(text, record.index);
        showToast(
          "第 " +
            position.line +
            " 行第 " +
            position.column +
            " 列 · " +
            record.message,
          {
            tone: "danger",
            duration: 6000,
            actionLabel: "定位",
            onAction: function () {
              focusInputAt(record.index);
            },
          }
        );
      } else {
        cancelValidation();
        showParseError(error, text);
      }
      return;
    }

    state.live = {
      status: "valid",
      stats: parsed.stats,
      warnings: parsed.warnings,
      error: null,
    };
    updateStatus();

    if (parsed.warnings.length > 0) {
      showToast(
        "JSON 有效，但发现 " +
          formatNumber(parsed.warnings.length) +
          " 个重复键",
        { tone: "warning" }
      );
    } else {
      showToast(
        "JSON 有效 · " + formatNumber(parsed.stats.nodes) + " 个节点",
        { tone: "success" }
      );
    }
  }

  function updateChrome() {
    const hasResult =
      state.view === "result" && state.resultText.length > 0;

    if (!hasResult && state.activeTab === "tree") {
      state.activeTab = "result";
    }

    dom.treeTab.disabled = !hasResult;
    dom.resultTab.setAttribute(
      "aria-selected",
      state.activeTab === "result" ? "true" : "false"
    );
    dom.treeTab.setAttribute(
      "aria-selected",
      state.activeTab === "tree" ? "true" : "false"
    );
    dom.resultTab.tabIndex = state.activeTab === "result" ? 0 : -1;
    dom.treeTab.tabIndex = state.activeTab === "tree" ? 0 : -1;

    dom.copyBtn.disabled = !hasResult;
    dom.downloadBtn.disabled = !hasResult;

    dom.resultMode.hidden = !hasResult;
    if (hasResult) {
      dom.resultMode.textContent =
        state.mode === "minified" ? "已压缩" : "已格式化";
    }

    dom.staleBadge.hidden = !(hasResult && state.stale);

    const indentDisabled = hasResult && state.mode === "minified";
    dom.indentSelect.disabled = indentDisabled;
    const indentField = dom.indentSelect.closest(".mini-field");
    if (indentField) {
      indentField.classList.toggle("is-disabled", indentDisabled);
    }

    if (state.view === "result") {
      dom.emptyState.hidden = true;
      dom.errorView.hidden = true;
      dom.resultPanel.hidden = state.activeTab !== "result";
      dom.treePanel.hidden = state.activeTab !== "tree";
    } else if (state.view === "error") {
      dom.emptyState.hidden = true;
      dom.errorView.hidden = false;
      dom.resultPanel.hidden = true;
      dom.treePanel.hidden = true;
    } else {
      dom.emptyState.hidden = false;
      dom.errorView.hidden = true;
      dom.resultPanel.hidden = true;
      dom.treePanel.hidden = true;
    }

    dom.resultPanel.classList.toggle(
      "is-stale",
      hasResult && state.stale
    );

    if (state.view === "empty") {
      dom.resultStats.textContent = "等待格式化";
      dom.resultStats.title = "";
    } else if (state.view === "error") {
      dom.resultStats.textContent = "解析失败，未生成结果";
      dom.resultStats.title = "";
    }

    dom.inputHint.textContent =
      state.fileName ||
      "自动格式化已开启 · " + AUTO_FORMAT_DELAY + "ms";
    dom.inputHint.title = state.fileName || "";
    dom.clearBtn.disabled = dom.input.value.length === 0;

    updateTabsHint();
  }

  function updateTabsHint() {
    dom.resultTab.title = "查看格式化结果";
    dom.treeTab.title =
      state.view === "result"
        ? "浏览 JSON 结构"
        : "生成结果后可以浏览结构";
  }

  function selectTab(tab, options) {
    const opts = options || {};

    if (tab === "tree" && state.view !== "result") return;

    state.activeTab = tab;

    if (tab === "tree") {
      cancelTreeSearchTimer();
      state.treeSearch = dom.treeSearch.value;
      renderTree({ preserveScroll: true });
    }

    updateChrome();

    if (opts.focus) {
      (tab === "tree" ? dom.treeTab : dom.resultTab).focus();
    }
  }

  function refreshStale() {
    const stale =
      !!state.resultText &&
      state.lastFormattedText !== null &&
      dom.input.value !== state.lastFormattedText;

    if (state.stale !== stale) {
      state.stale = stale;
      updateChrome();
    }
  }

  function handleInput() {
    updateEditorMetrics();
    refreshStale();
    scheduleValidation();
    scheduleAutoFormat();
    updateChrome();
  }

  /* ============================================================
     Tree view
     ============================================================ */

  function isContainer(node) {
    return node.type === "object" || node.type === "array";
  }

  function containerSize(node) {
    return node.type === "object"
      ? node.entries.length
      : node.items.length;
  }

  function orderedEntries(node) {
    if (node.type !== "object") return [];
    if (!state.sortKeys) return node.entries;
    return node.entries.slice().sort(function (a, b) {
      if (a.key < b.key) return -1;
      if (a.key > b.key) return 1;
      return 0;
    });
  }

  function childDescriptors(node, path) {
    if (node.type === "object") {
      return orderedEntries(node).map(function (entry) {
        return {
          node: entry.value,
          key: entry.key,
          isIndex: false,
          path: Core.joinPath(path, entry.key),
        };
      });
    }

    return node.items.map(function (item, index) {
      return {
        node: item,
        key: index,
        isIndex: true,
        path: path + "[" + index + "]",
      };
    });
  }

  function primitiveText(node) {
    if (node.type === "string") return JSON.stringify(node.value);
    if (node.type === "number") return node.raw;
    if (node.type === "boolean") return node.value ? "true" : "false";
    if (node.type === "null") return "null";
    return "";
  }

  function defaultExpandedPaths(ast, stats) {
    const expanded = new Set();
    if (!isContainer(ast)) return expanded;
    if (stats.nodes > TREE_AUTO_EXPAND_LIMIT) {
      expanded.add("$");
      return expanded;
    }

    expanded.add("$");
    childDescriptors(ast, "$").forEach(function (child) {
      if (isContainer(child.node) && containerSize(child.node) > 0) {
        expanded.add(child.path);
      }
    });
    return expanded;
  }

  function descriptorKeyMatches(descriptor, query) {
    return !!(
      descriptor &&
      !descriptor.isIndex &&
      !descriptor.isRoot &&
      descriptor.key !== null &&
      String(descriptor.key).toLowerCase().indexOf(query) !== -1
    );
  }

  function countMatches(node, descriptor, query) {
    let count = 0;

    if (descriptorKeyMatches(descriptor, query)) {
      count++;
    }

    if (isContainer(node)) {
      childDescriptors(node, descriptor ? descriptor.path : "$").forEach(
        function (child) {
          count += countMatches(child.node, child, query);
        }
      );
    } else if (
      primitiveText(node).toLowerCase().indexOf(query) !== -1
    ) {
      count++;
    }

    return count;
  }

  function subtreeMatches(node, descriptor, query) {
    if (descriptorKeyMatches(descriptor, query)) {
      return true;
    }

    if (isContainer(node)) {
      const children = childDescriptors(
        node,
        descriptor ? descriptor.path : "$"
      );
      for (let i = 0; i < children.length; i++) {
        if (subtreeMatches(children[i].node, children[i], query)) {
          return true;
        }
      }
      return false;
    }

    return primitiveText(node).toLowerCase().indexOf(query) !== -1;
  }

  function appendHighlightedText(parent, text, query) {
    if (!query) {
      parent.appendChild(document.createTextNode(text));
      return;
    }

    const haystack = text.toLowerCase();
    let cursor = 0;

    while (cursor < text.length) {
      const found = haystack.indexOf(query, cursor);
      if (found === -1) break;

      if (found > cursor) {
        parent.appendChild(
          document.createTextNode(text.slice(cursor, found))
        );
      }

      parent.appendChild(el("mark", null, text.slice(found, found + query.length)));
      cursor = found + query.length;
    }

    if (cursor < text.length) {
      parent.appendChild(document.createTextNode(text.slice(cursor)));
    }
  }

  function renderTree(options) {
    const opts = options || {};
    const preserveScroll = !!opts.preserveScroll;
    const scrollTop = preserveScroll ? dom.treeScroll.scrollTop : 0;
    const query = state.treeSearch.trim().toLowerCase();
    const hasData = state.view === "result" && !!state.ast;

    dom.treeRoot.textContent = "";
    dom.treeRoot.hidden = true;
    dom.treeNoMatch.hidden = true;
    dom.treeMatch.hidden = !query;

    if (!hasData) {
      dom.treeScroll.scrollTop = 0;
      return;
    }

    let matchCount = 0;
    if (query) {
      matchCount = countMatches(state.ast, { isRoot: true, key: null, path: "$" }, query);
      dom.treeMatch.textContent =
        formatNumber(matchCount) + " 处匹配";
    }

    if (query && matchCount === 0) {
      dom.treeNoMatch.hidden = false;
      dom.treeScroll.scrollTop = 0;
      return;
    }

    dom.treeRoot.hidden = false;

    const rootDescriptor = {
      isRoot: true,
      key: null,
      isIndex: false,
      path: "$",
    };

    renderTreeNode(state.ast, rootDescriptor, dom.treeRoot, query, false);

    dom.treeScroll.scrollTop = scrollTop;
  }

  function renderTreeNode(node, descriptor, parent, query, revealAll) {
    const keyMatches = !!query && descriptorKeyMatches(descriptor, query);
    const hasMatch = !!query && subtreeMatches(node, descriptor, query);

    if (query && !revealAll && !hasMatch) {
      return false;
    }

    parent.appendChild(createTreeRow(node, descriptor, query));

    if (isContainer(node)) {
      const open = canOpenTreeNode(node, descriptor, query, keyMatches, hasMatch);
      if (!open) return true;

      const children = childDescriptors(node, descriptor.path);
      const showAllChildren = !query || revealAll || keyMatches;
      const visible = showAllChildren
        ? children
        : children.filter(function (child) {
            return subtreeMatches(child.node, child, query);
          });

      if (visible.length === 0) return true;

      const limit = state.fullPaths.has(descriptor.path)
        ? visible.length
        : TREE_CHILD_LIMIT;
      const childrenWrap = el("div", "tree-children");

      visible.slice(0, limit).forEach(function (child) {
        renderTreeNode(child.node, child, childrenWrap, query, revealAll || keyMatches);
      });

      if (visible.length > limit) {
        const moreWrap = el("div", "tree-more-wrap");
        const moreBtn = el(
          "button",
          "tree-more",
          "显示余下 " + formatNumber(visible.length - limit) + " 项"
        );
        moreBtn.type = "button";
        moreBtn.addEventListener("click", function () {
          state.fullPaths.add(descriptor.path);
          renderTree({ preserveScroll: true });
        });
        moreWrap.appendChild(moreBtn);
        childrenWrap.appendChild(moreWrap);
      }

      parent.appendChild(childrenWrap);
    }

    return true;
  }

  function canOpenTreeNode(node, descriptor, query, keyMatches, hasMatch) {
    if (!isContainer(node) || containerSize(node) === 0) return false;
    if (!query) return state.expanded.has(descriptor.path);
    return keyMatches || hasMatch;
  }

  function createTreeRow(node, descriptor, query) {
    const container = isContainer(node);
    const size = container ? containerSize(node) : 0;
    const canOpen = container && size > 0;
    const open = canOpen && (query || state.expanded.has(descriptor.path));
    const row = el(
      "div",
      "tree-row" + (descriptor.isRoot ? " tree-row-root" : "")
    );
    row.setAttribute("role", "treeitem");
    row.dataset.path = descriptor.path;

    if (canOpen) {
      row.setAttribute("aria-expanded", open ? "true" : "false");
    }

    if (canOpen) {
      if (query) {
        const staticToggle = el("span", "tree-toggle");
        staticToggle.appendChild(createIcon("i-chevron-down"));
        staticToggle.setAttribute("aria-hidden", "true");
        row.appendChild(staticToggle);
      } else {
        const toggle = el("button", "tree-toggle");
        toggle.type = "button";
        toggle.dataset.togglePath = descriptor.path;
        toggle.setAttribute(
          "aria-label",
          (open ? "折叠 " : "展开 ") +
            describeNode(descriptor, node)
        );
        toggle.title = open ? "折叠" : "展开";
        toggle.appendChild(
          createIcon(open ? "i-chevron-down" : "i-chevron-right")
        );
        toggle.addEventListener("click", function (event) {
          event.stopPropagation();
          toggleTreePath(descriptor.path);
        });
        row.appendChild(toggle);
      }
    } else {
      row.appendChild(el("span", "tree-spacer"));
    }

    if (descriptor.isRoot) {
      row.appendChild(el("span", "tree-key tree-key-root", "$"));
      row.appendChild(document.createTextNode(" "));
      row.appendChild(
        el(
          "span",
          "tree-type",
          node.type === "object" ? "object" : node.type === "array" ? "array" : ""
        )
      );
      if (container) {
        row.appendChild(document.createTextNode(" "));
      }
    } else if (descriptor.isIndex) {
      row.appendChild(el("span", "tree-index", String(descriptor.key)));
      row.appendChild(el("span", "tree-colon", ":"));
    } else {
      const key = el("span", "tree-key");
      appendHighlightedText(key, descriptor.key, query);
      row.appendChild(key);
      row.appendChild(el("span", "tree-colon", ":"));
    }

    if (container) {
      if (size === 0) {
        row.appendChild(
          el("span", "tree-bracket", node.type === "object" ? "{}" : "[]")
        );
        row.appendChild(el("span", "tree-type", " 空"));
      } else {
        row.appendChild(
          el("span", "tree-bracket", node.type === "object" ? "{" : "[")
        );
        row.appendChild(el("span", "tree-count", formatNumber(size)));
        row.appendChild(
          el("span", "tree-bracket", node.type === "object" ? "}" : "]")
        );
      }
    } else {
      const value = el(
        "span",
        "tree-value tree-value-" + node.type
      );
      const text = primitiveText(node);
      appendHighlightedText(value, text, query);
      if (text.length <= 2000) value.title = text;
      row.appendChild(value);
    }

    const copyPath = el("button", "tree-copy");
    copyPath.type = "button";
    copyPath.title = "复制路径 " + descriptor.path;
    copyPath.setAttribute("aria-label", "复制路径 " + descriptor.path);
    copyPath.appendChild(createIcon("i-copy"));
    copyPath.addEventListener("click", async function (event) {
      event.stopPropagation();
      const copied = await copyText(descriptor.path);
      showToast(copied ? "已复制路径 " + descriptor.path : "复制失败", {
        tone: copied ? "success" : "danger",
      });
    });
    row.appendChild(copyPath);

    return row;
  }

  function describeNode(descriptor, node) {
    if (descriptor.isRoot) {
      return node.type === "object" ? "根对象" : "根数组";
    }
    return String(descriptor.key).slice(0, 40);
  }

  function toggleTreePath(path) {
    if (state.expanded.has(path)) state.expanded.delete(path);
    else state.expanded.add(path);

    renderTree({ preserveScroll: true });

    window.requestAnimationFrame(function () {
      const buttons = dom.treeRoot.querySelectorAll("[data-toggle-path]");
      for (let i = 0; i < buttons.length; i++) {
        if (buttons[i].dataset.togglePath === path) {
          buttons[i].focus({ preventScroll: true });
          break;
        }
      }
    });
  }

  function expandAllTree() {
    if (!state.ast) return;

    const capped =
      state.stats && state.stats.nodes > 2000;
    const maxDepth = capped ? 1 : Infinity;
    const next = new Set();

    (function walk(node, path, depth) {
      if (!isContainer(node) || containerSize(node) === 0) return;

      if (depth <= maxDepth) next.add(path);

      if (depth < maxDepth) {
        childDescriptors(node, path).forEach(function (child) {
          walk(child.node, child.path, depth + 1);
        });
      }
    })(state.ast, "$", 0);

    state.expanded = next;
    state.fullPaths = new Set();
    renderTree({ preserveScroll: true });

    if (capped) {
      showToast("节点较多，已展开前两层", { tone: "warning" });
    }
  }

  function collapseAllTree() {
    state.expanded = new Set();
    state.fullPaths = new Set();
    renderTree({ preserveScroll: true });
  }

  /* ============================================================
     Clipboard, download, toasts
     ============================================================ */

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (error) {
        /* Fall through to the older method. */
      }
    }

    const activeElement = document.activeElement;
    let helper = null;

    try {
      helper = document.createElement("textarea");
      helper.value = text;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.top = "0";
      helper.style.left = "-9999px";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.focus();
      helper.select();
      return document.execCommand("copy");
    } catch (error) {
      return false;
    } finally {
      if (helper && helper.parentNode) helper.remove();
      if (
        activeElement &&
        activeElement.focus &&
        document.contains(activeElement)
      ) {
        activeElement.focus({ preventScroll: true });
      }
    }
  }

  async function copyResult() {
    if (!state.resultText) return;
    const copied = await copyText(state.resultText);
    if (!copied) {
      showToast("复制失败，请手动选择结果文本", { tone: "danger" });
      return;
    }
    showToast(
      state.stale ? "已复制当前结果（输入已修改）" : "已复制结果",
      { tone: "success" }
    );
  }

  function timestamp() {
    const now = new Date();
    const pad = function (value) {
      return String(value).padStart(2, "0");
    };
    return (
      now.getFullYear() +
      pad(now.getMonth() + 1) +
      pad(now.getDate()) +
      "-" +
      pad(now.getHours()) +
      pad(now.getMinutes())
    );
  }

  function buildDownloadName() {
    const suffix = state.mode === "minified" ? ".min" : ".formatted";
    if (state.fileName) {
      const base = state.fileName
        .replace(/\.[^.]+$/, "")
        .replace(/[\\/:*?"<>|]+/g, "-");
      return base + suffix + ".json";
    }
    return "json-code-" + timestamp() + suffix + ".json";
  }

  function downloadResult() {
    if (!state.resultText) return;

    const blob = new Blob([state.resultText], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = buildDownloadName();
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);

    showToast("已下载 " + link.download, { tone: "success" });
  }

  function showToast(message, options) {
    const opts = options || {};
    const toast = el(
      "div",
      "toast" + (opts.tone === "danger" ? " is-danger" : "")
    );
    const iconId =
      opts.tone === "danger"
        ? "i-x-circle"
        : opts.tone === "warning"
        ? "i-alert"
        : "i-check";

    toast.appendChild(createIcon(iconId));
    toast.appendChild(el("span", "toast-message", message));

    function remove() {
      if (toast.dataset.leaving === "1") return;
      toast.dataset.leaving = "1";
      toast.classList.add("is-leaving");
      window.setTimeout(function () {
        toast.remove();
      }, 180);
    }

    if (opts.actionLabel && typeof opts.onAction === "function") {
      const action = el("button", "toast-action", opts.actionLabel);
      action.type = "button";
      action.addEventListener("click", function () {
        remove();
        opts.onAction();
      });
      toast.appendChild(action);
    }

    dom.toastRegion.appendChild(toast);

    while (dom.toastRegion.children.length > 3) {
      dom.toastRegion.firstElementChild.remove();
    }

    const duration =
      typeof opts.duration === "number"
        ? opts.duration
        : opts.actionLabel
        ? 6000
        : 2800;

    window.setTimeout(remove, duration);
  }

  /* ============================================================
     Snapshots / undo
     ============================================================ */

  function captureSnapshot() {
    return {
      text: dom.input.value,
      scrollTop: dom.input.scrollTop,
      fileName: state.fileName,
      mode: state.mode,
      view: state.view,
      activeTab: state.activeTab,
      ast: state.ast,
      stats: state.stats,
      warnings: state.warnings.slice(),
      error: state.error,
      resultText: state.resultText,
      resultHTML: state.resultHTML,
      resultLines: state.resultLines,
      resultBytes: state.resultBytes,
      lastFormattedText: state.lastFormattedText,
      stale: state.stale,
      expanded: new Set(state.expanded),
      fullPaths: new Set(state.fullPaths),
      treeSearch: state.treeSearch,
      live: {
        status: state.live.status,
        stats: state.live.stats,
        warnings: state.live.warnings.slice(),
        error: state.live.error,
      },
    };
  }

  function restoreSnapshot(snapshot) {
    if (!snapshot) return;

    cancelValidation();
    cancelAutoFormat();
    cancelTreeSearchTimer();

    dom.input.value = snapshot.text;
    state.fileName = snapshot.fileName;
    state.mode = snapshot.mode;
    state.view = snapshot.view;
    state.activeTab = snapshot.activeTab;
    state.ast = snapshot.ast;
    state.stats = snapshot.stats;
    state.warnings = snapshot.warnings.slice();
    state.error = snapshot.error;
    state.resultText = snapshot.resultText;
    state.resultHTML = snapshot.resultHTML;
    state.resultLines = snapshot.resultLines;
    state.resultBytes = snapshot.resultBytes;
    state.lastFormattedText = snapshot.lastFormattedText;
    state.stale = snapshot.stale;
    state.expanded = new Set(snapshot.expanded);
    state.fullPaths = new Set(snapshot.fullPaths);
    state.treeSearch = snapshot.treeSearch;
    state.live = {
      status: snapshot.live.status,
      stats: snapshot.live.stats,
      warnings: snapshot.live.warnings.slice(),
      error: snapshot.live.error,
    };
    if (state.live.status === "checking") {
      scheduleValidation(0);
    }
    dom.treeSearch.value = snapshot.treeSearch;

    lastGutterLineCount = -1;
    updateEditorMetrics();
    dom.input.scrollTop = snapshot.scrollTop || 0;
    syncInputGutter();

    if (state.view === "result") {
      renderOutput({ preserveScroll: true, animate: false });
    } else if (state.view === "error") {
      clearOutputDom();
      renderError(state.error);
    } else {
      clearOutputDom();
    }

    if (state.activeTab === "tree" && state.view === "result") {
      renderTree({ preserveScroll: true });
    }

    updateStatus();
    updateChrome();
  }

  function undoToast(snapshot, message) {
    showToast(message, {
      tone: "success",
      actionLabel: "撤销",
      duration: 6000,
      onAction: function () {
        restoreSnapshot(snapshot);
        showToast("已撤销", { tone: "success" });
      },
    });
  }

  /* ============================================================
     Load / clear / files
     ============================================================ */

  function clearAll() {
    if (!dom.input.value) {
      dom.input.focus();
      return;
    }

    const snapshot = captureSnapshot();

    cancelValidation();
    cancelAutoFormat();
    dom.input.value = "";
    state.fileName = null;
    state.view = "empty";
    state.activeTab = "result";
    state.error = null;
    state.live = {
      status: "empty",
      stats: null,
      warnings: [],
      error: null,
    };
    clearOutputData();
    lastGutterLineCount = -1;
    updateEditorMetrics();
    updateStatus();
    updateChrome();
    dom.input.focus();

    undoToast(snapshot, "已清空");
  }

  function loadSample(options) {
    const opts = options || {};
    const hasExisting = dom.input.value.length > 0;
    const snapshot = hasExisting ? captureSnapshot() : null;

    cancelValidation();
    cancelAutoFormat();
    dom.input.value = SAMPLE_JSON;
    state.fileName = null;
    state.view = "empty";
    state.activeTab = "result";
    lastGutterLineCount = -1;
    updateEditorMetrics();
    dom.input.scrollTop = 0;
    syncInputGutter();

    processJson("formatted", { quiet: true });

    if (!opts.silent) {
      if (snapshot) {
        undoToast(snapshot, "已载入示例");
      } else {
        showToast("已载入示例", { tone: "success" });
      }
    }
  }

  function isReadableFile(file) {
    if (!file) return false;
    const name = (file.name || "").toLowerCase();
    if (/\.(json|txt|geojson|har)$/.test(name)) return true;
    if (/json|text/.test(file.type || "")) return true;
    return false;
  }

  function readFileText(file) {
    if (file.text) return file.text();
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(reader.error);
      };
      reader.readAsText(file);
    });
  }

  async function handleFile(file) {
    if (!file) return;

    cancelAutoFormat();

    if (!isReadableFile(file)) {
      showToast("请打开 .json 或文本文件", { tone: "warning" });
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      showToast("文件超过 40 MB，浏览器处理起来可能很卡", {
        tone: "danger",
      });
      return;
    }

    const snapshot = dom.input.value ? captureSnapshot() : null;
    let text;
    try {
      text = await readFileText(file);
    } catch (error) {
      showToast("读取文件失败", { tone: "danger" });
      return;
    }

    cancelValidation();
    dom.input.value = text;
    state.fileName = file.name;
    state.view = "empty";
    state.activeTab = "result";
    state.error = null;
    lastGutterLineCount = -1;
    updateEditorMetrics();
    dom.input.scrollTop = 0;
    syncInputGutter();
    clearOutputData();
    state.view = "empty";
    state.live = {
      status: "empty",
      stats: null,
      warnings: [],
      error: null,
    };
    updateStatus();
    updateChrome();

    if (!text.trim()) {
      if (snapshot) {
        undoToast(snapshot, "文件是空的");
      } else {
        showToast("文件是空的", { tone: "warning" });
      }
      return;
    }

    if (text.length <= AUTO_FORMAT_LIMIT) {
      const ok = processJson("formatted", { quiet: true });
      const toastOptions = {
        tone: ok ? "success" : "danger",
        duration: 6000,
      };

      if (snapshot) {
        toastOptions.actionLabel = "撤销";
        toastOptions.onAction = function () {
          restoreSnapshot(snapshot);
          showToast("已撤销", { tone: "success" });
        };
      }

      showToast(
        ok
          ? "已载入并格式化 " + file.name
          : "已载入 " + file.name + "，但 JSON 有语法错误",
        toastOptions
      );
    } else {
      scheduleValidation(0);
      if (snapshot) {
        undoToast(snapshot, "已载入 " + file.name + "，内容较大，请手动格式化");
      } else {
        showToast("已载入 " + file.name + "，内容较大，请手动格式化", {
          tone: "warning",
        });
      }
    }
  }

  /* ============================================================
     Event handlers
     ============================================================ */

  function handleGlobalKeydown(event) {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (mod && !event.shiftKey && event.key === "Enter") {
      event.preventDefault();
      processJson("formatted");
      return;
    }

    if (mod && event.shiftKey && key === "m") {
      event.preventDefault();
      processJson("minified");
      return;
    }

    if (mod && !event.shiftKey && key === "o") {
      event.preventDefault();
      dom.fileInput.click();
      return;
    }

    if (mod && !event.shiftKey && key === "s") {
      if (state.resultText) {
        event.preventDefault();
        downloadResult();
      }
      return;
    }

    if (event.key === "Escape") {
      if (!dom.dropOverlay.hidden) {
        state.dragDepth = 0;
        dom.dropOverlay.hidden = true;
      }
    }
  }

  function handleEditorKeydown(event) {
    if (event.key === "Tab" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();

      const start = dom.input.selectionStart;
      const end = dom.input.selectionEnd;
      const tab = "  ";

      if (start === end) {
        try {
          const inserted = document.execCommand(
            "insertText",
            false,
            tab
          );
          if (!inserted) throw new Error("insertText unavailable");
        } catch (error) {
          dom.input.setRangeText(tab, start, end, "end");
          handleInput();
        }
      } else {
        const selected = dom.input.value.slice(start, end);
        const indented = selected
          .split("\n")
          .map(function (line) {
            return tab + line;
          })
          .join("\n");
        try {
          dom.input.setSelectionRange(start, end);
          document.execCommand("insertText", false, indented);
        } catch (error) {
          dom.input.setRangeText(indented, start, end, "select");
          handleInput();
        }
      }
    }
  }

  function handleTabsKeydown(event) {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }

    event.preventDefault();
    const tabs = [dom.resultTab, dom.treeTab].filter(function (tab) {
      return !tab.disabled;
    });
    if (!tabs.length) return;

    const currentIndex = tabs.indexOf(document.activeElement);
    let nextIndex = 0;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }

    const next = tabs[nextIndex];
    selectTab(next === dom.treeTab ? "tree" : "result", {
      focus: true,
    });
  }

  function handleSearchInput() {
    if (state.treeTimer) {
      clearTimeout(state.treeTimer);
      state.treeTimer = null;
    }

    const value = dom.treeSearch.value;
    state.treeTimer = setTimeout(function () {
      state.treeTimer = null;
      if (dom.treeSearch.value !== value) return;
      state.treeSearch = value;
      renderTree({ preserveScroll: false });
    }, 140);
  }

  function flushSearch() {
    if (state.treeTimer) {
      clearTimeout(state.treeTimer);
      state.treeTimer = null;
    }
    state.treeSearch = dom.treeSearch.value;
    renderTree({ preserveScroll: false });
  }

  function startResize(event) {
    if (window.innerWidth <= 960) return;
    event.preventDefault();
    state.dragState = {
      pointerId: event.pointerId,
      rect: dom.workspace.getBoundingClientRect(),
    };
    document.body.classList.add("is-resizing");
    dom.resizer.classList.add("is-dragging");
    try {
      dom.resizer.setPointerCapture(event.pointerId);
    } catch (error) {
      /* pointer capture is best effort */
    }
  }

  function moveResize(event) {
    if (!state.dragState) return;
    event.preventDefault();

    const rect = state.dragState.rect;
    const styles = window.getComputedStyle(dom.workspace);
    const padLeft = parseFloat(styles.paddingLeft) || 0;
    const padRight = parseFloat(styles.paddingRight) || 0;
    const usable = rect.width - padLeft - padRight;
    const x = event.clientX - rect.left - padLeft - 6;
    const ratio = (x / (usable - 12)) * 100;
    applySplit(ratio, false);
  }

  function endResize() {
    if (!state.dragState) return;
    state.dragState = null;
    document.body.classList.remove("is-resizing");
    dom.resizer.classList.remove("is-dragging");
    storageSet(STORAGE_KEYS.split, String(state.split));
  }

  function handleResizeKeydown(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    applySplit(
      state.split + (event.key === "ArrowRight" ? 2 : -2),
      true
    );
  }

  function hasFiles(event) {
    if (!event.dataTransfer) return false;
    const types = event.dataTransfer.types;
    if (!types) return false;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === "Files") return true;
    }
    return false;
  }

  function handleDragEnter(event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    state.dragDepth++;
    dom.dropOverlay.hidden = false;
  }

  function handleDragOver(event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    if (dom.dropOverlay.hidden) dom.dropOverlay.hidden = false;
  }

  function handleDragLeave(event) {
    if (!hasFiles(event) && state.dragDepth === 0) return;
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (state.dragDepth === 0) dom.dropOverlay.hidden = true;
  }

  function handleDrop(event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    state.dragDepth = 0;
    dom.dropOverlay.hidden = true;

    const files = event.dataTransfer && event.dataTransfer.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  }

  function updateFileFromInput() {
    const file = dom.fileInput.files && dom.fileInput.files[0];
    if (file) handleFile(file);
    dom.fileInput.value = "";
  }

  /* ============================================================
     Binding and init
     ============================================================ */

  function bindEvents() {
    dom.formatBtn.addEventListener("click", function () {
      processJson("formatted");
    });
    dom.minifyBtn.addEventListener("click", function () {
      processJson("minified");
    });
    dom.validateBtn.addEventListener("click", validateOnly);
    dom.themeBtn.addEventListener("click", toggleTheme);

    dom.openBtn.addEventListener("click", function () {
      dom.fileInput.click();
    });
    dom.fileInput.addEventListener("change", updateFileFromInput);

    dom.sampleBtn.addEventListener("click", function () {
      loadSample();
    });
    dom.emptySampleBtn.addEventListener("click", function () {
      loadSample();
    });
    dom.clearBtn.addEventListener("click", clearAll);

    dom.copyBtn.addEventListener("click", copyResult);
    dom.downloadBtn.addEventListener("click", downloadResult);

    dom.resultTab.addEventListener("click", function () {
      selectTab("result");
    });
    dom.treeTab.addEventListener("click", function () {
      selectTab("tree");
    });
    dom.resultTab.addEventListener("keydown", handleTabsKeydown);
    dom.treeTab.addEventListener("keydown", handleTabsKeydown);

    dom.treeSearch.addEventListener("input", handleSearchInput);
    dom.treeSearch.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        flushSearch();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelTreeSearchTimer();
        dom.treeSearch.value = "";
        state.treeSearch = "";
        renderTree({ preserveScroll: false });
        dom.treeSearch.blur();
      }
    });

    dom.expandAllBtn.addEventListener("click", expandAllTree);
    dom.collapseAllBtn.addEventListener("click", collapseAllTree);

    dom.indentSelect.addEventListener("change", function () {
      state.indent = dom.indentSelect.value;
      storageSet(STORAGE_KEYS.indent, state.indent);

      if (state.view === "result" && state.ast) {
        if (state.stale) {
          scheduleAutoFormat();
        } else if (state.mode !== "minified") {
          rebuildOutput();
        }
      }
    });

    dom.sortBtn.addEventListener("click", function () {
      state.sortKeys = !state.sortKeys;
      storageSet(STORAGE_KEYS.sort, state.sortKeys ? "1" : "0");
      updateSortButton();

      if (state.view === "result" && state.ast) {
        if (state.stale) {
          scheduleAutoFormat();
        } else {
          rebuildOutput();
        }
      }
    });

    dom.input.addEventListener("input", handleInput);
    dom.input.addEventListener("keydown", handleEditorKeydown);
    dom.input.addEventListener("scroll", syncInputGutter);
    dom.input.addEventListener("keyup", updateCaretPosition);
    dom.input.addEventListener("click", updateCaretPosition);
    dom.input.addEventListener("select", updateCaretPosition);

    dom.statusPill.addEventListener("click", function () {
      if (state.live.status === "invalid" && state.live.error) {
        focusInputAt(state.live.error.index);
      } else {
        dom.input.focus();
      }
    });

    dom.resizer.addEventListener("pointerdown", startResize);
    dom.resizer.addEventListener("pointermove", moveResize);
    dom.resizer.addEventListener("pointerup", endResize);
    dom.resizer.addEventListener("pointercancel", endResize);
    dom.resizer.addEventListener("keydown", handleResizeKeydown);
    dom.resizer.addEventListener("dblclick", function () {
      applySplit(50, true);
    });

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);

    document.addEventListener("keydown", handleGlobalKeydown);

    if (window.matchMedia) {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const listener = function (event) {
        if (!storageGet(STORAGE_KEYS.theme)) {
          applyTheme(event.matches ? "dark" : "light", false);
        }
      };
      if (media.addEventListener) media.addEventListener("change", listener);
      else if (media.addListener) media.addListener(listener);
    }
  }

  function init() {
    loadPreferences();
    updateShortcutLabels();
    dom.treeRoot.setAttribute("role", "tree");
    bindEvents();

    lastGutterLineCount = -1;
    updateEditorMetrics();
    updateStatus();
    updateChrome();
    dom.inputGutter.scrollTop = 0;

    const params = new URLSearchParams(window.location.search);
    const showDemo =
      params.has("demo") || window.location.hash === "#demo";

    if (showDemo) {
      loadSample({ silent: true });
    } else if (
      window.matchMedia &&
      window.matchMedia("(pointer: fine)").matches
    ) {
      dom.input.focus();
    }
  }

  init();
})();
