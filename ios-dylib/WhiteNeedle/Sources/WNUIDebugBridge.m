#import "WNUIDebugBridge.h"
#import <UIKit/UIKit.h>

static NSString *const kLogPrefix = @"[WNUIDebugBridge]";
static const NSInteger kHighlightTag = 99887766;

static void wn_runOnMain(void (^block)(void)) {
    if ([NSThread isMainThread]) {
        block();
    } else {
        dispatch_sync(dispatch_get_main_queue(), block);
    }
}

@implementation WNUIDebugBridge

+ (void)registerInContext:(JSContext *)context {
    JSValue *ns = [JSValue valueWithNewObjectInContext:context];

    ns[@"keyWindow"] = ^JSValue *() {
        JSContext *ctx = [JSContext currentContext];
        __block UIWindow *win = nil;
        wn_runOnMain(^{ win = [self findKeyWindow]; });
        if (!win) return [JSValue valueWithNullInContext:ctx];
        return [JSValue valueWithObject:@{
            @"class":   NSStringFromClass([win class]),
            @"frame":   NSStringFromCGRect(win.frame),
            @"address": [NSString stringWithFormat:@"%p", win],
        } inContext:ctx];
    };

    ns[@"viewHierarchy"] = ^JSValue *() {
        JSContext *ctx = [JSContext currentContext];
        __block NSDictionary *tree = nil;
        wn_runOnMain(^{
            UIWindow *win = [self findKeyWindow];
            if (win) tree = [self viewTreeForView:win depth:0 maxDepth:20];
        });
        if (!tree) return [JSValue valueWithNullInContext:ctx];
        return [JSValue valueWithObject:tree inContext:ctx];
    };

    ns[@"screenshot"] = ^JSValue *() {
        JSContext *ctx = [JSContext currentContext];
        NSString *b64 = [self screenshotBase64];
        if (!b64) return [JSValue valueWithNullInContext:ctx];
        return [JSValue valueWithObject:b64 inContext:ctx];
    };

    ns[@"screenshotView"] = ^JSValue *(NSString *addrStr) {
        JSContext *ctx = [JSContext currentContext];
        if (!addrStr) return [JSValue valueWithNullInContext:ctx];
        __block NSString *base64 = nil;
        wn_runOnMain(^{
            UIView *view = [self viewFromAddress:addrStr];
            if (!view) return;
            UIGraphicsBeginImageContextWithOptions(view.bounds.size, NO, 0);
            [view drawViewHierarchyInRect:view.bounds afterScreenUpdates:NO];
            UIImage *img = UIGraphicsGetImageFromCurrentImageContext();
            UIGraphicsEndImageContext();
            NSData *png = UIImagePNGRepresentation(img);
            base64 = [png base64EncodedStringWithOptions:0];
        });
        if (!base64) return [JSValue valueWithNullInContext:ctx];
        return [JSValue valueWithObject:base64 inContext:ctx];
    };

    ns[@"bounds"] = ^JSValue *(NSString *addrStr) {
        JSContext *ctx = [JSContext currentContext];
        if (!addrStr) return [JSValue valueWithNullInContext:ctx];
        __block NSDictionary *result = nil;
        wn_runOnMain(^{
            UIView *view = [self viewFromAddress:addrStr];
            if (!view) return;
            result = @{
                @"frame":  NSStringFromCGRect(view.frame),
                @"bounds": NSStringFromCGRect(view.bounds),
                @"center": NSStringFromCGPoint(view.center),
                @"hidden": @(view.isHidden),
                @"alpha":  @(view.alpha),
            };
        });
        if (!result) return [JSValue valueWithNullInContext:ctx];
        return [JSValue valueWithObject:result inContext:ctx];
    };

    ns[@"viewControllers"] = ^JSValue *() {
        JSContext *ctx = [JSContext currentContext];
        __block NSDictionary *tree = nil;
        wn_runOnMain(^{
            UIWindow *win = [self findKeyWindow];
            UIViewController *root = win.rootViewController;
            if (root) tree = [self vcTreeForController:root depth:0];
        });
        if (!tree) return [JSValue valueWithNullInContext:ctx];
        return [JSValue valueWithObject:tree inContext:ctx];
    };

    ns[@"vcDetail"] = ^JSValue *(NSString *addr) {
        JSContext *ctx = [JSContext currentContext];
        NSDictionary *d = [self vcDetailForAddress:addr];
        if (!d) return [JSValue valueWithNullInContext:ctx];
        return [JSValue valueWithObject:d inContext:ctx];
    };

    ns[@"viewDetail"] = ^JSValue *(NSString *addr) {
        JSContext *ctx = [JSContext currentContext];
        NSDictionary *d = [self viewDetailForAddress:addr];
        if (!d) return [JSValue valueWithNullInContext:ctx];
        return [JSValue valueWithObject:d inContext:ctx];
    };

    ns[@"setViewProperty"] = ^BOOL(NSString *addr, NSString *key, JSValue *val) {
        return [self setViewProperty:addr key:key value:[val toObject]];
    };

    ns[@"highlightView"] = ^BOOL(NSString *addr) {
        return [self highlightView:addr];
    };

    ns[@"clearHighlight"] = ^{
        [self clearHighlight];
    };

    ns[@"searchViews"] = ^JSValue *(NSString *className) {
        JSContext *ctx = [JSContext currentContext];
        NSArray *result = [self searchViewsByClassName:className];
        return [JSValue valueWithObject:result inContext:ctx];
    };

    ns[@"searchViewsByText"] = ^JSValue *(NSString *text) {
        JSContext *ctx = [JSContext currentContext];
        NSArray *result = [self searchViewsByText:text];
        return [JSValue valueWithObject:result inContext:ctx];
    };

    context[@"UIDebug"] = ns;
    NSLog(@"%@ UIDebug bridge registered", kLogPrefix);
}

#pragma mark - Public class methods (for RPC)

+ (NSDictionary *)viewHierarchyTree {
    __block NSDictionary *tree = nil;
    wn_runOnMain(^{
        UIWindow *win = [self findKeyWindow];
        if (win) tree = [self viewTreeForView:win depth:0 maxDepth:20];
    });
    return tree ?: @{};
}

+ (NSDictionary *)viewControllerTree {
    __block NSDictionary *tree = nil;
    wn_runOnMain(^{
        UIWindow *win = [self findKeyWindow];
        UIViewController *root = win.rootViewController;
        if (root) tree = [self vcTreeForController:root depth:0];
    });
    return tree ?: @{};
}

+ (NSDictionary *)viewDetailForAddress:(NSString *)addr {
    if (!addr) return nil;
    __block NSMutableDictionary *result = nil;
    wn_runOnMain(^{
        UIView *view = [self viewFromAddress:addr];
        if (!view) return;
        result = [NSMutableDictionary new];
        result[@"class"]    = NSStringFromClass([view class]);
        result[@"address"]  = [NSString stringWithFormat:@"%p", view];
        result[@"frame"]    = NSStringFromCGRect(view.frame);
        result[@"bounds"]   = NSStringFromCGRect(view.bounds);
        result[@"center"]   = NSStringFromCGPoint(view.center);
        result[@"hidden"]   = @(view.isHidden);
        result[@"alpha"]    = @(view.alpha);
        result[@"opaque"]   = @(view.isOpaque);
        result[@"tag"]      = @(view.tag);
        result[@"clipsToBounds"] = @(view.clipsToBounds);
        result[@"userInteractionEnabled"] = @(view.isUserInteractionEnabled);
        result[@"contentMode"] = @(view.contentMode);
        result[@"subviewCount"] = @(view.subviews.count);

        UIColor *bg = view.backgroundColor;
        if (bg) {
            CGFloat r, g, b, a;
            [bg getRed:&r green:&g blue:&b alpha:&a];
            result[@"backgroundColor"] = [NSString stringWithFormat:@"rgba(%.0f,%.0f,%.0f,%.2f)", r*255, g*255, b*255, a];
        } else {
            result[@"backgroundColor"] = @"nil";
        }

        result[@"layer.cornerRadius"] = @(view.layer.cornerRadius);
        result[@"layer.borderWidth"]  = @(view.layer.borderWidth);

        if ([view isKindOfClass:[UILabel class]]) {
            UILabel *lbl = (UILabel *)view;
            result[@"text"]      = lbl.text ?: @"";
            result[@"font"]      = lbl.font.description ?: @"";
            result[@"textColor"] = lbl.textColor.description ?: @"";
            result[@"numberOfLines"] = @(lbl.numberOfLines);
        } else if ([view isKindOfClass:[UIButton class]]) {
            UIButton *btn = (UIButton *)view;
            result[@"title"]   = [btn titleForState:UIControlStateNormal] ?: @"";
            result[@"enabled"] = @(btn.isEnabled);
        } else if ([view isKindOfClass:[UIImageView class]]) {
            UIImage *img = ((UIImageView *)view).image;
            result[@"imageSize"] = img ? NSStringFromCGSize(img.size) : @"nil";
        } else if ([view isKindOfClass:[UITextField class]]) {
            UITextField *tf = (UITextField *)view;
            result[@"text"]        = tf.text ?: @"";
            result[@"placeholder"] = tf.placeholder ?: @"";
        } else if ([view isKindOfClass:[UITextView class]]) {
            result[@"text"] = ((UITextView *)view).text ?: @"";
        } else if ([view isKindOfClass:[UIScrollView class]]) {
            UIScrollView *sv = (UIScrollView *)view;
            result[@"contentSize"]   = NSStringFromCGSize(sv.contentSize);
            result[@"contentOffset"] = NSStringFromCGPoint(sv.contentOffset);
        }

        UIViewController *vc = [self viewControllerForView:view];
        if (vc) {
            result[@"viewController"] = NSStringFromClass([vc class]);
        }
    });
    return result;
}

+ (BOOL)setViewProperty:(NSString *)addr key:(NSString *)key value:(id)value {
    if (!addr || !key) return NO;
    __block BOOL ok = NO;
    wn_runOnMain(^{
        UIView *view = [self viewFromAddress:addr];
        if (!view) return;

        if ([key isEqualToString:@"hidden"]) {
            view.hidden = [value boolValue];
            ok = YES;
        } else if ([key isEqualToString:@"alpha"]) {
            view.alpha = [value doubleValue];
            ok = YES;
        } else if ([key isEqualToString:@"backgroundColor"]) {
            UIColor *color = [self colorFromString:value];
            if (color) { view.backgroundColor = color; ok = YES; }
        } else if ([key isEqualToString:@"frame"]) {
            CGRect rect = CGRectFromString(value);
            view.frame = rect;
            ok = YES;
        } else if ([key isEqualToString:@"clipsToBounds"]) {
            view.clipsToBounds = [value boolValue];
            ok = YES;
        } else if ([key isEqualToString:@"layer.cornerRadius"]) {
            view.layer.cornerRadius = [value doubleValue];
            ok = YES;
        } else if ([key isEqualToString:@"layer.borderWidth"]) {
            view.layer.borderWidth = [value doubleValue];
            ok = YES;
        } else if ([key isEqualToString:@"text"] && [view isKindOfClass:[UILabel class]]) {
            ((UILabel *)view).text = value;
            ok = YES;
        }
    });
    return ok;
}

+ (BOOL)highlightView:(NSString *)addr {
    if (!addr) return NO;
    __block BOOL ok = NO;
    wn_runOnMain(^{
        [self clearHighlight];
        UIView *view = [self viewFromAddress:addr];
        if (!view) return;

        UIView *overlay = [[UIView alloc] initWithFrame:view.bounds];
        overlay.tag = kHighlightTag;
        overlay.backgroundColor = [[UIColor redColor] colorWithAlphaComponent:0.15];
        overlay.layer.borderColor = [UIColor redColor].CGColor;
        overlay.layer.borderWidth = 2.0;
        overlay.userInteractionEnabled = NO;
        overlay.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
        [view addSubview:overlay];
        ok = YES;
    });
    return ok;
}

+ (void)clearHighlight {
    wn_runOnMain(^{
        UIWindow *win = [self findKeyWindow];
        if (win) [self removeHighlightRecursive:win];
    });
}

+ (NSArray *)searchViewsByClassName:(NSString *)className {
    if (!className || className.length == 0) return @[];
    __block NSMutableArray *results = [NSMutableArray new];
    wn_runOnMain(^{
        UIWindow *win = [self findKeyWindow];
        if (win) [self searchView:win className:className results:results];
    });
    return results;
}

+ (NSArray *)searchViewsByText:(NSString *)text {
    if (!text || text.length == 0) return @[];
    __block NSMutableArray *results = [NSMutableArray new];
    wn_runOnMain(^{
        UIWindow *win = [self findKeyWindow];
        if (win) [self searchViewByText:win query:text results:results];
    });
    return results;
}

+ (NSString *)screenshotBase64 {
    __block NSString *base64 = nil;
    wn_runOnMain(^{
        UIWindow *win = [self findKeyWindow];
        if (!win) return;
        CGFloat scale = MIN([UIScreen mainScreen].scale, 2.0);
        UIGraphicsBeginImageContextWithOptions(win.bounds.size, YES, scale);
        [win drawViewHierarchyInRect:win.bounds afterScreenUpdates:YES];
        UIImage *img = UIGraphicsGetImageFromCurrentImageContext();
        UIGraphicsEndImageContext();
        if (!img) return;
        NSData *jpeg = UIImageJPEGRepresentation(img, 0.7);
        base64 = [jpeg base64EncodedStringWithOptions:0];
    });
    return base64;
}

#pragma mark - Internal helpers

+ (UIWindow *)findKeyWindow {
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if (![scene isKindOfClass:[UIWindowScene class]]) continue;
        UIWindowScene *ws = (UIWindowScene *)scene;
        for (UIWindow *w in ws.windows) {
            if (w.isKeyWindow) return w;
        }
    }
    return nil;
}

+ (UIView *)viewFromAddress:(NSString *)addrStr {
    unsigned long long addr = 0;
    NSScanner *scanner = [NSScanner scannerWithString:addrStr];
    if ([addrStr hasPrefix:@"0x"] || [addrStr hasPrefix:@"0X"]) {
        [scanner setScanLocation:2];
    }
    [scanner scanHexLongLong:&addr];
    if (addr == 0) return nil;
    id obj = (__bridge id)(void *)addr;
    if ([obj isKindOfClass:[UIView class]]) return (UIView *)obj;
    return nil;
}

+ (UIViewController *)viewControllerForView:(UIView *)view {
    UIResponder *responder = view;
    while (responder) {
        responder = responder.nextResponder;
        if ([responder isKindOfClass:[UIViewController class]]) {
            return (UIViewController *)responder;
        }
    }
    return nil;
}

+ (UIColor *)colorFromString:(NSString *)str {
    if (!str || str.length == 0) return nil;

    // #RRGGBB or #RRGGBBAA
    if ([str hasPrefix:@"#"] && str.length >= 7) {
        unsigned int hex = 0;
        [[NSScanner scannerWithString:[str substringFromIndex:1]] scanHexInt:&hex];
        if (str.length >= 9) {
            CGFloat r = ((hex >> 24) & 0xFF) / 255.0;
            CGFloat g = ((hex >> 16) & 0xFF) / 255.0;
            CGFloat b = ((hex >> 8) & 0xFF) / 255.0;
            CGFloat a = (hex & 0xFF) / 255.0;
            return [UIColor colorWithRed:r green:g blue:b alpha:a];
        }
        CGFloat r = ((hex >> 16) & 0xFF) / 255.0;
        CGFloat g = ((hex >> 8) & 0xFF) / 255.0;
        CGFloat b = (hex & 0xFF) / 255.0;
        return [UIColor colorWithRed:r green:g blue:b alpha:1.0];
    }

    // rgba(R,G,B,A) or rgb(R,G,B) — values 0-255 for RGB, 0-1 for A
    NSString *lower = [str stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
    if ([lower hasPrefix:@"rgba("] || [lower hasPrefix:@"rgb("]) {
        NSRange open = [lower rangeOfString:@"("];
        NSRange close = [lower rangeOfString:@")" options:NSBackwardsSearch];
        if (open.location == NSNotFound || close.location == NSNotFound) return nil;
        NSString *inner = [lower substringWithRange:NSMakeRange(open.location + 1, close.location - open.location - 1)];
        NSArray *parts = [inner componentsSeparatedByString:@","];
        if (parts.count < 3) return nil;
        CGFloat r = [[parts[0] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]] doubleValue] / 255.0;
        CGFloat g = [[parts[1] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]] doubleValue] / 255.0;
        CGFloat b = [[parts[2] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]] doubleValue] / 255.0;
        CGFloat a = (parts.count >= 4) ? [[parts[3] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]] doubleValue] : 1.0;
        return [UIColor colorWithRed:r green:g blue:b alpha:a];
    }

    // Named colors
    static NSDictionary *named = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        named = @{
            @"red":    [UIColor redColor],
            @"green":  [UIColor greenColor],
            @"blue":   [UIColor blueColor],
            @"white":  [UIColor whiteColor],
            @"black":  [UIColor blackColor],
            @"yellow": [UIColor yellowColor],
            @"orange": [UIColor orangeColor],
            @"purple": [UIColor purpleColor],
            @"cyan":   [UIColor cyanColor],
            @"clear":  [UIColor clearColor],
            @"gray":   [UIColor grayColor],
        };
    });
    UIColor *color = named[lower.lowercaseString];
    if (color) return color;

    return nil;
}

+ (void)removeHighlightRecursive:(UIView *)view {
    for (UIView *sub in [view.subviews copy]) {
        if (sub.tag == kHighlightTag) {
            [sub removeFromSuperview];
        } else {
            [self removeHighlightRecursive:sub];
        }
    }
}

+ (void)searchView:(UIView *)view className:(NSString *)className results:(NSMutableArray *)results {
    NSString *cls = NSStringFromClass([view class]);
    if ([cls localizedCaseInsensitiveContainsString:className]) {
        NSMutableDictionary *d = [NSMutableDictionary new];
        d[@"class"]   = cls;
        d[@"address"] = [NSString stringWithFormat:@"%p", view];
        d[@"frame"]   = NSStringFromCGRect(view.frame);
        d[@"hidden"]  = @(view.isHidden);
        if ([view isKindOfClass:[UILabel class]]) {
            d[@"text"] = ((UILabel *)view).text ?: @"";
        }
        [results addObject:d];
    }
    for (UIView *sub in view.subviews) {
        [self searchView:sub className:className results:results];
    }
}

+ (void)searchViewByText:(UIView *)view query:(NSString *)query results:(NSMutableArray *)results {
    NSString *matchedText = nil;
    NSString *matchedField = nil;

    if ([view isKindOfClass:[UILabel class]]) {
        NSString *t = ((UILabel *)view).text;
        if (t && [t localizedCaseInsensitiveContainsString:query]) {
            matchedText = t;
            matchedField = @"text";
        }
    } else if ([view isKindOfClass:[UIButton class]]) {
        NSString *t = [((UIButton *)view) titleForState:UIControlStateNormal];
        if (t && [t localizedCaseInsensitiveContainsString:query]) {
            matchedText = t;
            matchedField = @"title";
        }
    } else if ([view isKindOfClass:[UITextField class]]) {
        UITextField *tf = (UITextField *)view;
        if (tf.text && [tf.text localizedCaseInsensitiveContainsString:query]) {
            matchedText = tf.text;
            matchedField = @"text";
        } else if (tf.placeholder && [tf.placeholder localizedCaseInsensitiveContainsString:query]) {
            matchedText = tf.placeholder;
            matchedField = @"placeholder";
        }
    } else if ([view isKindOfClass:[UITextView class]]) {
        NSString *t = ((UITextView *)view).text;
        if (t && [t localizedCaseInsensitiveContainsString:query]) {
            matchedText = t;
            matchedField = @"text";
        }
    } else if ([view isKindOfClass:NSClassFromString(@"UISegmentedControl")]) {
        UISegmentedControl *seg = (UISegmentedControl *)view;
        for (NSInteger i = 0; i < seg.numberOfSegments; i++) {
            NSString *t = [seg titleForSegmentAtIndex:i];
            if (t && [t localizedCaseInsensitiveContainsString:query]) {
                matchedText = t;
                matchedField = [NSString stringWithFormat:@"segment[%ld]", (long)i];
                break;
            }
        }
    }

    if (matchedText) {
        NSMutableDictionary *d = [NSMutableDictionary new];
        d[@"class"]      = NSStringFromClass([view class]);
        d[@"address"]    = [NSString stringWithFormat:@"%p", view];
        d[@"frame"]      = NSStringFromCGRect(view.frame);
        d[@"hidden"]     = @(view.isHidden);
        d[@"matchField"] = matchedField;
        d[@"matchText"]  = matchedText;
        [results addObject:d];
    }

    for (UIView *sub in view.subviews) {
        [self searchViewByText:sub query:query results:results];
    }
}

+ (NSDictionary *)viewTreeForView:(UIView *)view depth:(NSInteger)depth maxDepth:(NSInteger)maxDepth {
    NSMutableDictionary *node = [NSMutableDictionary new];
    node[@"class"]   = NSStringFromClass([view class]);
    node[@"address"] = [NSString stringWithFormat:@"%p", view];
    node[@"frame"]   = NSStringFromCGRect(view.frame);
    node[@"hidden"]  = @(view.isHidden);
    node[@"alpha"]   = @(view.alpha);

    if ([view isKindOfClass:[UILabel class]]) {
        node[@"text"] = ((UILabel *)view).text ?: @"";
    } else if ([view isKindOfClass:[UIButton class]]) {
        node[@"title"] = [((UIButton *)view) titleForState:UIControlStateNormal] ?: @"";
    } else if ([view isKindOfClass:[UIImageView class]]) {
        UIImage *img = ((UIImageView *)view).image;
        node[@"imageSize"] = img ? NSStringFromCGSize(img.size) : @"nil";
    }

    if (depth < maxDepth && view.subviews.count > 0) {
        NSMutableArray *children = [NSMutableArray new];
        for (UIView *sub in view.subviews) {
            [children addObject:[self viewTreeForView:sub depth:depth + 1 maxDepth:maxDepth]];
        }
        node[@"subviews"] = children;
    }

    return node;
}

+ (NSDictionary *)vcTreeForController:(UIViewController *)vc depth:(NSInteger)depth {
    NSMutableDictionary *info = [NSMutableDictionary new];
    info[@"class"]      = NSStringFromClass([vc class]);
    info[@"superclass"] = NSStringFromClass([vc superclass]);
    info[@"title"]      = vc.title ?: @"";
    info[@"address"]    = [NSString stringWithFormat:@"%p", vc];
    info[@"depth"]      = @(depth);
    info[@"isViewLoaded"] = @(vc.isViewLoaded);

    if (vc.isViewLoaded) {
        UIView *v = vc.view;
        info[@"viewClass"]   = NSStringFromClass([v class]);
        info[@"viewAddress"] = [NSString stringWithFormat:@"%p", v];
        info[@"viewFrame"]   = NSStringFromCGRect(v.frame);
    }

    if ([vc isKindOfClass:[UINavigationController class]]) {
        info[@"containerType"] = @"navigation";
        UINavigationController *nav = (UINavigationController *)vc;
        info[@"stackCount"] = @(nav.viewControllers.count);
        if (nav.topViewController) {
            info[@"topVC"] = NSStringFromClass([nav.topViewController class]);
        }
    } else if ([vc isKindOfClass:[UITabBarController class]]) {
        info[@"containerType"] = @"tabBar";
        UITabBarController *tab = (UITabBarController *)vc;
        info[@"tabCount"] = @(tab.viewControllers.count);
        info[@"selectedIndex"] = @(tab.selectedIndex);
    } else if ([vc isKindOfClass:[UIPageViewController class]]) {
        info[@"containerType"] = @"page";
    } else if ([vc isKindOfClass:[UISplitViewController class]]) {
        info[@"containerType"] = @"split";
    } else {
        info[@"containerType"] = @"content";
    }

    if (vc.navigationItem.title) {
        info[@"navItemTitle"] = vc.navigationItem.title;
    }
    if (vc.tabBarItem.title) {
        info[@"tabBarTitle"] = vc.tabBarItem.title;
    }
    info[@"childCount"]         = @(vc.childViewControllers.count);
    info[@"isBeingPresented"]   = @(vc.isBeingPresented);
    info[@"modalPresentationStyle"] = @(vc.modalPresentationStyle);

    NSMutableArray *children = [NSMutableArray new];

    if ([vc isKindOfClass:[UINavigationController class]]) {
        for (UIViewController *child in ((UINavigationController *)vc).viewControllers) {
            NSDictionary *node = [self vcTreeForController:child depth:depth + 1];
            NSMutableDictionary *mut = [node mutableCopy];
            mut[@"relation"] = @"navStack";
            [children addObject:mut];
        }
    } else if ([vc isKindOfClass:[UITabBarController class]]) {
        for (UIViewController *child in ((UITabBarController *)vc).viewControllers ?: @[]) {
            NSDictionary *node = [self vcTreeForController:child depth:depth + 1];
            NSMutableDictionary *mut = [node mutableCopy];
            mut[@"relation"] = @"tab";
            [children addObject:mut];
        }
    }

    if (vc.presentedViewController && vc.presentedViewController.presentingViewController == vc) {
        NSDictionary *node = [self vcTreeForController:vc.presentedViewController depth:depth + 1];
        NSMutableDictionary *mut = [node mutableCopy];
        mut[@"relation"] = @"presented";
        [children addObject:mut];
    }

    for (UIViewController *child in vc.childViewControllers) {
        if ([vc isKindOfClass:[UINavigationController class]] ||
            [vc isKindOfClass:[UITabBarController class]]) continue;
        NSDictionary *node = [self vcTreeForController:child depth:depth + 1];
        NSMutableDictionary *mut = [node mutableCopy];
        mut[@"relation"] = @"child";
        [children addObject:mut];
    }

    if (children.count > 0) {
        info[@"children"] = children;
    }

    return info;
}

+ (NSDictionary *)vcDetailForAddress:(NSString *)addrStr {
    if (!addrStr) return nil;
    unsigned long long addr = 0;
    NSScanner *scanner = [NSScanner scannerWithString:addrStr];
    if ([addrStr hasPrefix:@"0x"] || [addrStr hasPrefix:@"0X"]) [scanner setScanLocation:2];
    [scanner scanHexLongLong:&addr];
    if (addr == 0) return nil;

    __block NSMutableDictionary *result = nil;
    wn_runOnMain(^{
        id obj = (__bridge id)(void *)addr;
        if (![obj isKindOfClass:[UIViewController class]]) return;
        UIViewController *vc = (UIViewController *)obj;

        result = [NSMutableDictionary new];
        result[@"class"]      = NSStringFromClass([vc class]);
        result[@"superclass"] = NSStringFromClass([vc superclass]);
        result[@"address"]    = [NSString stringWithFormat:@"%p", vc];
        result[@"title"]      = vc.title ?: @"";
        result[@"isViewLoaded"] = @(vc.isViewLoaded);

        NSMutableArray *hierarchy = [NSMutableArray new];
        Class cls = [vc class];
        while (cls && cls != [NSObject class]) {
            [hierarchy addObject:NSStringFromClass(cls)];
            cls = [cls superclass];
        }
        result[@"classHierarchy"] = hierarchy;

        if (vc.isViewLoaded) {
            UIView *v = vc.view;
            result[@"viewClass"]   = NSStringFromClass([v class]);
            result[@"viewAddress"] = [NSString stringWithFormat:@"%p", v];
            result[@"viewFrame"]   = NSStringFromCGRect(v.frame);
            result[@"viewBounds"]  = NSStringFromCGRect(v.bounds);
            result[@"subviewCount"] = @(v.subviews.count);
        }

        if (vc.navigationController) {
            result[@"navigationController"] = NSStringFromClass([vc.navigationController class]);
            result[@"navPosition"] = @([vc.navigationController.viewControllers indexOfObject:vc]);
            result[@"navStackSize"] = @(vc.navigationController.viewControllers.count);
        }
        if (vc.tabBarController) {
            result[@"tabBarController"] = NSStringFromClass([vc.tabBarController class]);
        }
        if (vc.parentViewController) {
            result[@"parentVC"] = NSStringFromClass([vc.parentViewController class]);
            result[@"parentAddress"] = [NSString stringWithFormat:@"%p", vc.parentViewController];
        }
        if (vc.presentingViewController) {
            result[@"presentingVC"] = NSStringFromClass([vc.presentingViewController class]);
        }
        if (vc.presentedViewController) {
            result[@"presentedVC"] = NSStringFromClass([vc.presentedViewController class]);
        }

        result[@"childCount"]     = @(vc.childViewControllers.count);
        result[@"definesPresentationContext"] = @(vc.definesPresentationContext);
        result[@"modalPresentationStyle"]    = @(vc.modalPresentationStyle);
        result[@"modalTransitionStyle"]      = @(vc.modalTransitionStyle);
        result[@"edgesForExtendedLayout"]    = @(vc.edgesForExtendedLayout);

        if (vc.navigationItem) {
            result[@"navItemTitle"] = vc.navigationItem.title ?: @"";
            result[@"navItemHidesBackButton"] = @(vc.navigationItem.hidesBackButton);
        }
        if (vc.tabBarItem) {
            result[@"tabBarTitle"] = vc.tabBarItem.title ?: @"";
            result[@"tabBarTag"]   = @(vc.tabBarItem.tag);
        }

        if ([vc respondsToSelector:@selector(preferredContentSize)]) {
            result[@"preferredContentSize"] = NSStringFromCGSize(vc.preferredContentSize);
        }
    });
    return result;
}

@end
