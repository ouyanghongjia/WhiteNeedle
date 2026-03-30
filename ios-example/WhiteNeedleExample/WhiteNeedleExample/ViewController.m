#import "ViewController.h"
#import <WhiteNeedle/WNJSEngine.h>
#import <WhiteNeedle/WNHookEngine.h>
#import <WhiteNeedle/WNNativeBridge.h>
#import <WhiteNeedle/WNModuleLoader.h>

static NSString *const kCellID = @"ScriptCell";

@interface ViewController ()
@property (nonatomic, strong) UITableView *tableView;
@property (nonatomic, strong) UITextView  *consoleView;
@property (nonatomic, strong) UIButton    *runAllButton;
@property (nonatomic, strong) UIButton    *clearButton;
@property (nonatomic, strong) UISegmentedControl *segmentControl;

@property (nonatomic, strong) WNJSEngine  *engine;
@property (nonatomic, strong) NSArray<NSString *> *scriptFiles;
@property (nonatomic, strong) NSMutableString *consoleLog;
@end

@implementation ViewController

#pragma mark - Lifecycle

- (void)viewDidLoad {
    [super viewDidLoad];
    self.title = @"WhiteNeedle Tests";
    self.view.backgroundColor = UIColor.systemBackgroundColor;
    self.consoleLog = [NSMutableString string];

    [[NSUserDefaults standardUserDefaults] setBool:YES forKey:@"boolTest"];
    [[NSUserDefaults standardUserDefaults] setObject:@"this is a string object" forKey:@"stringTest"];
    [[NSUserDefaults standardUserDefaults] setDouble:10.3 forKey:@"doubleTest"];
    
    NSUserDefaults *userDefaults = [[NSUserDefaults alloc] initWithSuiteName:@"yun"];
    [userDefaults setBool:YES forKey:@"boolTest_suite"];
    [userDefaults setObject:@"this is a string object" forKey:@"stringTest_suite"];
    [userDefaults setDouble:10.3 forKey:@"doubleTest_suite"];
    
    [self setupEngine];
    [self loadScriptList];
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
                            stringByAppendingPathComponent:@"sample-scripts"];
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

#pragma mark - UI

- (void)buildUI {
    self.segmentControl = [[UISegmentedControl alloc] initWithItems:@[@"Scripts", @"Console"]];
    self.segmentControl.selectedSegmentIndex = 0;
    [self.segmentControl addTarget:self action:@selector(segmentChanged:) forControlEvents:UIControlEventValueChanged];
    self.segmentControl.translatesAutoresizingMaskIntoConstraints = NO;

    self.tableView = [[UITableView alloc] initWithFrame:CGRectZero style:UITableViewStyleInsetGrouped];
    self.tableView.dataSource = self;
    self.tableView.delegate = self;
    self.tableView.translatesAutoresizingMaskIntoConstraints = NO;
    [self.tableView registerClass:[UITableViewCell class] forCellReuseIdentifier:kCellID];

    self.consoleView = [[UITextView alloc] init];
    self.consoleView.editable = NO;
    self.consoleView.font = [UIFont monospacedSystemFontOfSize:11 weight:UIFontWeightRegular];
    self.consoleView.backgroundColor = [UIColor colorWithRed:0.1 green:0.1 blue:0.12 alpha:1];
    self.consoleView.textColor = [UIColor colorWithRed:0.0 green:1.0 blue:0.4 alpha:1];
    self.consoleView.translatesAutoresizingMaskIntoConstraints = NO;
    self.consoleView.hidden = YES;

    UIStackView *btnStack = [[UIStackView alloc] init];
    btnStack.axis = UILayoutConstraintAxisHorizontal;
    btnStack.distribution = UIStackViewDistributionFillEqually;
    btnStack.spacing = 12;
    btnStack.translatesAutoresizingMaskIntoConstraints = NO;

    self.runAllButton = [self makeButton:@"▶ Run All" color:UIColor.systemGreenColor action:@selector(runAllScripts)];
    self.clearButton  = [self makeButton:@"✕ Clear"   color:UIColor.systemRedColor   action:@selector(clearConsole)];
    [btnStack addArrangedSubview:self.runAllButton];
    [btnStack addArrangedSubview:self.clearButton];

    [self.view addSubview:self.segmentControl];
    [self.view addSubview:self.tableView];
    [self.view addSubview:self.consoleView];
    [self.view addSubview:btnStack];

    UILayoutGuide *safe = self.view.safeAreaLayoutGuide;
    [NSLayoutConstraint activateConstraints:@[
        [self.segmentControl.topAnchor constraintEqualToAnchor:safe.topAnchor constant:8],
        [self.segmentControl.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor constant:16],
        [self.segmentControl.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor constant:-16],

        [self.tableView.topAnchor constraintEqualToAnchor:self.segmentControl.bottomAnchor constant:8],
        [self.tableView.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
        [self.tableView.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],
        [self.tableView.bottomAnchor constraintEqualToAnchor:btnStack.topAnchor constant:-8],

        [self.consoleView.topAnchor constraintEqualToAnchor:self.segmentControl.bottomAnchor constant:8],
        [self.consoleView.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor constant:8],
        [self.consoleView.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor constant:-8],
        [self.consoleView.bottomAnchor constraintEqualToAnchor:btnStack.topAnchor constant:-8],

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

- (void)segmentChanged:(UISegmentedControl *)seg {
    BOOL showConsole = seg.selectedSegmentIndex == 1;
    self.tableView.hidden = showConsole;
    self.consoleView.hidden = !showConsole;
}

- (void)runAllScripts {
    [self log:@"RUN" message:@"═══ Running all test scripts ═══"];
    for (NSString *file in self.scriptFiles) {
        [self runScriptFile:file];
    }
    [self log:@"RUN" message:@"═══ All scripts finished ═══"];
    self.segmentControl.selectedSegmentIndex = 1;
    [self segmentChanged:self.segmentControl];
}

- (void)clearConsole {
//    [self.consoleLog setString:@""];
//    self.consoleView.text = @"";
    ViewController *vc = [ViewController new];
    vc.title = @"测试";
    [self presentViewController:vc animated:YES completion:nil];
}

- (void)runScriptFile:(NSString *)fileName {
    NSString *scriptsDir = [[[NSBundle mainBundle] resourcePath]
                            stringByAppendingPathComponent:@"sample-scripts"];
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

- (NSInteger)numberOfSectionsInTableView:(UITableView *)tableView {
    return 1;
}

- (NSString *)tableView:(UITableView *)tableView titleForHeaderInSection:(NSInteger)section {
    return [NSString stringWithFormat:@"Test Scripts (%lu)", (unsigned long)self.scriptFiles.count];
}

- (NSInteger)tableView:(UITableView *)tableView numberOfRowsInSection:(NSInteger)section {
    return (NSInteger)self.scriptFiles.count;
}

- (UITableViewCell *)tableView:(UITableView *)tableView cellForRowAtIndexPath:(NSIndexPath *)indexPath {
    UITableViewCell *cell = [tableView dequeueReusableCellWithIdentifier:kCellID forIndexPath:indexPath];
    NSString *name = self.scriptFiles[(NSUInteger)indexPath.row];
    cell.textLabel.text = name;
    cell.textLabel.font = [UIFont monospacedSystemFontOfSize:14 weight:UIFontWeightMedium];
    cell.accessoryType = UITableViewCellAccessoryDisclosureIndicator;
    return cell;
}

#pragma mark - UITableViewDelegate

- (void)tableView:(UITableView *)tableView didSelectRowAtIndexPath:(NSIndexPath *)indexPath {
    [tableView deselectRowAtIndexPath:indexPath animated:YES];
    NSString *file = self.scriptFiles[(NSUInteger)indexPath.row];
    [self runScriptFile:file];
    self.segmentControl.selectedSegmentIndex = 1;
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
