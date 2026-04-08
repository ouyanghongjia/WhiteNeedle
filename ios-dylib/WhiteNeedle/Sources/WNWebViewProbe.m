#import "WNWebViewProbe.h"
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

static NSString *const kLogPrefix = @"[WNWebViewProbe]";

static void wn_makeInspectable(WKWebView *webView) {
    if (@available(iOS 16.4, *)) {
        if (!webView.isInspectable) {
            webView.inspectable = YES;
            NSLog(@"%@ Set inspectable=YES on %@", kLogPrefix, webView);
        }
    }
}

static IMP g_origInitWithFrame = NULL;
static IMP g_origInitWithCoder = NULL;

static id wn_initWithFrame(id self, SEL _cmd, CGRect frame, WKWebViewConfiguration *config) {
    id result = ((id(*)(id, SEL, CGRect, WKWebViewConfiguration *))g_origInitWithFrame)(self, _cmd, frame, config);
    if (result) {
        wn_makeInspectable(result);
    }
    return result;
}

static id wn_initWithCoder(id self, SEL _cmd, NSCoder *coder) {
    id result = ((id(*)(id, SEL, NSCoder *))g_origInitWithCoder)(self, _cmd, coder);
    if (result) {
        wn_makeInspectable(result);
    }
    return result;
}

@implementation WNWebViewProbe

+ (void)install {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        Class cls = [WKWebView class];

        Method m1 = class_getInstanceMethod(cls, @selector(initWithFrame:configuration:));
        if (m1) {
            g_origInitWithFrame = method_getImplementation(m1);
            method_setImplementation(m1, (IMP)wn_initWithFrame);
            NSLog(@"%@ Hooked -[WKWebView initWithFrame:configuration:]", kLogPrefix);
        }

        Method m2 = class_getInstanceMethod(cls, @selector(initWithCoder:));
        if (m2) {
            g_origInitWithCoder = method_getImplementation(m2);
            method_setImplementation(m2, (IMP)wn_initWithCoder);
            NSLog(@"%@ Hooked -[WKWebView initWithCoder:]", kLogPrefix);
        }

        [self retrofitExistingWebViews];
    });
}

+ (void)retrofitExistingWebViews {
    if (@available(iOS 16.4, *)) {
        dispatch_async(dispatch_get_main_queue(), ^{
            NSArray<UIWindow *> *windows;
            if (@available(iOS 15.0, *)) {
                NSMutableArray *allWindows = [NSMutableArray array];
                for (UIScene *scene in [UIApplication sharedApplication].connectedScenes) {
                    if ([scene isKindOfClass:[UIWindowScene class]]) {
                        [allWindows addObjectsFromArray:((UIWindowScene *)scene).windows];
                    }
                }
                windows = allWindows;
            } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
                windows = [UIApplication sharedApplication].windows;
#pragma clang diagnostic pop
            }

            NSInteger count = 0;
            for (UIWindow *window in windows) {
                count += [self makeWebViewsInspectableInView:window];
            }
            if (count > 0) {
                NSLog(@"%@ Retrofitted %ld existing WKWebView(s)", kLogPrefix, (long)count);
            }
        });
    }
}

+ (NSInteger)makeWebViewsInspectableInView:(UIView *)view {
    NSInteger count = 0;
    if ([view isKindOfClass:[WKWebView class]]) {
        wn_makeInspectable((WKWebView *)view);
        count++;
    }
    for (UIView *sub in view.subviews) {
        count += [self makeWebViewsInspectableInView:sub];
    }
    return count;
}

@end
