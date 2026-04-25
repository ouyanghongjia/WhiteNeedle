/**
 * events — 轻量级 EventEmitter
 *
 * WhiteNeedle 内置模块，提供与 Node.js events 兼容的基础事件发射器。
 *
 * 用法:
 *   var events = require('events');
 *   var emitter = new events.EventEmitter();
 *   emitter.on('data', function(msg) { console.log(msg); });
 *   emitter.emit('data', 'hello');
 */
function EventEmitter() {
    this._events = {};
}

EventEmitter.prototype.on = function(event, fn) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(fn);
    return this;
};

EventEmitter.prototype.once = function(event, fn) {
    var self = this;
    function wrapper() {
        self.off(event, wrapper);
        fn.apply(this, arguments);
    }
    wrapper._original = fn;
    return this.on(event, wrapper);
};

EventEmitter.prototype.emit = function(event) {
    var args = Array.prototype.slice.call(arguments, 1);
    var fns = this._events[event] || [];
    for (var i = 0; i < fns.length; i++) {
        fns[i].apply(this, args);
    }
    return fns.length > 0;
};

EventEmitter.prototype.off = function(event, fn) {
    if (!fn) {
        delete this._events[event];
        return this;
    }
    var fns = this._events[event] || [];
    this._events[event] = fns.filter(function(f) {
        return f !== fn && f._original !== fn;
    });
    return this;
};

EventEmitter.prototype.removeAllListeners = function(event) {
    if (event) {
        delete this._events[event];
    } else {
        this._events = {};
    }
    return this;
};

EventEmitter.prototype.listeners = function(event) {
    return (this._events[event] || []).slice();
};

EventEmitter.prototype.listenerCount = function(event) {
    return (this._events[event] || []).length;
};

module.exports = { EventEmitter: EventEmitter };
