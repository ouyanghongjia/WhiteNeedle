#import "ViewController.h"
#import "WNLeakExamples.h"
#import "WNSQLiteDemo.h"
#import "WNWebViewTestViewController.h"
#import <WhiteNeedle/WNJSEngine.h>
#import <WhiteNeedle/WNHookEngine.h>
#import <WhiteNeedle/WNNativeBridge.h>
#import <WhiteNeedle/WNModuleLoader.h>

static NSString *const kCellID = @"ScriptCell";
static NSString *const kNetworkCellID = @"NetworkCell";

@interface ViewController ()
@property (nonatomic, strong) UITableView *tableView;
@property (nonatomic, strong) UITextView  *consoleView;
@property (nonatomic, strong) UIButton    *runAllButton;
@property (nonatomic, strong) UIButton    *clearButton;
@property (nonatomic, strong) UIButton    *networkButton;
@property (nonatomic, strong) UISegmentedControl *segmentControl;

@property (nonatomic, strong) WNJSEngine  *engine;
@property (nonatomic, strong) NSArray<NSString *> *scriptFiles;
@property (nonatomic, strong) NSArray<NSDictionary *> *networkTests;
@property (nonatomic, strong) NSMutableString *consoleLog;
@end

@implementation ViewController	

#pragma mark - Lifecycle

- (void)viewDidLoad {
    [super viewDidLoad];
    self.title = @"WhiteNeedle Tests";
    self.view.backgroundColor = UIColor.systemBackgroundColor;
    self.consoleLog = [NSMutableString string];

    [self setupEngine];
    [self loadScriptList];
    [self setupNetworkTests];
    [self buildUI];
}

#pragma mark - Engine

- (void)setupEngine {
    self.engine = [WNJSEngine sharedEngine];
    self.engine.delegate = self;
    if (!self.engine.isReady) {
        [self.engine setup];
    }
    [self log:@"ENGINE" message:@"WhiteNeedle engine ready"];
}

- (void)loadScriptList {
    NSString *scriptsDir = [[[NSBundle mainBundle] resourcePath]
                            stringByAppendingPathComponent:@"test-scripts"];
    NSArray *all = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:scriptsDir error:nil];
    NSMutableArray *tests = [NSMutableArray array];
    for (NSString *name in all) {
        if ([name hasPrefix:@"test_"] && [name hasSuffix:@".js"]) {
            [tests addObject:name];
        }
    }
    [tests sortUsingSelector:@selector(localizedCaseInsensitiveCompare:)];
    self.scriptFiles = [tests copy];
}

#pragma mark - Network Tests

- (void)setupNetworkTests {
    self.networkTests = @[
        @{ @"title": @"GET JSON (httpbin)",
           @"emoji": @"📥",
           @"detail": @"GET https://httpbin.org/get" },

        @{ @"title": @"POST JSON",
           @"emoji": @"📤",
           @"detail": @"POST https://httpbin.org/post" },

        @{ @"title": @"GET Image (PNG)",
           @"emoji": @"🖼",
           @"detail": @"GET https://httpbin.org/image/png" },

        @{ @"title": @"GET with Query Params",
           @"emoji": @"🔍",
           @"detail": @"GET https://httpbin.org/get?name=WhiteNeedle&version=1.0" },

        @{ @"title": @"PUT Request",
           @"emoji": @"✏️",
           @"detail": @"PUT https://httpbin.org/put" },

        @{ @"title": @"DELETE Request",
           @"emoji": @"🗑",
           @"detail": @"DELETE https://httpbin.org/delete" },

        @{ @"title": @"Status 404",
           @"emoji": @"❌",
           @"detail": @"GET https://httpbin.org/status/404" },

        @{ @"title": @"Status 500",
           @"emoji": @"💥",
           @"detail": @"GET https://httpbin.org/status/500" },

        @{ @"title": @"Redirect (302 → 200)",
           @"emoji": @"↪️",
           @"detail": @"GET https://httpbin.org/redirect/2" },

        @{ @"title": @"Delayed Response (2s)",
           @"emoji": @"⏱",
           @"detail": @"GET https://httpbin.org/delay/2" },

        @{ @"title": @"Response Headers",
           @"emoji": @"📋",
           @"detail": @"GET https://httpbin.org/response-headers?X-Custom=WhiteNeedle" },

        @{ @"title": @"GitHub API (public)",
           @"emoji": @"🐙",
           @"detail": @"GET https://api.github.com/repos/nicklockwood/iVersion" },

        @{ @"title": @"🚀 Fire All Requests",
           @"emoji": @"🚀",
           @"detail": @"Send all requests above simultaneously" },
    ];
}

- (void)runNetworkTestAtIndex:(NSUInteger)index {
    switch (index) {
        case 0:  [self testGETJSON]; break;
        case 1:  [self testPOSTJSON]; break;
        case 2:  [self testGETImage]; break;
        case 3:  [self testGETWithQuery]; break;
        case 4:  [self testPUT]; break;
        case 5:  [self testDELETE]; break;
        case 6:  [self testStatus:404]; break;
        case 7:  [self testStatus:500]; break;
        case 8:  [self testRedirect]; break;
        case 9:  [self testDelayedResponse]; break;
        case 10: [self testResponseHeaders]; break;
        case 11: [self testGitHubAPI]; break;
        case 12: [self fireAllNetworkTests]; break;
        default: break;
    }
}

- (void)fireAllNetworkTests {
    [self log:@"NET" message:@"═══ Firing all network requests ═══"];
    for (NSUInteger i = 0; i < self.networkTests.count - 1; i++) {
        [self runNetworkTestAtIndex:i];
    }
}

#pragma mark Network Test Cases

- (void)testGETJSON {
    [self log:@"NET" message:@"▶ GET https://httpbin.org/get"];
    NSURLRequest *req = [NSURLRequest requestWithURL:[NSURL URLWithString:@"https://httpbin.org/get"]];
    [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *resp, NSError *err) {
        [self logNetworkResult:@"GET JSON" response:resp data:data error:err];
    }] resume];
}

- (void)testPOSTJSON {
    [self log:@"NET" message:@"▶ POST https://httpbin.org/post"];
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:@"https://httpbin.org/post"]];
    req.HTTPMethod = @"POST";
    [req setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
    NSDictionary *body = @{
        @"tool": @"WhiteNeedle",
        @"version": @"1.0",
        @"features": @[@"network-monitor", @"host-mapping", @"js-engine"]
    };
    req.HTTPBody = [NSJSONSerialization dataWithJSONObject:body options:0 error:nil];
    [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *resp, NSError *err) {
        [self logNetworkResult:@"POST JSON" response:resp data:data error:err];
    }] resume];
}

- (void)testGETImage {
    [self log:@"NET" message:@"▶ GET https://httpbin.org/image/png"];
    NSURLRequest *req = [NSURLRequest requestWithURL:[NSURL URLWithString:@"https://httpbin.org/image/png"]];
    [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *resp, NSError *err) {
        NSString *extra = data ? [NSString stringWithFormat:@" (%lu bytes image)", (unsigned long)data.length] : @"";
        [self logNetworkResult:[@"GET Image" stringByAppendingString:extra] response:resp data:nil error:err];
    }] resume];
}

- (void)testGETWithQuery {
    [self log:@"NET" message:@"▶ GET https://httpbin.org/get?name=WhiteNeedle&version=1.0"];
    NSURLRequest *req = [NSURLRequest requestWithURL:
        [NSURL URLWithString:@"https://httpbin.org/get?name=WhiteNeedle&version=1.0"]];
    [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *resp, NSError *err) {
        [self logNetworkResult:@"GET Query" response:resp data:data error:err];
    }] resume];
}

- (void)testPUT {
    [self log:@"NET" message:@"▶ PUT https://httpbin.org/put"];
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:@"https://httpbin.org/put"]];
    req.HTTPMethod = @"PUT";
    [req setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
    req.HTTPBody = [NSJSONSerialization dataWithJSONObject:@{@"updated": @YES} options:0 error:nil];
    [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *resp, NSError *err) {
        [self logNetworkResult:@"PUT" response:resp data:data error:err];
    }] resume];
}

- (void)testDELETE {
    [self log:@"NET" message:@"▶ DELETE https://httpbin.org/delete"];
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:@"https://httpbin.org/delete"]];
    req.HTTPMethod = @"DELETE";
    [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *resp, NSError *err) {
        [self logNetworkResult:@"DELETE" response:resp data:data error:err];
    }] resume];
}

- (void)testStatus:(NSInteger)statusCode {
    NSString *urlStr = [NSString stringWithFormat:@"https://httpbin.org/status/%ld", (long)statusCode];
    [self log:@"NET" message:[NSString stringWithFormat:@"▶ GET %@", urlStr]];
    NSURLRequest *req = [NSURLRequest requestWithURL:[NSURL URLWithString:urlStr]];
    [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *resp, NSError *err) {
        [self logNetworkResult:[NSString stringWithFormat:@"Status %ld", (long)statusCode]
                      response:resp data:data error:err];
    }] resume];
}

- (void)testRedirect {
    [self log:@"NET" message:@"▶ GET https://httpbin.org/redirect/2 (2 redirects)"];
    NSURLRequest *req = [NSURLRequest requestWithURL:[NSURL URLWithString:@"https://httpbin.org/redirect/2"]];
    [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *resp, NSError *err) {
        [self logNetworkResult:@"Redirect" response:resp data:data error:err];
    }] resume];
}

- (void)testDelayedResponse {
    [self log:@"NET" message:@"▶ GET https://httpbin.org/delay/2 (2s delay)"];
    NSURLRequest *req = [NSURLRequest requestWithURL:[NSURL URLWithString:@"https://httpbin.org/delay/2"]];
    [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *resp, NSError *err) {
        [self logNetworkResult:@"Delayed 2s" response:resp data:data error:err];
    }] resume];
}

- (void)testResponseHeaders {
    [self log:@"NET" message:@"▶ GET https://httpbin.org/response-headers?X-Custom=WhiteNeedle"];
    NSURLRequest *req = [NSURLRequest requestWithURL:
        [NSURL URLWithString:@"https://httpbin.org/response-headers?X-Custom=WhiteNeedle"]];
    [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *resp, NSError *err) {
        [self logNetworkResult:@"Custom Headers" response:resp data:data error:err];
    }] resume];
}

- (void)testGitHubAPI {
    [self log:@"NET" message:@"▶ GET https://api.github.com/repos/nicklockwood/iVersion"];
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:
        [NSURL URLWithString:@"https://api.github.com/repos/nicklockwood/iVersion"]];
    [req setValue:@"application/vnd.github.v3+json" forHTTPHeaderField:@"Accept"];
    [req setValue:@"WhiteNeedle/1.0" forHTTPHeaderField:@"User-Agent"];
    [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *resp, NSError *err) {
        [self logNetworkResult:@"GitHub API" response:resp data:data error:err];
    }] resume];
}

- (void)logNetworkResult:(NSString *)label response:(NSURLResponse *)resp data:(NSData *)data error:(NSError *)err {
    if (err) {
        [self log:@"NET" message:[NSString stringWithFormat:@"✗ %@ — error: %@", label, err.localizedDescription]];
        return;
    }
    NSHTTPURLResponse *http = (NSHTTPURLResponse *)resp;
    NSString *bodyPreview = @"";
    if (data.length > 0 && data.length < 2048) {
        NSString *str = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        if (str.length > 200) str = [[str substringToIndex:200] stringByAppendingString:@"…"];
        if (str) bodyPreview = [NSString stringWithFormat:@"\n    body: %@", str];
    } else if (data.length >= 2048) {
        bodyPreview = [NSString stringWithFormat:@"\n    body: (%lu bytes)", (unsigned long)data.length];
    }
    [self log:@"NET" message:[NSString stringWithFormat:@"✓ %@ — %ld  %@  %lu bytes%@",
        label, (long)http.statusCode,
        http.MIMEType ?: @"",
        (unsigned long)data.length,
        bodyPreview]];
}

#pragma mark - UI

- (void)buildUI {
    self.segmentControl = [[UISegmentedControl alloc] initWithItems:@[@"Scripts", @"Network", @"Console"]];
    self.segmentControl.selectedSegmentIndex = 0;
    [self.segmentControl addTarget:self action:@selector(segmentChanged:) forControlEvents:UIControlEventValueChanged];
    self.segmentControl.translatesAutoresizingMaskIntoConstraints = NO;

    self.tableView = [[UITableView alloc] initWithFrame:CGRectZero style:UITableViewStyleInsetGrouped];
    self.tableView.dataSource = self;
    self.tableView.delegate = self;
    self.tableView.translatesAutoresizingMaskIntoConstraints = NO;
    [self.tableView registerClass:[UITableViewCell class] forCellReuseIdentifier:kCellID];
    [self.tableView registerClass:[UITableViewCell class] forCellReuseIdentifier:kNetworkCellID];

    self.consoleView = [[UITextView alloc] init];
    self.consoleView.editable = NO;
    self.consoleView.font = [UIFont monospacedSystemFontOfSize:11 weight:UIFontWeightRegular];
    self.consoleView.backgroundColor = [UIColor colorWithRed:0.1 green:0.1 blue:0.12 alpha:1];
    self.consoleView.textColor = [UIColor colorWithRed:0.0 green:1.0 blue:0.4 alpha:1];
    self.consoleView.translatesAutoresizingMaskIntoConstraints = NO;
    self.consoleView.hidden = YES;

    // Row 1: original buttons
    UIStackView *btnStack = [[UIStackView alloc] init];
    btnStack.axis = UILayoutConstraintAxisHorizontal;
    btnStack.distribution = UIStackViewDistributionFillEqually;
    btnStack.spacing = 12;
    btnStack.translatesAutoresizingMaskIntoConstraints = NO;

    self.runAllButton   = [self makeButton:@"▶ Run All"  color:UIColor.systemGreenColor  action:@selector(runAllScripts)];
    self.networkButton  = [self makeButton:@"🌐 Net All" color:UIColor.systemBlueColor   action:@selector(fireAllNetworkTests)];
    UIButton *leakBtn   = [self makeButton:@"💧 Leak"    color:UIColor.systemOrangeColor  action:@selector(createLeakExamples)];
    self.clearButton    = [self makeButton:@"✕ Clear"    color:UIColor.systemRedColor     action:@selector(clearConsole)];
    [btnStack addArrangedSubview:self.runAllButton];
    [btnStack addArrangedSubview:self.networkButton];
    [btnStack addArrangedSubview:leakBtn];
    [btnStack addArrangedSubview:self.clearButton];

    // Row 2: SQLite demo buttons
    UIStackView *sqlStack = [[UIStackView alloc] init];
    sqlStack.axis = UILayoutConstraintAxisHorizontal;
    sqlStack.distribution = UIStackViewDistributionFillEqually;
    sqlStack.spacing = 12;
    sqlStack.translatesAutoresizingMaskIntoConstraints = NO;

    UIButton *sqlCreateBtn = [self makeButton:@"🗄 Create DB"  color:UIColor.systemIndigoColor action:@selector(createSQLiteDemo)];
    UIButton *sqlActivityBtn = [self makeButton:@"⚡ Activity" color:UIColor.systemTealColor   action:@selector(simulateSQLiteActivity)];
    [sqlStack addArrangedSubview:sqlCreateBtn];
    [sqlStack addArrangedSubview:sqlActivityBtn];

    UIStackView *webStack = [[UIStackView alloc] init];
    webStack.axis = UILayoutConstraintAxisHorizontal;
    webStack.distribution = UIStackViewDistributionFill;
    webStack.spacing = 12;
    webStack.translatesAutoresizingMaskIntoConstraints = NO;
    UIButton *wkBtn = [self makeButton:@"🌐 WKWebView 调试页"
                                 color:UIColor.systemPurpleColor
                                action:@selector(openWebViewTest)];
    [webStack addArrangedSubview:wkBtn];

    [self.view addSubview:self.segmentControl];
    [self.view addSubview:self.tableView];
    [self.view addSubview:self.consoleView];
    [self.view addSubview:webStack];
    [self.view addSubview:sqlStack];
    [self.view addSubview:btnStack];

    UILayoutGuide *safe = self.view.safeAreaLayoutGuide;
    [NSLayoutConstraint activateConstraints:@[
        [self.segmentControl.topAnchor constraintEqualToAnchor:safe.topAnchor constant:8],
        [self.segmentControl.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor constant:16],
        [self.segmentControl.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor constant:-16],

        [self.tableView.topAnchor constraintEqualToAnchor:self.segmentControl.bottomAnchor constant:8],
        [self.tableView.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
        [self.tableView.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],
        [self.tableView.bottomAnchor constraintEqualToAnchor:webStack.topAnchor constant:-8],

        [self.consoleView.topAnchor constraintEqualToAnchor:self.segmentControl.bottomAnchor constant:8],
        [self.consoleView.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor constant:8],
        [self.consoleView.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor constant:-8],
        [self.consoleView.bottomAnchor constraintEqualToAnchor:webStack.topAnchor constant:-8],

        [webStack.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor constant:16],
        [webStack.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor constant:-16],
        [webStack.bottomAnchor constraintEqualToAnchor:sqlStack.topAnchor constant:-6],
        [webStack.heightAnchor constraintEqualToConstant:38],

        [sqlStack.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor constant:16],
        [sqlStack.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor constant:-16],
        [sqlStack.bottomAnchor constraintEqualToAnchor:btnStack.topAnchor constant:-6],
        [sqlStack.heightAnchor constraintEqualToConstant:38],

        [btnStack.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor constant:16],
        [btnStack.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor constant:-16],
        [btnStack.bottomAnchor constraintEqualToAnchor:safe.bottomAnchor constant:-8],
        [btnStack.heightAnchor constraintEqualToConstant:44],
    ]];
}

- (UIButton *)makeButton:(NSString *)title color:(UIColor *)color action:(SEL)action {
    UIButton *btn = [UIButton buttonWithType:UIButtonTypeSystem];
    [btn setTitle:title forState:UIControlStateNormal];
    btn.backgroundColor = color;
    [btn setTitleColor:UIColor.whiteColor forState:UIControlStateNormal];
    btn.titleLabel.font = [UIFont boldSystemFontOfSize:15];
    btn.layer.cornerRadius = 10;
    btn.clipsToBounds = YES;
    [btn addTarget:self action:action forControlEvents:UIControlEventTouchUpInside];
    return btn;
}

#pragma mark - Actions

- (void)openWebViewTest {
    WNWebViewTestViewController *vc = [[WNWebViewTestViewController alloc] init];
    UINavigationController *nav = [[UINavigationController alloc] initWithRootViewController:vc];
    nav.modalPresentationStyle = UIModalPresentationFullScreen;
    [self presentViewController:nav animated:YES completion:nil];
}

- (void)segmentChanged:(UISegmentedControl *)seg {
    NSInteger idx = seg.selectedSegmentIndex;
    self.tableView.hidden = (idx == 2);
    self.consoleView.hidden = (idx != 2);
    if (idx == 0 || idx == 1) {
        [self.tableView reloadData];
    }
}

- (void)runAllScripts {
    [self log:@"RUN" message:@"═══ Running all test scripts ═══"];
    for (NSString *file in self.scriptFiles) {
        [self runScriptFile:file];
    }
    [self log:@"RUN" message:@"═══ All scripts finished ═══"];
    self.segmentControl.selectedSegmentIndex = 2;
    [self segmentChanged:self.segmentControl];
}

- (void)clearConsole {
    [self.consoleLog setString:@""];
    self.consoleView.text = @"";
}

- (void)createLeakExamples {
    [self log:@"LEAK" message:@"═══ Creating memory leak examples ═══"];
    [WNLeakExamples createAllLeaks];
    [self log:@"LEAK" message:[NSString stringWithFormat:
        @"Done. Orphaned pool: %lu objects. Run test_leak_detector.js to detect.",
        (unsigned long)[WNLeakExamples orphanedCount]]];
    self.segmentControl.selectedSegmentIndex = 2;
    [self segmentChanged:self.segmentControl];
}

- (void)createSQLiteDemo {
    [self log:@"SQLITE" message:@"═══ Creating SQLite demo database ═══"];
    NSString *path = [WNSQLiteDemo createDemoDatabase];
    [self log:@"SQLITE" message:[NSString stringWithFormat:@"Database created at: %@", path]];
    [self log:@"SQLITE" message:@"Tables: users (8 rows), products (10 rows), orders (10 rows), events (15 rows)"];
    [self log:@"SQLITE" message:@"💡 Use VS Code SQLite Browser or snippets to explore this database."];
    [self log:@"SQLITE" message:@"💡 Tap \"⚡ Activity\" to simulate data changes for snapshot/diff/watch testing."];
    self.segmentControl.selectedSegmentIndex = 2;
    [self segmentChanged:self.segmentControl];
}

- (void)simulateSQLiteActivity {
    NSString *result = [WNSQLiteDemo simulateUserActivity];
    if ([result hasPrefix:@"ERROR"]) {
        [self log:@"SQLITE" message:result];
    } else {
        [self log:@"SQLITE" message:[NSString stringWithFormat:@"📝 %@", result]];
    }
    self.segmentControl.selectedSegmentIndex = 2;
    [self segmentChanged:self.segmentControl];
}

- (void)runScriptFile:(NSString *)fileName {
    NSString *scriptsDir = [[[NSBundle mainBundle] resourcePath]
                            stringByAppendingPathComponent:@"test-scripts"];
    NSString *path = [scriptsDir stringByAppendingPathComponent:fileName];
    NSError *error;
    NSString *code = [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:&error];
    if (!code) {
        [self log:@"ERROR" message:[NSString stringWithFormat:@"Cannot read %@: %@", fileName, error.localizedDescription]];
        return;
    }
    [self log:@"RUN" message:[NSString stringWithFormat:@"▶ %@", fileName]];
    [self.engine loadScript:code name:fileName];
}

#pragma mark - UITableViewDataSource

- (BOOL)isNetworkTab {
    return self.segmentControl.selectedSegmentIndex == 1;
}

- (NSInteger)numberOfSectionsInTableView:(UITableView *)tableView {
    return 1;
}

- (NSString *)tableView:(UITableView *)tableView titleForHeaderInSection:(NSInteger)section {
    if ([self isNetworkTab]) {
        return [NSString stringWithFormat:@"Network Tests (%lu)", (unsigned long)self.networkTests.count];
    }
    return [NSString stringWithFormat:@"Test Scripts (%lu)", (unsigned long)self.scriptFiles.count];
}

- (NSInteger)tableView:(UITableView *)tableView numberOfRowsInSection:(NSInteger)section {
    if ([self isNetworkTab]) {
        return (NSInteger)self.networkTests.count;
    }
    return (NSInteger)self.scriptFiles.count;
}

- (UITableViewCell *)tableView:(UITableView *)tableView cellForRowAtIndexPath:(NSIndexPath *)indexPath {
    if ([self isNetworkTab]) {
        UITableViewCell *cell = [tableView dequeueReusableCellWithIdentifier:kNetworkCellID forIndexPath:indexPath];
        NSDictionary *test = self.networkTests[(NSUInteger)indexPath.row];
        cell.textLabel.text = [NSString stringWithFormat:@"%@ %@", test[@"emoji"], test[@"title"]];
        cell.textLabel.font = [UIFont systemFontOfSize:15 weight:UIFontWeightMedium];
        cell.accessoryType = UITableViewCellAccessoryDisclosureIndicator;

        NSUInteger lastIndex = self.networkTests.count - 1;
        if ((NSUInteger)indexPath.row == lastIndex) {
            cell.textLabel.textColor = UIColor.systemOrangeColor;
            cell.textLabel.font = [UIFont boldSystemFontOfSize:16];
        } else {
            cell.textLabel.textColor = UIColor.labelColor;
        }
        return cell;
    }

    UITableViewCell *cell = [tableView dequeueReusableCellWithIdentifier:kCellID forIndexPath:indexPath];
    NSString *name = self.scriptFiles[(NSUInteger)indexPath.row];
    cell.textLabel.text = name;
    cell.textLabel.font = [UIFont monospacedSystemFontOfSize:14 weight:UIFontWeightMedium];
    cell.textLabel.textColor = UIColor.labelColor;
    cell.accessoryType = UITableViewCellAccessoryDisclosureIndicator;
    return cell;
}

#pragma mark - UITableViewDelegate

- (void)tableView:(UITableView *)tableView didSelectRowAtIndexPath:(NSIndexPath *)indexPath {
    [tableView deselectRowAtIndexPath:indexPath animated:YES];

    if ([self isNetworkTab]) {
        [self runNetworkTestAtIndex:(NSUInteger)indexPath.row];
        self.segmentControl.selectedSegmentIndex = 2;
        [self segmentChanged:self.segmentControl];
        return;
    }

    NSString *file = self.scriptFiles[(NSUInteger)indexPath.row];
    [self runScriptFile:file];
    self.segmentControl.selectedSegmentIndex = 2;
    [self segmentChanged:self.segmentControl];
}

#pragma mark - WNJSEngineDelegate

- (void)jsEngine:(id)engine didReceiveConsoleMessage:(NSString *)message level:(NSString *)level {
    [self log:level message:message];
}

- (void)jsEngine:(id)engine didReceiveScriptError:(NSString *)error {
    [self log:@"ERROR" message:error];
}

#pragma mark - Console logging

- (void)log:(NSString *)tag message:(NSString *)message {
    NSString *ts = [self timestamp];
    NSString *line = [NSString stringWithFormat:@"[%@][%@] %@\n", ts, tag, message];
    dispatch_async(dispatch_get_main_queue(), ^{
        [self.consoleLog appendString:line];
        self.consoleView.text = self.consoleLog;
        if (self.consoleLog.length > 0) {
            NSRange bottom = NSMakeRange(self.consoleLog.length - 1, 1);
            [self.consoleView scrollRangeToVisible:bottom];
        }
    });
}

- (NSString *)timestamp {
    static NSDateFormatter *fmt;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        fmt = [[NSDateFormatter alloc] init];
        fmt.dateFormat = @"HH:mm:ss.SSS";
    });
    return [fmt stringFromDate:[NSDate date]];
}

@end
