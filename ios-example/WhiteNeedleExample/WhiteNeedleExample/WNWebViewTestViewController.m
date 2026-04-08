#import "WNWebViewTestViewController.h"
#import <WebKit/WebKit.h>

@interface WNWebViewTestViewController ()
@property (nonatomic, strong) WKWebView *webView;
@end

@implementation WNWebViewTestViewController

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = UIColor.systemBackgroundColor;
    self.title = @"WK Inspector Test";

    self.navigationItem.leftBarButtonItem = [[UIBarButtonItem alloc]
        initWithBarButtonSystemItem:UIBarButtonSystemItemDone
                             target:self
                             action:@selector(doneTapped)];

    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    if (@available(iOS 14.0, *)) {
        WKWebpagePreferences *prefs = [[WKWebpagePreferences alloc] init];
        prefs.allowsContentJavaScript = YES;
        config.defaultWebpagePreferences = prefs;
    }

    self.webView = [[WKWebView alloc] initWithFrame:CGRectZero configuration:config];
    self.webView.translatesAutoresizingMaskIntoConstraints = NO;
    // WhiteNeedle 的 WNWebViewProbe 会在 init 时设 inspectable；此处再设一层，便于 iOS 16.4+ 无 Pod 场景下对照
    if (@available(iOS 16.4, *)) {
        self.webView.inspectable = YES;
    }
    [self.view addSubview:self.webView];

    UILayoutGuide *safe = self.view.safeAreaLayoutGuide;
    [NSLayoutConstraint activateConstraints:@[
        [self.webView.topAnchor constraintEqualToAnchor:safe.topAnchor],
        [self.webView.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
        [self.webView.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],
        [self.webView.bottomAnchor constraintEqualToAnchor:self.view.bottomAnchor],
    ]];

    NSString *html = [self testPageHTML];
    [self.webView loadHTMLString:html baseURL:nil];
}

- (void)doneTapped {
    [self dismissViewControllerAnimated:YES completion:nil];
}

- (NSString *)testPageHTML {
    return @"<!DOCTYPE html><html lang=\"zh-Hans\"><head><meta charset=\"utf-8\">"
           @"<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
           @"<title>WN WKWebView Test</title>"
           @"<style>"
           @"body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:20px;"
           @"background:#0d1117;color:#3fb950;line-height:1.5;}"
           @"h1{font-size:20px;margin:0 0 12px;color:#58a6ff;}"
           @"p{margin:10px 0;font-size:15px;color:#c9d1d9;}"
           @"code{background:#21262d;padding:2px 8px;border-radius:4px;color:#79c0ff;font-size:13px;}"
           @"</style></head><body>"
           @"<h1>WKWebView 调试页</h1>"
           @"<p>此页面标题为 <code>WN WKWebView Test</code>，应与 Remote Inspector 里名称 <code>WhiteNeedle</code> 的 JSContext 区分。</p>"
           @"<p>在 DevTools Console 可看到周期性日志；全局变量 <code>window.__WN_WK_TEST__</code> 为 <code>true</code>。</p>"
           @"<script>"
           @"console.log('[WN WK Test] loaded, __WN_WK_TEST__=' + (window.__WN_WK_TEST__ = true));"
           @"setInterval(function () {"
           @"  console.log('[WN WK Test] tick ' + new Date().toISOString());"
           @"}, 15000);"
           @"</script></body></html>";
}

@end
