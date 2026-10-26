/* ============================================================
   JSON Code — parsing, serialization and highlighting core
   No DOM dependencies. Runs in the browser and in Node.
   ============================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.JSONCodeCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
  const MAX_DEPTH = 500;
  const MAX_LINE_NUMBER = 50000;

  function isDigit(ch) {
    return ch >= "0" && ch <= "9";
  }

  function isWhitespace(ch) {
    return ch === " " || ch === "\n" || ch === "\r" || ch === "\t";
  }

  function joinPath(base, key) {
    if (IDENTIFIER_RE.test(key)) {
      return base + "." + key;
    }
    return base + "[" + JSON.stringify(key) + "]";
  }

  function sortedEntries(entries) {
    return entries.slice().sort(function (a, b) {
      if (a.key < b.key) return -1;
      if (a.key > b.key) return 1;
      return 0;
    });
  }

  function normalizeOptions(options) {
    const opts = options || {};
    return {
      minify: !!opts.minify,
      sortKeys: !!opts.sortKeys,
      indentUnit:
        typeof opts.indentUnit === "string" ? opts.indentUnit : "  ",
    };
  }

  /**
   * Parse strict JSON into an AST.
   *
   * Numbers are kept as their raw source text so integers larger than
   * Number.MAX_SAFE_INTEGER survive formatting untouched.
   *
   * @param {string} source
   * @returns {{ast: object, warnings: Array, stats: object}}
   */
  function parseJson(source) {
    if (typeof source !== "string") {
      throw {
        name: "JSONParseError",
        message: "输入内容必须是文本",
        index: 0,
        hint: "",
      };
    }

    const length = source.length;
    let index = source.charCodeAt(0) === 0xfeff ? 1 : 0;

    const warnings = [];
    const stats = {
      nodes: 0,
      objects: 0,
      arrays: 0,
      keys: 0,
      strings: 0,
      numbers: 0,
      booleans: 0,
      nulls: 0,
      duplicates: 0,
      depth: 0,
    };

    function fail(message, at, hint) {
      const position =
        typeof at === "number" ? at : index;
      throw {
        name: "JSONParseError",
        message: message,
        index: Math.max(0, Math.min(position, length)),
        hint: hint || "",
      };
    }

    function skipWhitespace() {
      while (index < length && isWhitespace(source[index])) {
        index++;
      }
    }

    function parseValue(depth, path) {
      if (depth > stats.depth) stats.depth = depth;
      if (depth > MAX_DEPTH) {
        fail(
          "嵌套层级过深",
          index,
          "JSON Code 最多支持 " + MAX_DEPTH + " 层嵌套。"
        );
      }

      skipWhitespace();

      if (index >= length) {
        fail(
          "这里还缺少一个值",
          index,
          "输入在此处结束，请补全 JSON 或删除末尾多余的逗号。"
        );
      }

      const ch = source[index];
      stats.nodes++;

      if (ch === "{") {
        stats.objects++;
        return parseObject(depth, path);
      }

      if (ch === "[") {
        stats.arrays++;
        return parseArray(depth, path);
      }

      if (ch === '"') {
        stats.strings++;
        return parseString();
      }

      if (ch === "-" || isDigit(ch)) {
        stats.numbers++;
        return parseNumber();
      }

      if (ch === "t") {
        stats.booleans++;
        return parseLiteral("true", "boolean", true);
      }

      if (ch === "f") {
        stats.booleans++;
        return parseLiteral("false", "boolean", false);
      }

      if (ch === "n") {
        stats.nulls++;
        return parseLiteral("null", "null", null);
      }

      if (ch === "/") {
        fail(
          "JSON 不支持注释",
          index,
          "请删除 // 或 /* */ 注释，标准 JSON 不允许注释。"
        );
      }

      if (ch === "'") {
        fail(
          "字符串必须使用双引号",
          index,
          "把单引号 ' 改成双引号 \"。"
        );
      }

      if (ch === "+") {
        fail(
          "数字不能以 + 开头",
          index,
          "正数直接写数字即可，例如 42。"
        );
      }

      if (ch === ".") {
        fail(
          "数字需要整数部分",
          index,
          "例如 .5 应写成 0.5。"
        );
      }

      if (ch === "N" || ch === "I") {
        fail(
          "JSON 不支持 " + (ch === "N" ? "NaN" : "Infinity"),
          index,
          "请改用 null，或使用一个普通数字。"
        );
      }

      if (ch === "}" || ch === "]") {
        fail(
          "这里还缺少一个值",
          index,
          "删除多余的 " + ch + "，或补上对应的值。"
        );
      }

      const preview = ch === "\n" ? "换行" : "“" + ch + "”";
      fail(
        "这里应该是一个 JSON 值",
        index,
        "遇到了" + preview + "。支持对象、数组、双引号字符串、数字、true、false 和 null。"
      );
    }

    function parseString() {
      const start = index;
      index++; // opening quote
      let value = "";

      while (index < length) {
        const ch = source[index];

        if (ch === '"') {
          index++;
          return {
            type: "string",
            value: value,
            raw: source.slice(start, index),
            start: start,
            end: index,
          };
        }

        if (ch === "\\") {
          const escapeStart = index;
          index++;

          if (index >= length) {
            fail("字符串没有闭合", start, "补上结尾的双引号。");
          }

          const escaped = source[index];

          if (escaped === '"') {
            value += '"';
            index++;
          } else if (escaped === "\\") {
            value += "\\";
            index++;
          } else if (escaped === "/") {
            value += "/";
            index++;
          } else if (escaped === "b") {
            value += "\b";
            index++;
          } else if (escaped === "f") {
            value += "\f";
            index++;
          } else if (escaped === "n") {
            value += "\n";
            index++;
          } else if (escaped === "r") {
            value += "\r";
            index++;
          } else if (escaped === "t") {
            value += "\t";
            index++;
          } else if (escaped === "u") {
            const hex = source.slice(index + 1, index + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              fail(
                "\\u 后面需要 4 位十六进制数字",
                escapeStart,
                "例如 \\u4E2D 表示汉字“中”。"
              );
            }
            value += String.fromCharCode(parseInt(hex, 16));
            index += 5;
          } else {
            fail(
              "无效的转义序列 \\" + escaped,
              escapeStart,
              "JSON 支持的转义有 \\\" \\\\ \\/ \\b \\f \\n \\r \\t 和 \\uXXXX。"
            );
          }
          continue;
        }

        const code = ch.charCodeAt(0);
        if (code < 0x20) {
          fail(
            code === 10 || code === 13
              ? "字符串中不能直接换行"
              : "字符串中不能包含未转义的控制字符",
            index,
            "换行、制表符等控制字符需要写成 \\n、\\t 等转义形式。"
          );
        }

        value += ch;
        index++;
      }

      fail("字符串没有闭合", start, "补上结尾的双引号。");
      return null;
    }

    function parseNumber() {
      const start = index;

      if (source[index] === "-") {
        index++;
        if (index >= length) {
          fail("负号后面缺少数字", index, "例如 -12。");
        }
      }

      if (source[index] === "0") {
        index++;
        if (isDigit(source[index])) {
          fail(
            "数字不能以 0 开头",
            index,
            "例如 01 应写成 1，-01 应写成 -1。"
          );
        }
      } else if (source[index] >= "1" && source[index] <= "9") {
        index++;
        while (isDigit(source[index])) index++;
      } else {
        fail(
          "这里应该是一个数字",
          index,
          "有效数字示例：0、-12、3.14、6.02e23。"
        );
      }

      if (source[index] === ".") {
        index++;
        if (!isDigit(source[index])) {
          fail(
            "小数点后面需要数字",
            index,
            "例如 3.14，而不是 3.。"
          );
        }
        while (isDigit(source[index])) index++;
      }

      if (source[index] === "e" || source[index] === "E") {
        index++;
        if (source[index] === "+" || source[index] === "-") index++;
        if (!isDigit(source[index])) {
          fail(
            "指数部分需要数字",
            index,
            "例如 1e10 或 2.5E-3。"
          );
        }
        while (isDigit(source[index])) index++;
      }

      if (
        index < length &&
        /[0-9A-Za-z_.]/.test(source[index])
      ) {
        fail(
          "数字格式不正确",
          index,
          "检查是否有多余的小数点、字母或数字分隔符。"
        );
      }

      return {
        type: "number",
        raw: source.slice(start, index),
        start: start,
        end: index,
      };
    }

    function parseLiteral(word, type, value) {
      for (let offset = 0; offset < word.length; offset++) {
        if (
          index + offset >= length ||
          source[index + offset] !== word[offset]
        ) {
          fail(
            "无法识别字面量 “" + word + "”",
            index + offset,
            "JSON 只支持 true、false 和 null，并且区分大小写。"
          );
        }
      }

      const end = index + word.length;
      if (end < length && /[A-Za-z0-9_$]/.test(source[end])) {
        fail(
          "无法识别字面量 “" + word + "”",
          end,
          "JSON 只支持 true、false 和 null，并且区分大小写。"
        );
      }

      const start = index;
      index = end;

      return {
        type: type,
        value: value,
        raw: word,
        start: start,
        end: end,
      };
    }

    function parseObject(depth, path) {
      const start = index;
      index++; // {
      const entries = [];
      const seenKeys = new Set();

      skipWhitespace();
      if (source[index] === "}") {
        index++;
        return {
          type: "object",
          entries: entries,
          start: start,
          end: index,
        };
      }

      while (true) {
        skipWhitespace();

        if (index >= length) {
          fail(
            "对象没有闭合",
            index,
            "这个 { 缺少对应的 }。"
          );
        }

        if (source[index] === "/") {
          fail(
            "JSON 不支持注释",
            index,
            "请删除 // 或 /* */ 注释，标准 JSON 不允许注释。"
          );
        }

        if (source[index] === "}") {
          fail(
            "对象格式不正确",
            index,
            "删除多余的逗号或补上一个键值对。"
          );
        }

        if (source[index] === ",") {
          fail(
            "这里不应该出现逗号",
            index,
            "对象的第一个键之前不能有逗号。"
          );
        }

        if (source[index] !== '"') {
          fail(
            "对象的键名必须是双引号字符串",
            index,
            "JSON 的键名需要写成 \"key\": value 的形式。"
          );
        }

        const keyNode = parseString();
        const key = keyNode.value;

        skipWhitespace();

        if (index >= length) {
          fail(
            "键名后面缺少冒号",
            index,
            "应该是 \"键\": 值。"
          );
        }

        if (source[index] !== ":") {
          fail(
            "键名后面缺少冒号",
            index,
            "应该是 \"键\": 值。"
          );
        }

        index++;
        stats.keys++;

        const childPath = joinPath(path, key);
        const value = parseValue(depth + 1, childPath);

        if (seenKeys.has(key)) {
          stats.duplicates++;
          warnings.push({
            key: key,
            path: childPath,
            index: keyNode.start,
          });
        } else {
          seenKeys.add(key);
        }

        entries.push({
          key: key,
          value: value,
          start: keyNode.start,
        });

        skipWhitespace();

        if (index >= length) {
          fail(
            "对象没有闭合",
            index,
            "这个 { 缺少对应的 }。"
          );
        }

        if (source[index] === "/") {
          fail(
            "JSON 不支持注释",
            index,
            "请删除 // 或 /* */ 注释，标准 JSON 不允许注释。"
          );
        }

        if (source[index] === "}") {
          index++;
          return {
            type: "object",
            entries: entries,
            start: start,
            end: index,
          };
        }

        if (source[index] === ",") {
          const commaIndex = index;
          index++;
          skipWhitespace();

          if (index >= length) {
            fail(
              "对象没有闭合",
              index,
              "这个 { 缺少对应的 }。"
            );
          }

          if (source[index] === "}") {
            fail(
              "对象末尾不能有逗号",
              commaIndex,
              "删除 } 前面的逗号。"
            );
          }

          continue;
        }

        fail(
          "两个键值对之间缺少逗号",
          index,
          "在上一个值后面补一个逗号。"
        );
      }
    }

    function parseArray(depth, path) {
      const start = index;
      index++; // [
      const items = [];

      skipWhitespace();
      if (source[index] === "]") {
        index++;
        return {
          type: "array",
          items: items,
          start: start,
          end: index,
        };
      }

      while (true) {
        skipWhitespace();

        if (index >= length) {
          fail(
            "数组没有闭合",
            index,
            "这个 [ 缺少对应的 ]。"
          );
        }

        if (source[index] === "]") {
          fail(
            "数组格式不正确",
            index,
            "删除多余的逗号或补上一个值。"
          );
        }

        if (source[index] === ",") {
          fail(
            "数组元素不能为空",
            index,
            "两个逗号之间需要有一个值。"
          );
        }

        const itemPath = path + "[" + items.length + "]";
        const value = parseValue(depth + 1, itemPath);
        items.push(value);

        skipWhitespace();

        if (index >= length) {
          fail(
            "数组没有闭合",
            index,
            "这个 [ 缺少对应的 ]。"
          );
        }

        if (source[index] === "/") {
          fail(
            "JSON 不支持注释",
            index,
            "请删除 // 或 /* */ 注释，标准 JSON 不允许注释。"
          );
        }

        if (source[index] === "]") {
          index++;
          return {
            type: "array",
            items: items,
            start: start,
            end: index,
          };
        }

        if (source[index] === ",") {
          const commaIndex = index;
          index++;
          skipWhitespace();

          if (index >= length) {
            fail(
              "数组没有闭合",
              index,
              "这个 [ 缺少对应的 ]。"
            );
          }

          if (source[index] === "]") {
            fail(
              "数组末尾不能有逗号",
              commaIndex,
              "删除 ] 前面的逗号。"
            );
          }

          continue;
        }

        fail(
          "数组元素之间缺少逗号",
          index,
          "在上一个值后面补一个逗号。"
        );
      }
    }

    skipWhitespace();

    if (index >= length) {
      fail(
        "没有可解析的内容",
        index,
        "粘贴或输入 JSON 后再试，空白内容不算有效 JSON。"
      );
    }

    const ast = parseValue(1, "$");

    skipWhitespace();

    if (index < length) {
      const ch = source[index];

      if (ch === "/") {
        fail(
          "JSON 不支持注释",
          index,
          "请删除 // 或 /* */ 注释，标准 JSON 不允许注释。"
        );
      }

      if (ch === "}" || ch === "]") {
        fail(
          "多余的结束符号 " + ch,
          index,
          "这个 " + ch + " 没有对应的开始符号。"
        );
      }

      fail(
        "JSON 值结束后还有多余内容",
        index,
        "检查是否多了一个逗号、括号或文本。"
      );
    }

    return {
      ast: ast,
      warnings: warnings,
      stats: stats,
    };
  }

  function serializeJson(ast, options) {
    const opts = normalizeOptions(options);
    const parts = [];

    function emit(node, level) {
      if (node.type === "string") {
        parts.push(JSON.stringify(node.value));
        return;
      }

      if (node.type === "number") {
        parts.push(node.raw);
        return;
      }

      if (node.type === "boolean") {
        parts.push(node.value ? "true" : "false");
        return;
      }

      if (node.type === "null") {
        parts.push("null");
        return;
      }

      if (node.type === "array") {
        if (node.items.length === 0) {
          parts.push("[]");
          return;
        }

        if (opts.minify) {
          parts.push("[");
          for (let i = 0; i < node.items.length; i++) {
            if (i > 0) parts.push(",");
            emit(node.items[i], level + 1);
          }
          parts.push("]");
          return;
        }

        parts.push("[\n");
        for (let i = 0; i < node.items.length; i++) {
          parts.push(opts.indentUnit.repeat(level + 1));
          emit(node.items[i], level + 1);
          if (i < node.items.length - 1) parts.push(",");
          parts.push("\n");
        }
        parts.push(opts.indentUnit.repeat(level), "]");
        return;
      }

      if (node.type === "object") {
        const entries = opts.sortKeys
          ? sortedEntries(node.entries)
          : node.entries;

        if (entries.length === 0) {
          parts.push("{}");
          return;
        }

        if (opts.minify) {
          parts.push("{");
          for (let i = 0; i < entries.length; i++) {
            if (i > 0) parts.push(",");
            parts.push(JSON.stringify(entries[i].key), ":");
            emit(entries[i].value, level + 1);
          }
          parts.push("}");
          return;
        }

        parts.push("{\n");
        for (let i = 0; i < entries.length; i++) {
          parts.push(opts.indentUnit.repeat(level + 1));
          parts.push(JSON.stringify(entries[i].key));
          parts.push(": ");
          emit(entries[i].value, level + 1);
          if (i < entries.length - 1) parts.push(",");
          parts.push("\n");
        }
        parts.push(opts.indentUnit.repeat(level), "}");
        return;
      }

      throw new Error("Unknown JSON node type: " + node.type);
    }

    emit(ast, 0);
    return parts.join("");
  }

  function escapeHtml(value) {
    return value.replace(/[&<>]/g, function (ch) {
      if (ch === "&") return "&amp;";
      if (ch === "<") return "&lt;";
      if (ch === ">") return "&gt;";
      return ch;
    });
  }

  function highlightJson(ast, options) {
    const opts = normalizeOptions(options);
    const parts = [];

    function token(className, text) {
      parts.push(
        '<span class="' + className + '">' + escapeHtml(text) + "</span>"
      );
    }

    function punct(text) {
      token("tok-punct", text);
    }

    function emit(node, level) {
      if (node.type === "string") {
        token("tok-string", JSON.stringify(node.value));
        return;
      }

      if (node.type === "number") {
        token("tok-number", node.raw);
        return;
      }

      if (node.type === "boolean") {
        token("tok-boolean", node.value ? "true" : "false");
        return;
      }

      if (node.type === "null") {
        token("tok-null", "null");
        return;
      }

      if (node.type === "array") {
        if (node.items.length === 0) {
          punct("[]");
          return;
        }

        if (opts.minify) {
          punct("[");
          for (let i = 0; i < node.items.length; i++) {
            if (i > 0) punct(",");
            emit(node.items[i], level + 1);
          }
          punct("]");
          return;
        }

        punct("[");
        parts.push("\n");
        for (let i = 0; i < node.items.length; i++) {
          parts.push(opts.indentUnit.repeat(level + 1));
          emit(node.items[i], level + 1);
          if (i < node.items.length - 1) punct(",");
          parts.push("\n");
        }
        parts.push(opts.indentUnit.repeat(level));
        punct("]");
        return;
      }

      if (node.type === "object") {
        const entries = opts.sortKeys
          ? sortedEntries(node.entries)
          : node.entries;

        if (entries.length === 0) {
          punct("{}");
          return;
        }

        if (opts.minify) {
          punct("{");
          for (let i = 0; i < entries.length; i++) {
            if (i > 0) punct(",");
            token("tok-key", JSON.stringify(entries[i].key));
            punct(":");
            emit(entries[i].value, level + 1);
          }
          punct("}");
          return;
        }

        punct("{");
        parts.push("\n");
        for (let i = 0; i < entries.length; i++) {
          parts.push(opts.indentUnit.repeat(level + 1));
          token("tok-key", JSON.stringify(entries[i].key));
          punct(":");
          parts.push(" ");
          emit(entries[i].value, level + 1);
          if (i < entries.length - 1) punct(",");
          parts.push("\n");
        }
        parts.push(opts.indentUnit.repeat(level));
        punct("}");
        return;
      }

      throw new Error("Unknown JSON node type: " + node.type);
    }

    emit(ast, 0);
    return parts.join("");
  }

  return {
    parseJson: parseJson,
    serializeJson: serializeJson,
    highlightJson: highlightJson,
    joinPath: joinPath,
    MAX_LINE_NUMBER: MAX_LINE_NUMBER,
  };
});
