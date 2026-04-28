/**
 * WNAuto — WhiteNeedle UI 自动化库
 *
 * 通过直接 ObjC 方法调用实现 UI 交互，绕过传统坐标点击。
 * 相比 XCUITest / Appium 等基于辅助功能或坐标的方案：
 *   - 更快：直接调用方法，无需等待渲染或动画
 *   - 更稳定：不受布局偏移、键盘弹出等影响
 *   - 更强大：可触及私有 API、非可见控件、后台逻辑
 *
 * 所有 UI 操作自动在主线程执行（dispatch.main）。
 *
 * 用法:
 *   var auto = WNAuto;
 *   var btn = auto.find.byText('Login');
 *   auto.tap(btn);
 *   auto.type(auto.find.byClass('UITextField')[0], 'hello');
 *   auto.scroll(scrollView, { y: 200 });
 */
var WNAuto = (function() {
    'use strict';

    // ─── Helpers ─────────────────────────────────────────────

    function onMain(fn) {
        if (typeof dispatch !== 'undefined' && dispatch.main) {
            return dispatch.main(fn);
        }
        return fn();
    }

    function toProxy(viewOrAddress) {
        if (!viewOrAddress) return null;
        if (typeof viewOrAddress === 'string') {
            return ObjC.instance(viewOrAddress);
        }
        if (viewOrAddress.invoke) return viewOrAddress;
        return ObjC.instance(viewOrAddress);
    }

    // On the dedicated JS thread, avoid NSThread sleep: it does not run that thread's run loop, so
    // performSelector:onThread: (used to re-enter the JS engine) would stall until sleep ends.
    function sleep(ms) {
        var s = Math.max(0, +ms) / 1000.0;
        if (typeof __wnRunLoopSleep === 'function') {
            __wnRunLoopSleep(Math.max(0, +ms));
            return;
        }
        var run = function() {
            var end = ObjC.use('NSDate').invoke('dateWithTimeIntervalSinceNow:', [s]);
            ObjC.use('NSRunLoop').invoke('currentRunLoop').invoke('runUntilDate:', [end]);
        };

        // Let JS-thread run loop pump pending performSelector tasks (e.g. async hook forwarding)
        // instead of always hopping ObjC calls to main queue.
        if (typeof dispatch !== "undefined" && dispatch.none) {
            dispatch.none(run);
            return;
        }
        run();
    }

    function runLoop(ms) {
        sleep(ms);
    }

    var _actionConfig = {
        // iOS 常见交互动画时长约 0.25s，默认给 0.3s 更稳妥
        actionDelayMs: 300,
        defaultAnimated: true
    };

    function _resolveAnimated(animated) {
        return (typeof animated === 'boolean') ? animated : !!_actionConfig.defaultAnimated;
    }

    function _afterActionDelay() {
        if (_actionConfig.actionDelayMs > 0) {
            runLoop(_actionConfig.actionDelayMs);
        }
    }

    function _withActionDelay(fn) {
        return function() {
            var result = fn.apply(null, arguments);
            _afterActionDelay();
            return result;
        };
    }

    // ─── Find: 视图查找 ─────────────────────────────────────

    var find = {
        /**
         * 按类名搜索视图（递归遍历整个视图树）
         * @param {string} className - UIKit 类名，如 'UIButton'
         * @param {object} [root] - 起始视图代理，默认 keyWindow
         * @returns {Array} 匹配的视图代理数组
         */
        byClass: function(className, root) {
            return onMain(function() {
                var results = [];
                var rootView = root ? toProxy(root) : _keyWindow();
                if (!rootView) return results;
                _walk(rootView, function(view) {
                    var cn = '';
                    try { cn = view.invoke('class').invoke('description'); } catch(e) { return; }
                    if (cn === className) results.push(view);
                });
                return results;
            });
        },

        /**
         * 按文本内容搜索（UILabel.text, UIButton.titleLabel.text,
         * UITextField.text/placeholder, UITextView.text）
         * @param {string} text - 要搜索的文本（包含匹配，大小写不敏感）
         * @param {object} [root] - 起始视图
         * @returns {Array} 匹配的视图代理数组
         */
        byText: function(text, root) {
            var lowerText = text.toLowerCase();
            return onMain(function() {
                var results = [];
                var rootView = root ? toProxy(root) : _keyWindow();
                if (!rootView) return results;
                _walk(rootView, function(view) {
                    var viewText = _extractText(view);
                    if (viewText && viewText.toLowerCase().indexOf(lowerText) >= 0) {
                        results.push(view);
                    }
                });
                return results;
            });
        },

        /**
         * 按 accessibilityIdentifier 搜索
         * @param {string} identifier
         * @param {object} [root]
         * @returns {Array}
         */
        byId: function(identifier, root) {
            return onMain(function() {
                var results = [];
                var rootView = root ? toProxy(root) : _keyWindow();
                if (!rootView) return results;
                _walk(rootView, function(view) {
                    try {
                        var aid = view.invoke('accessibilityIdentifier');
                        if (aid && String(aid) === identifier) results.push(view);
                    } catch(e) { /* ignore */ }
                });
                return results;
            });
        },

        /**
         * 按 accessibilityLabel 搜索
         * @param {string} label
         * @param {object} [root]
         * @returns {Array}
         */
        byLabel: function(label, root) {
            var lowerLabel = label.toLowerCase();
            return onMain(function() {
                var results = [];
                var rootView = root ? toProxy(root) : _keyWindow();
                if (!rootView) return results;
                _walk(rootView, function(view) {
                    try {
                        var al = view.invoke('accessibilityLabel');
                        if (al && String(al).toLowerCase().indexOf(lowerLabel) >= 0) {
                            results.push(view);
                        }
                    } catch(e) { /* ignore */ }
                });
                return results;
            });
        },

        /**
         * 按 tag 搜索
         * @param {number} tag
         * @param {object} [root]
         * @returns {Array}
         */
        byTag: function(tag, root) {
            return onMain(function() {
                var results = [];
                var rootView = root ? toProxy(root) : _keyWindow();
                if (!rootView) return results;
                _walk(rootView, function(view) {
                    try {
                        var t = view.invoke('tag');
                        if (t === tag) results.push(view);
                    } catch(e) { /* ignore */ }
                });
                return results;
            });
        },

        /**
         * 组合条件搜索
         * @param {object} criteria - { class, text, id, label, tag, visible }
         * @param {object} [root]
         * @returns {Array}
         */
        where: function(criteria, root) {
            return onMain(function() {
                var results = [];
                var rootView = root ? toProxy(root) : _keyWindow();
                if (!rootView) return results;
                _walk(rootView, function(view) {
                    if (_matchesCriteria(view, criteria)) results.push(view);
                });
                return results;
            });
        },

        /**
         * 获取当前最顶层的 ViewController
         * @returns {object} VC 代理
         */
        topViewController: function() {
            return onMain(function() {
                return _topVC();
            });
        },

        /**
         * 获取所有 ViewController 层级
         * @returns {Array} VC 信息数组
         */
        viewControllers: function() {
            if (typeof UIDebug !== 'undefined') {
                return UIDebug.viewControllers();
            }
            return [];
        },

        /**
         * 等待某个条件满足
         * @param {function} conditionFn - 返回 truthy 表示满足
         * @param {object} [opts] - { timeout: 10000, interval: 200, message: '' }
         * @returns {boolean} 是否在超时前满足
         */
        waitFor: function(conditionFn, opts) {
            opts = opts || {};
            var timeout = opts.timeout || 10000;
            var interval = opts.interval || 200;
            var start = Date.now();

            while (Date.now() - start < timeout) {
                try {
                    if (conditionFn()) return true;
                } catch(e) { /* ignore, retry */ }
                sleep(interval);
            }
            if (opts.message) {
                console.warn('[WNAuto] waitFor timeout: ' + opts.message);
            }
            return false;
        },

        /**
         * 等待指定文本出现在视图树中
         * @param {string} text
         * @param {object} [opts]
         * @returns {boolean}
         */
        waitForText: function(text, opts) {
            opts = opts || {};
            opts.message = opts.message || 'text "' + text + '" not found';
            return find.waitFor(function() {
                return find.byText(text).length > 0;
            }, opts);
        },

        /**
         * 等待指定类的视图出现
         * @param {string} className
         * @param {object} [opts]
         * @returns {boolean}
         */
        waitForClass: function(className, opts) {
            opts = opts || {};
            opts.message = opts.message || 'class "' + className + '" not found';
            return find.waitFor(function() {
                return find.byClass(className).length > 0;
            }, opts);
        }
    };

    // ─── Actions: UI 操作 ────────────────────────────────────

    /**
     * 点击 UIControl（触发 TouchUpInside 事件）
     * @param {object} viewOrAddress - 视图代理或地址字符串
     */
    function tap(viewOrAddress) {
        onMain(function() {
            var view = toProxy(viewOrAddress);
            if (!view) throw new Error('[WNAuto.tap] view is null');

            var isControl = _isKindOfClass(view, 'UIControl');
            if (isControl) {
                view.invoke('sendActionsForControlEvents:', [1 << 6]); // UIControlEventTouchUpInside = 64
            } else {
                _simulateTap(view);
            }
        });
    }

    /**
     * 双击视图
     * @param {object} viewOrAddress
     */
    function doubleTap(viewOrAddress) {
        tap(viewOrAddress);
        tap(viewOrAddress);
    }

    /**
     * 长按视图（触发 UILongPressGestureRecognizer）
     * @param {object} viewOrAddress
     * @param {number} [duration] - 持续时间（秒），默认 0.5
     */
    function longPress(viewOrAddress, duration) {
        duration = duration || 0.5;
        onMain(function() {
            var view = toProxy(viewOrAddress);
            if (!view) throw new Error('[WNAuto.longPress] view is null');

            var gestureRecognizers = view.invoke('gestureRecognizers');
            if (gestureRecognizers) {
                var count = gestureRecognizers.invoke('count');
                for (var i = 0; i < count; i++) {
                    var gr = gestureRecognizers.invoke('objectAtIndex:', [i]);
                    var cn = gr.invoke('class').invoke('description');
                    if (cn.indexOf('LongPress') >= 0) {
                        _fireGestureRecognizer(gr, 1); // UIGestureRecognizerStateBegan
                        return;
                    }
                }
            }
            _simulateTap(view);
        });
    }

    /**
     * 在文本输入框中输入文字
     * 直接设置 text 属性并触发相应通知/事件
     * @param {object} viewOrAddress - UITextField / UITextView 代理
     * @param {string} text - 要输入的文本
     * @param {object} [opts] - { append: false, triggerEvents: true }
     */
    function type(viewOrAddress, text, opts) {
        opts = opts || {};
        onMain(function() {
            var view = toProxy(viewOrAddress);
            if (!view) throw new Error('[WNAuto.type] view is null');

            var cn = view.invoke('class').invoke('description');
            var isTextField = _isKindOfClass(view, 'UITextField');
            var isTextView = _isKindOfClass(view, 'UITextView');

            if (isTextField) {
                _typeInTextField(view, text, opts);
            } else if (isTextView) {
                _typeInTextView(view, text, opts);
            } else if (cn.indexOf('SearchBar') >= 0) {
                var tf = view.invoke('searchTextField');
                if (tf) _typeInTextField(tf, text, opts);
                else throw new Error('[WNAuto.type] cannot find searchTextField in ' + cn);
            } else {
                throw new Error('[WNAuto.type] unsupported view class: ' + cn);
            }
        });
    }

    /**
     * 清空文本输入框
     * @param {object} viewOrAddress
     */
    function clearText(viewOrAddress) {
        onMain(function() {
            var view = toProxy(viewOrAddress);
            if (!view) throw new Error('[WNAuto.clearText] view is null');
            if (_isKindOfClass(view, 'UITextField')) {
                _typeInTextField(view, '', { append: false });
            } else if (_isKindOfClass(view, 'UITextView')) {
                _typeInTextView(view, '', { append: false });
            }
        });
    }

    /**
     * 滚动 UIScrollView / UITableView / UICollectionView
     * @param {object} viewOrAddress
     * @param {object} offset - { x, y } 目标 contentOffset
     * @param {boolean} [animated] - 是否动画，默认 false
     */
    function scroll(viewOrAddress, offset, animated) {
        onMain(function() {
            var view = toProxy(viewOrAddress);
            if (!view) throw new Error('[WNAuto.scroll] view is null');

            var CGPoint = ObjC.use('NSValue');
            view.invoke('setContentOffset:animated:', [
                _makeCGPoint(offset.x || 0, offset.y || 0),
                _resolveAnimated(animated)
            ]);
        });
    }

    /**
     * 按方向滚动（相对于当前位置）
     * @param {object} viewOrAddress - UIScrollView 代理
     * @param {string} direction - 'up' | 'down' | 'left' | 'right'
     * @param {number} [distance] - 滚动距离（点），默认 300
     */
    function scrollBy(viewOrAddress, direction, distance) {
        distance = distance || 300;
        onMain(function() {
            var view = toProxy(viewOrAddress);
            if (!view) throw new Error('[WNAuto.scrollBy] view is null');

            var currentOffset = view.invoke('contentOffset');
            var x = 0, y = 0;
            try {
                var desc = currentOffset.invoke('description').toString();
                var match = desc.match(/\{([\d.e+-]+),\s*([\d.e+-]+)\}/);
                if (match) { x = parseFloat(match[1]); y = parseFloat(match[2]); }
            } catch(e) { /* use 0,0 */ }

            switch (direction) {
                case 'down':  y += distance; break;
                case 'up':    y = Math.max(0, y - distance); break;
                case 'right': x += distance; break;
                case 'left':  x = Math.max(0, x - distance); break;
            }

            view.invoke('setContentOffset:animated:', [
                _makeCGPoint(x, y), _resolveAnimated()
            ]);
        });
    }

    /**
     * 滚动到顶部
     * @param {object} viewOrAddress
     */
    function scrollToTop(viewOrAddress) {
        scroll(viewOrAddress, { x: 0, y: 0 }, true);
    }

    /**
     * 滚动到底部
     * @param {object} viewOrAddress
     */
    function scrollToBottom(viewOrAddress) {
        onMain(function() {
            var view = toProxy(viewOrAddress);
            if (!view) throw new Error('[WNAuto.scrollToBottom] view is null');

            var contentSize = view.invoke('contentSize');
            var frameSize = view.invoke('frame');
            try {
                var csDesc = contentSize.invoke ? contentSize.invoke('description').toString() : String(contentSize);
                var frDesc = frameSize.invoke ? frameSize.invoke('description').toString() : String(frameSize);

                var csMatch = csDesc.match(/([\d.e+-]+),\s*([\d.e+-]+)/);
                var frMatch = frDesc.match(/([\d.e+-]+),\s*([\d.e+-]+)\s*\}/);
                if (csMatch && frMatch) {
                    var contentH = parseFloat(csMatch[2]);
                    var frameH = parseFloat(frMatch[2]);
                    var maxY = Math.max(0, contentH - frameH);
                    view.invoke('setContentOffset:animated:', [_makeCGPoint(0, maxY), _resolveAnimated()]);
                }
            } catch(e) {
                console.warn('[WNAuto.scrollToBottom] parse error: ' + e.message);
            }
        });
    }

    /**
     * 切换 UISwitch / UISegmentedControl 状态
     * @param {object} viewOrAddress - UISwitch 代理
     * @param {boolean} on - 目标状态
     */
    function setSwitch(viewOrAddress, on) {
        onMain(function() {
            var view = toProxy(viewOrAddress);
            if (!view) throw new Error('[WNAuto.setSwitch] view is null');
            view.invoke('setOn:animated:', [on, false]);
            view.invoke('sendActionsForControlEvents:', [1 << 12]); // UIControlEventValueChanged = 4096
        });
    }

    /**
     * 选择 UISegmentedControl 的指定段
     * @param {object} viewOrAddress
     * @param {number} index - 段索引
     */
    function selectSegment(viewOrAddress, index) {
        onMain(function() {
            var view = toProxy(viewOrAddress);
            if (!view) throw new Error('[WNAuto.selectSegment] view is null');
            view.invoke('setSelectedSegmentIndex:', [index]);
            view.invoke('sendActionsForControlEvents:', [1 << 12]); // UIControlEventValueChanged
        });
    }

    /**
     * 设置 UISlider 值
     * @param {object} viewOrAddress
     * @param {number} value - 0.0 ~ 1.0
     */
    function setSlider(viewOrAddress, value) {
        onMain(function() {
            var view = toProxy(viewOrAddress);
            if (!view) throw new Error('[WNAuto.setSlider] view is null');
            view.invoke('setValue:animated:', [value, false]);
            view.invoke('sendActionsForControlEvents:', [1 << 12]); // UIControlEventValueChanged
        });
    }

    /**
     * 设置 UIDatePicker 日期
     * @param {object} viewOrAddress
     * @param {number} timestamp - Unix 时间戳（秒）
     */
    function setDate(viewOrAddress, timestamp) {
        onMain(function() {
            var view = toProxy(viewOrAddress);
            if (!view) throw new Error('[WNAuto.setDate] view is null');
            var date = ObjC.use('NSDate').invoke('dateWithTimeIntervalSince1970:', [timestamp]);
            view.invoke('setDate:animated:', [date, false]);
            view.invoke('sendActionsForControlEvents:', [1 << 12]); // UIControlEventValueChanged
        });
    }

    // ─── Navigation: 导航操作 ────────────────────────────────

    var nav = {
        /**
         * Push 一个新的 ViewController
         * @param {object} vcProxy - 要 push 的 VC 代理
         * @param {boolean} [animated]
         */
        push: function(vcProxy, animated) {
            onMain(function() {
                var navVC = _findNavigationController();
                if (!navVC) throw new Error('[WNAuto.nav.push] no UINavigationController found');
                navVC.invoke('pushViewController:animated:', [vcProxy, animated !== false]);
            });
        },

        /**
         * Pop 当前 VC
         * @param {boolean} [animated]
         */
        pop: function(animated) {
            onMain(function() {
                var navVC = _findNavigationController();
                if (!navVC) throw new Error('[WNAuto.nav.pop] no UINavigationController found');
                navVC.invoke('popViewControllerAnimated:', [animated !== false]);
            });
        },

        /**
         * Pop 到根 VC
         * @param {boolean} [animated]
         */
        popToRoot: function(animated) {
            onMain(function() {
                var navVC = _findNavigationController();
                if (!navVC) throw new Error('[WNAuto.nav.popToRoot] no UINavigationController found');
                navVC.invoke('popToRootViewControllerAnimated:', [animated !== false]);
            });
        },

        /**
         * Present 一个 VC
         * @param {object} vcProxy - 要 present 的 VC 代理
         * @param {boolean} [animated]
         */
        present: function(vcProxy, animated) {
            onMain(function() {
                var topVC = _topVC();
                if (!topVC) throw new Error('[WNAuto.nav.present] no top VC found');
                topVC.invoke('presentViewController:animated:completion:', [vcProxy, animated !== false, null]);
            });
        },

        /**
         * Dismiss 当前 presented VC
         * @param {boolean} [animated]
         */
        dismiss: function(animated) {
            onMain(function() {
                var topVC = _topVC();
                if (!topVC) throw new Error('[WNAuto.nav.dismiss] no top VC found');
                _dismissVC(topVC);
            });
        },

        /**
         * 选择 UITabBarController 的指定 tab
         * @param {number} index - tab 索引
         */
        selectTab: function(index) {
            onMain(function() {
                var tabVC = _findTabBarController();
                if (!tabVC) throw new Error('[WNAuto.nav.selectTab] no UITabBarController found');
                tabVC.invoke('setSelectedIndex:', [index]);
            });
        },

        /**
         * 点击导航栏返回按钮
         */
        goBack: function() {
            onMain(function() {
                var navVC = _findNavigationController();
                if (!navVC) throw new Error('[WNAuto.nav.goBack] no UINavigationController found');
                var topVC = navVC.invoke('topViewController');
                if (topVC) {
                    var navItem = topVC.invoke('navigationItem');
                    var backBtn = navItem ? navItem.invoke('backBarButtonItem') : null;
                    if (backBtn && backBtn.invoke) {
                        var target = backBtn.invoke('target');
                        var action = backBtn.invoke('action');
                        if (target && action) {
                            ObjC.instance(target).invoke(String(action), [backBtn]);
                            return;
                        }
                    }
                }
                navVC.invoke('popViewControllerAnimated:', [true]);
            });
        }
    };

    nav.push = _withActionDelay(nav.push);
    nav.pop = _withActionDelay(nav.pop);
    nav.popToRoot = _withActionDelay(nav.popToRoot);
    nav.present = _withActionDelay(nav.present);
    nav.dismiss = _withActionDelay(nav.dismiss);
    nav.selectTab = _withActionDelay(nav.selectTab);
    nav.goBack = _withActionDelay(nav.goBack);

    // ─── Alert: 弹窗处理 ─────────────────────────────────────

    function _currentAlert() {
        var topVC = _topVC();
        if (!topVC) return null;
        var cn = topVC.invoke('class').invoke('description');
        if (cn === 'UIAlertController' || cn.indexOf('AlertController') >= 0) {
            return topVC;
        }
        return null;
    }

    function _dismissVC(vc) {
        if (!vc) return;
        vc.invoke('dismissViewControllerAnimated:completion:', [false, null]);
    }

    /**
     * Find a UITextField in the alert's view hierarchy at `fieldIndex`.
     * Fallback for when alertVC.textFields returns empty.
     */
    function _findTextFieldInHierarchy(alertVC, fieldIndex) {
        var alertView;
        try { alertView = alertVC.invoke('view'); } catch(e) { return null; }
        if (!alertView) return null;
        var fields = [];
        var stack = [alertView];
        while (stack.length > 0) {
            var v = stack.pop();
            try {
                var cn = String(v.invoke('class').invoke('description'));
                if (cn === 'UITextField' || cn.indexOf('UITextField') >= 0) {
                    fields.push(v);
                }
            } catch(e) {}
            try {
                var subs = v.invoke('subviews');
                if (subs) {
                    var c = subs.invoke('count');
                    for (var i = 0; i < c; i++) {
                        stack.push(subs.invoke('objectAtIndex:', [i]));
                    }
                }
            } catch(e) {}
        }
        return fields.length > (fieldIndex || 0) ? fields[fieldIndex || 0] : null;
    }

    var alert = {
        /**
         * 检测当前是否有 UIAlertController 显示
         * @returns {object|null} UIAlertController 代理
         */
        current: function() {
            return onMain(function() {
                return _currentAlert();
            });
        },

        /**
         * 点击 Alert 上指定标题的按钮
         * @param {string} buttonTitle
         * @returns {boolean} 是否找到并点击
         */
        tapButton: function(buttonTitle) {
            return onMain(function() {
                var alertVC = _currentAlert();
                if (!alertVC) return false;
                var actions = alertVC.invoke('actions');
                if (!actions) return false;
                var count = actions.invoke('count');
                for (var i = 0; i < count; i++) {
                    var action = actions.invoke('objectAtIndex:', [i]);
                    var title = action.invoke('title');
                    if (title && String(title) === buttonTitle) {
                        alertVC.invoke('_dismissAnimated:triggeringAction:', [true, action]);
                        return true;
                    }
                }
                return false;
            });
        },

        /**
         * 在 Alert 的文本输入框中输入文字
         * @param {number} fieldIndex - 输入框索引（通常 0）
         * @param {string} text
         */
        typeInField: function(fieldIndex, text) {
            onMain(function() {
                var alertVC = _currentAlert();
                if (!alertVC) throw new Error('[WNAuto.alert.typeInField] no alert');
                var tf = null;
                try {
                    var textFields = alertVC.invoke('textFields');
                    if (textFields && textFields.invoke('count') > (fieldIndex || 0)) {
                        tf = textFields.invoke('objectAtIndex:', [fieldIndex || 0]);
                    }
                } catch(e) {}
                if (!tf) tf = _findTextFieldInHierarchy(alertVC, fieldIndex);
                if (!tf) throw new Error('[WNAuto.alert.typeInField] no textFields');
                _typeInTextField(tf, text, {});
            });
        },

        /**
         * Dismiss 当前 alert
         */
        dismiss: function() {
            onMain(function() {
                var alertVC = _currentAlert();
                if (!alertVC) return;
                var actions = alertVC.invoke('actions');
                var action = null;
                if (actions) {
                    var count = actions.invoke('count');
                    for (var i = 0; i < count; i++) {
                        var a = actions.invoke('objectAtIndex:', [i]);
                        // UIAlertActionStyleCancel = 1
                        if (a.invoke('style') === 1) { action = a; break; }
                    }
                    if (!action && count > 0) action = actions.invoke('objectAtIndex:', [0]);
                }
                alertVC.invoke('_dismissAnimated:triggeringAction:', [true, action]);
            });
        },

        /**
         * 等待 Alert 出现
         * @param {object} [opts] - { timeout: 5000 }
         * @returns {boolean}
         */
        waitFor: function(opts) {
            opts = opts || {};
            return find.waitFor(function() {
                return alert.current() !== null;
            }, { timeout: opts.timeout || 5000, message: 'alert not appeared' });
        }
    };

    alert.tapButton = _withActionDelay(alert.tapButton);
    alert.typeInField = _withActionDelay(alert.typeInField);
    alert.dismiss = _withActionDelay(alert.dismiss);

    // ─── View Properties: 视图属性读取 ──────────────────────

    var props = {
        /** 获取视图文本 */
        text: function(viewOrAddress) {
            return onMain(function() {
                var view = toProxy(viewOrAddress);
                return view ? _extractText(view) : null;
            });
        },

        /** 获取视图类名 */
        className: function(viewOrAddress) {
            return onMain(function() {
                var view = toProxy(viewOrAddress);
                if (!view) return null;
                try { return view.invoke('class').invoke('description'); } catch(e) { return null; }
            });
        },

        /** 视图是否可见（非 hidden 且 alpha > 0） */
        isVisible: function(viewOrAddress) {
            return onMain(function() {
                var view = toProxy(viewOrAddress);
                if (!view) return false;
                try {
                    var hidden = view.invoke('isHidden');
                    var alpha = view.invoke('alpha');
                    return !hidden && alpha > 0;
                } catch(e) { return false; }
            });
        },

        /** 视图是否可交互 */
        isEnabled: function(viewOrAddress) {
            return onMain(function() {
                var view = toProxy(viewOrAddress);
                if (!view) return false;
                try { return !!view.invoke('isEnabled'); } catch(e) { return true; }
            });
        },

        /** 获取视图 frame 描述 */
        frame: function(viewOrAddress) {
            return onMain(function() {
                var view = toProxy(viewOrAddress);
                if (!view) return null;
                try {
                    var f = view.invoke('frame');
                    return f.invoke ? f.invoke('description').toString() : String(f);
                } catch(e) { return null; }
            });
        },

        /** 获取 UIControl 选中状态 */
        isSelected: function(viewOrAddress) {
            return onMain(function() {
                var view = toProxy(viewOrAddress);
                if (!view) return false;
                try { return !!view.invoke('isSelected'); } catch(e) { return false; }
            });
        },

        /** 获取 UISwitch 的 on 状态 */
        isSwitchOn: function(viewOrAddress) {
            return onMain(function() {
                var view = toProxy(viewOrAddress);
                if (!view) return false;
                try { return !!view.invoke('isOn'); } catch(e) { return false; }
            });
        },

        /** 获取子视图数量 */
        subviewCount: function(viewOrAddress) {
            return onMain(function() {
                var view = toProxy(viewOrAddress);
                if (!view) return 0;
                try {
                    var subs = view.invoke('subviews');
                    return subs ? subs.invoke('count') : 0;
                } catch(e) { return 0; }
            });
        }
    };

    // ─── Screenshot: 截图 ────────────────────────────────────

    var screenshot = {
        /** 全屏截图（Base64 PNG） */
        full: function() {
            if (typeof UIDebug !== 'undefined') return UIDebug.screenshot();
            return null;
        },
        /** 指定视图截图 */
        view: function(viewOrAddress) {
            if (typeof UIDebug !== 'undefined') {
                var addr = typeof viewOrAddress === 'string' ? viewOrAddress : null;
                if (!addr && viewOrAddress && viewOrAddress.invoke) {
                    try { addr = viewOrAddress.invoke('description').toString().match(/0x[0-9a-f]+/i); if (addr) addr = addr[0]; } catch(e) {}
                }
                if (addr) return UIDebug.screenshotView(addr);
            }
            return null;
        }
    };

    // ─── Internal helpers ────────────────────────────────────

    function _keyWindow() {
        var UIApp = ObjC.use('UIApplication');
        var app = UIApp.invoke('sharedApplication');

        // iOS 15+ path
        try {
            var scenes = app.invoke('connectedScenes');
            if (scenes) {
                var allObjects = scenes.invoke('allObjects');
                var count = allObjects.invoke('count');
                for (var i = 0; i < count; i++) {
                    var scene = allObjects.invoke('objectAtIndex:', [i]);
                    var cn = scene.invoke('class').invoke('description');
                    if (cn.indexOf('UIWindowScene') >= 0) {
                        var windows = scene.invoke('windows');
                        var wCount = windows.invoke('count');
                        for (var j = 0; j < wCount; j++) {
                            var w = windows.invoke('objectAtIndex:', [j]);
                            if (w.invoke('isKeyWindow')) return w;
                        }
                    }
                }
            }
        } catch(e) { /* fallback */ }

        // Legacy path
        try {
            var keyWin = app.invoke('keyWindow');
            if (keyWin) return keyWin;
        } catch(e) { /* ignore */ }

        return null;
    }

    function _walk(view, callback, maxDepth) {
        maxDepth = maxDepth || 30;
        var stack = [{ v: view, d: 0 }];
        while (stack.length > 0) {
            var item = stack.pop();
            if (item.d > maxDepth) continue;
            callback(item.v);
            try {
                var subs = item.v.invoke('subviews');
                if (subs) {
                    var count = subs.invoke('count');
                    for (var i = count - 1; i >= 0; i--) {
                        stack.push({ v: subs.invoke('objectAtIndex:', [i]), d: item.d + 1 });
                    }
                }
            } catch(e) { /* ignore */ }
        }
    }

    function _extractText(view) {
        try {
            var cn = view.invoke('class').invoke('description');
            if (cn.indexOf('UILabel') >= 0 || cn.indexOf('UITextView') >= 0) {
                var t = view.invoke('text');
                if (t) return String(t);
            }
            if (cn.indexOf('UIButton') >= 0) {
                var tl = view.invoke('titleLabel');
                if (tl) {
                    var bt = tl.invoke('text');
                    if (bt) return String(bt);
                }
                var ct = view.invoke('currentTitle');
                if (ct) return String(ct);
            }
            if (cn.indexOf('UITextField') >= 0) {
                var ft = view.invoke('text');
                if (ft != null) return String(ft);
                var ph = view.invoke('placeholder');
                if (ph) return String(ph);
            }
            if (cn.indexOf('UISegmentedControl') >= 0) {
                var selIdx = view.invoke('selectedSegmentIndex');
                if (selIdx >= 0) {
                    var segTitle = view.invoke('titleForSegmentAtIndex:', [selIdx]);
                    if (segTitle) return String(segTitle);
                }
            }
        } catch(e) { /* ignore */ }
        return null;
    }

    function _isKindOfClass(proxy, className) {
        try {
            var cls = ObjC.use(className);
            if (!cls) return false;
            return !!proxy.invoke('isKindOfClass:', [cls]);
        } catch(e) { return false; }
    }

    function _matchesCriteria(view, criteria) {
        try {
            if (criteria.class) {
                var cn = view.invoke('class').invoke('description');
                if (cn !== criteria.class) return false;
            }
            if (criteria.text) {
                var t = _extractText(view);
                if (!t || t.toLowerCase().indexOf(criteria.text.toLowerCase()) < 0) return false;
            }
            if (criteria.id) {
                var aid = view.invoke('accessibilityIdentifier');
                if (!aid || String(aid) !== criteria.id) return false;
            }
            if (criteria.label) {
                var al = view.invoke('accessibilityLabel');
                if (!al || String(al).toLowerCase().indexOf(criteria.label.toLowerCase()) < 0) return false;
            }
            if (criteria.tag !== undefined) {
                if (view.invoke('tag') !== criteria.tag) return false;
            }
            if (criteria.visible === true) {
                if (view.invoke('isHidden') || view.invoke('alpha') <= 0) return false;
            }
            return true;
        } catch(e) { return false; }
    }

    function _typeInTextField(tf, text, opts) {
        var NSNotificationCenter = ObjC.use('NSNotificationCenter');
        var center = NSNotificationCenter.invoke('defaultCenter');

        if (opts.append) {
            var current = tf.invoke('text');
            text = (current ? String(current) : '') + text;
        }

        tf.invoke('setText:', [text]);

        // Fire UITextField notifications
        if (opts.triggerEvents !== false) {
            center.invoke('postNotificationName:object:', [
                'UITextFieldTextDidChangeNotification', tf
            ]);
            tf.invoke('sendActionsForControlEvents:', [1 << 17]); // UIControlEventEditingChanged = 131072
        }
    }

    function _typeInTextView(tv, text, opts) {
        var NSNotificationCenter = ObjC.use('NSNotificationCenter');
        var center = NSNotificationCenter.invoke('defaultCenter');

        if (opts.append) {
            var current = tv.invoke('text');
            text = (current ? String(current) : '') + text;
        }

        tv.invoke('setText:', [text]);

        if (opts.triggerEvents !== false) {
            center.invoke('postNotificationName:object:', [
                'UITextViewTextDidChangeNotification', tv
            ]);
            var delegate = tv.invoke('delegate');
            if (delegate) {
                try {
                    ObjC.instance(delegate).invoke('textViewDidChange:', [tv]);
                } catch(e) { /* delegate may not implement */ }
            }
        }
    }

    function _simulateTap(view) {
        var gestureRecognizers = view.invoke('gestureRecognizers');
        if (gestureRecognizers) {
            var count = gestureRecognizers.invoke('count');
            for (var i = 0; i < count; i++) {
                var gr = gestureRecognizers.invoke('objectAtIndex:', [i]);
                var cn = gr.invoke('class').invoke('description');
                if (cn.indexOf('TapGesture') >= 0 || cn.indexOf('Tap') >= 0) {
                    _fireGestureRecognizer(gr);
                    return;
                }
            }
        }
    }

    function _fireGestureRecognizer(gr, state) {
        try {
            // UIKit automatically fires target-action pairs on state transitions
            gr.invoke('setState:', [state !== undefined ? state : 3]);
        } catch(e) {
            console.warn('[WNAuto] _fireGestureRecognizer error: ' + e.message);
        }
    }

    function _makeCGPoint(x, y) {
        var NSValue = ObjC.use('NSValue');
        return NSValue.invoke('valueWithCGPoint:', [{ x: x, y: y }]);
    }

    function _topVC() {
        var UIApp = ObjC.use('UIApplication');
        var app = UIApp.invoke('sharedApplication');
        var keyWin = _keyWindow();
        if (!keyWin) return null;

        var rootVC = keyWin.invoke('rootViewController');
        if (!rootVC) return null;
        return _resolveTopVC(rootVC);
    }

    function _resolveTopVC(vc) {
        if (!vc) return null;
        try {
            var presented = vc.invoke('presentedViewController');
            if (presented) return _resolveTopVC(presented);

            var cn = vc.invoke('class').invoke('description');
            if (cn.indexOf('UINavigationController') >= 0) {
                var top = vc.invoke('topViewController');
                if (top) return _resolveTopVC(top);
            }
            if (cn.indexOf('UITabBarController') >= 0) {
                var sel = vc.invoke('selectedViewController');
                if (sel) return _resolveTopVC(sel);
            }
        } catch(e) { /* ignore */ }
        return vc;
    }

    function _findNavigationController() {
        var keyWin = _keyWindow();
        if (!keyWin) return null;
        var rootVC = keyWin.invoke('rootViewController');
        return _searchForClass(rootVC, 'UINavigationController');
    }

    function _findTabBarController() {
        var keyWin = _keyWindow();
        if (!keyWin) return null;
        var rootVC = keyWin.invoke('rootViewController');
        return _searchForClass(rootVC, 'UITabBarController');
    }

    function _searchForClass(vc, className) {
        if (!vc) return null;
        try {
            var cn = vc.invoke('class').invoke('description');
            if (cn.indexOf(className) >= 0) return vc;
            var presented = vc.invoke('presentedViewController');
            if (presented) {
                var r = _searchForClass(presented, className);
                if (r) return r;
            }
            if (cn.indexOf('UINavigationController') >= 0) {
                return vc;
            }
            if (cn.indexOf('UITabBarController') >= 0) {
                if (className === 'UITabBarController') return vc;
                var sel = vc.invoke('selectedViewController');
                return _searchForClass(sel, className);
            }
            var childVCs = vc.invoke('childViewControllers');
            if (childVCs) {
                var count = childVCs.invoke('count');
                for (var i = 0; i < count; i++) {
                    var child = childVCs.invoke('objectAtIndex:', [i]);
                    var r2 = _searchForClass(child, className);
                    if (r2) return r2;
                }
            }
        } catch(e) { /* ignore */ }
        return null;
    }

    // ─── Public API ──────────────────────────────────────────

    return {
        version: '1.0.0',

        // Actions
        tap: _withActionDelay(tap),
        doubleTap: _withActionDelay(doubleTap),
        longPress: _withActionDelay(longPress),
        type: _withActionDelay(type),
        clearText: _withActionDelay(clearText),
        scroll: _withActionDelay(scroll),
        scrollBy: _withActionDelay(scrollBy),
        scrollToTop: _withActionDelay(scrollToTop),
        scrollToBottom: _withActionDelay(scrollToBottom),
        setSwitch: _withActionDelay(setSwitch),
        selectSegment: _withActionDelay(selectSegment),
        setSlider: _withActionDelay(setSlider),
        setDate: _withActionDelay(setDate),

        // Finders
        find: find,

        // Navigation
        nav: nav,

        // Alert handling
        alert: alert,

        // Properties
        props: props,

        // Screenshot
        screenshot: screenshot,

        // Utilities
        sleep: sleep,
        runLoop: runLoop,
        toProxy: toProxy,
        setActionDelay: function(ms) {
            _actionConfig.actionDelayMs = Math.max(0, Number(ms) || 0);
        },
        setDefaultAnimated: function(enabled) {
            _actionConfig.defaultAnimated = !!enabled;
        },
        getConfig: function() {
            return {
                actionDelayMs: _actionConfig.actionDelayMs,
                defaultAnimated: _actionConfig.defaultAnimated
            };
        },

        /** 等待指定毫秒（推荐用于动画等待） */
        wait: function(ms) { sleep(ms || 500); }
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = WNAuto;
}
if (typeof globalThis !== 'undefined') {
    globalThis.WNAuto = WNAuto;
} else if (typeof this !== 'undefined') {
    this.WNAuto = WNAuto;
}
