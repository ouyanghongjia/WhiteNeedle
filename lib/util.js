/**
 * util — 实用工具函数
 *
 * WhiteNeedle 内置模块，提供字符串格式化和对象检查等基础工具。
 *
 * 用法:
 *   var util = require('util');
 *   console.log(util.format('Hello %s, age %d', 'Alice', 30));
 *   console.log(util.inspect({ key: 'value' }));
 */
module.exports = {
    /**
     * 字符串格式化，支持 %s（字符串）、%d（数字）、%j（JSON）占位符。
     * 多余的参数以空格拼接在末尾。
     */
    format: function() {
        var args = Array.prototype.slice.call(arguments);
        var fmt = String(args.shift() || '');
        var index = 0;

        var result = fmt.replace(/%[sdj%]/g, function(match) {
            if (match === '%%') return '%';
            if (index >= args.length) return match;
            var val = args[index++];
            switch (match) {
                case '%s': return String(val);
                case '%d': return Number(val).toString();
                case '%j':
                    try { return JSON.stringify(val); }
                    catch (e) { return '[Circular]'; }
                default: return match;
            }
        });

        while (index < args.length) {
            var arg = args[index++];
            if (arg === null || typeof arg !== 'object') {
                result += ' ' + String(arg);
            } else {
                result += ' ' + JSON.stringify(arg);
            }
        }

        return result;
    },

    /**
     * 返回对象的 JSON 格式化字符串，带 2 空格缩进。
     */
    inspect: function(obj, opts) {
        var indent = (opts && opts.indent) || 2;
        try {
            return JSON.stringify(obj, null, indent);
        } catch (e) {
            return '[Object: ' + String(obj) + ']';
        }
    },

    /**
     * 判断值是否为数组。
     */
    isArray: function(val) {
        return Array.isArray ? Array.isArray(val) : Object.prototype.toString.call(val) === '[object Array]';
    },

    /**
     * 判断值是否为函数。
     */
    isFunction: function(val) {
        return typeof val === 'function';
    },

    /**
     * 判断值是否为字符串。
     */
    isString: function(val) {
        return typeof val === 'string';
    },

    /**
     * 判断值是否为数字。
     */
    isNumber: function(val) {
        return typeof val === 'number';
    },

    /**
     * 判断值是否为 null 或 undefined。
     */
    isNullOrUndefined: function(val) {
        return val === null || val === undefined;
    }
};
