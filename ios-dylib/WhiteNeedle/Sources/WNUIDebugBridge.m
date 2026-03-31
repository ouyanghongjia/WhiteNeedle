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
        __block NSArray *vcs = nil;
        wn_runOnMain(^{
            UIWindow *win = [self findKeyWindow];
            UIViewController *root = win.rootViewController;
            if (root) vcs = [self vcTreeForController:root depth:0];
        });
        if (!vcs) return [JSValue valueWithObject:@[] inContext:ctx];
        return [JSValue valueWithObject:vcs inContext:ctx];
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

+ (NSArray *)viewControllerStack {
    __block NSArray *vcs = nil;
    wn_runOnMain(^{
        UIWindow *win = [self findKeyWindow];
        UIViewController *root = win.rootViewController;
        if (root) vcs = [self vcTreeForController:root depth:0];
    });
    return vcs ?: @[];
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

+ (NSString *)screenshotBase64 {
    __block NSString *base64 = nil;
    wn_runOnMain(^{
        UIWindow *win = [self findKeyWindow];
        if (!win) return;
        UIGraphicsBeginImageContextWithOptions(win.bounds.size, NO, 0);
        [win drawViewHierarchyInRect:win.bounds afterScreenUpdates:NO];
        UIImage *img = UIGraphicsGetImageFromCurrentImageContext();
        UIGraphicsEndImageContext();
        NSData *png = UIImagePNGRepresentation(img);
        base64 = [png base64EncodedStringWithOptions:0];
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
    if (!str) return nil;
    if ([str hasPrefix:@"#"] && str.length >= 7) {
        unsigned int hex = 0;
        [[NSScanner scannerWithString:[str substringFromIndex:1]] scanHexInt:&hex];
        CGFloat r = ((hex >> 16) & 0xFF) / 255.0;
        CGFloat g = ((hex >> 8) & 0xFF) / 255.0;
        CGFloat b = (hex & 0xFF) / 255.0;
        return [UIColor colorWithRed:r green:g blue:b alpha:1.0];
    }
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

+ (NSArray *)vcTreeForController:(UIViewController *)vc depth:(NSInteger)depth {
    NSMutableDictionary *info = [NSMutableDictionary new];
    info[@"class"]   = NSStringFromClass([vc class]);
    info[@"title"]   = vc.title ?: @"";
    info[@"address"] = [NSString stringWithFormat:@"%p", vc];
    info[@"depth"]   = @(depth);

    NSMutableArray *result = [NSMutableArray arrayWithObject:info];

    if ([vc isKindOfClass:[UINavigationController class]]) {
        for (UIViewController *child in ((UINavigationController *)vc).viewControllers) {
            [result addObjectsFromArray:[self vcTreeForController:child depth:depth + 1]];
        }
    } else if ([vc isKindOfClass:[UITabBarController class]]) {
        for (UIViewController *child in ((UITabBarController *)vc).viewControllers ?: @[]) {
            [result addObjectsFromArray:[self vcTreeForController:child depth:depth + 1]];
        }
    }

    if (vc.presentedViewController) {
        [result addObjectsFromArray:[self vcTreeForController:vc.presentedViewController depth:depth + 1]];
    }

    for (UIViewController *child in vc.childViewControllers) {
        [result addObjectsFromArray:[self vcTreeForController:child depth:depth + 1]];
    }

    return result;
}

@end
