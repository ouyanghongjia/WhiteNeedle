#import "WNAutoTestViewController.h"

#pragma mark - WNAutoTestDataService (async callback target for hook testing)

@interface WNAutoTestDataService : NSObject
+ (instancetype)shared;
- (void)fetchDataWithCompletion:(void (^)(NSDictionary *result))completion;
- (void)loginWithUsername:(NSString *)username
                password:(NSString *)password
              completion:(void (^)(BOOL success, NSString *token))completion;
@end

@implementation WNAutoTestDataService

+ (instancetype)shared {
    static WNAutoTestDataService *inst;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{ inst = [WNAutoTestDataService new]; });
    return inst;
}

- (void)fetchDataWithCompletion:(void (^)(NSDictionary *))completion {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
        if (completion) {
            completion(@{
                @"status": @"ok",
                @"items": @[@"alpha", @"beta", @"gamma"],
                @"count": @3
            });
        }
    });
}

- (void)loginWithUsername:(NSString *)username
                password:(NSString *)password
              completion:(void (^)(BOOL, NSString *))completion {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.3 * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
        BOOL ok = [username isEqualToString:@"admin"] && [password isEqualToString:@"secret"];
        if (completion) {
            completion(ok, ok ? @"tok_abc123" : nil);
        }
    });
}

@end

#pragma mark - WNAutoTestViewController

@interface WNAutoTestViewController () <UITableViewDataSource, UITableViewDelegate,
                                        UISearchBarDelegate>
@property (nonatomic, strong) UIScrollView *scrollView;
@property (nonatomic, strong) UIStackView  *mainStack;

@property (nonatomic, strong) UILabel     *headerLabel;
@property (nonatomic, strong) UITextField *usernameField;
@property (nonatomic, strong) UITextField *passwordField;
@property (nonatomic, strong) UIButton    *loginButton;
@property (nonatomic, strong) UILabel     *loginStatusLabel;

@property (nonatomic, strong) UIButton    *tapButton;
@property (nonatomic, strong) UILabel     *tapCountLabel;
@property (nonatomic, assign) NSInteger    tapCount;

@property (nonatomic, strong) UIButton    *doubleTapButton;
@property (nonatomic, strong) UILabel     *doubleTapLabel;

@property (nonatomic, strong) UIButton    *longPressButton;
@property (nonatomic, strong) UILabel     *longPressLabel;

@property (nonatomic, strong) UISwitch    *testSwitch;
@property (nonatomic, strong) UILabel     *switchLabel;

@property (nonatomic, strong) UISlider    *testSlider;
@property (nonatomic, strong) UILabel     *sliderLabel;

@property (nonatomic, strong) UISegmentedControl *testSegment;
@property (nonatomic, strong) UILabel     *segmentLabel;

@property (nonatomic, strong) UIDatePicker *testDatePicker;
@property (nonatomic, strong) UILabel      *dateLabel;

@property (nonatomic, strong) UITextView  *textView;

@property (nonatomic, strong) UITableView *testTableView;
@property (nonatomic, strong) NSArray<NSString *> *tableItems;

@property (nonatomic, strong) UISearchBar *searchBar;

@property (nonatomic, strong) UIButton    *alertButton;
@property (nonatomic, strong) UILabel     *alertResultLabel;

@property (nonatomic, strong) UIButton    *navPushButton;
@property (nonatomic, strong) UIButton    *asyncFetchButton;
@property (nonatomic, strong) UILabel     *asyncResultLabel;

@property (nonatomic, strong) UIButton    *asyncLoginButton;
@property (nonatomic, strong) UILabel     *asyncLoginLabel;

@property (nonatomic, strong) UIActivityIndicatorView *spinner;

@property (nonatomic, strong) UIView      *hiddenView;
@property (nonatomic, strong) UIView      *disabledView;

@end

@implementation WNAutoTestViewController

#pragma mark - Lifecycle

- (void)viewDidLoad {
    [super viewDidLoad];
    self.title = @"Auto Test Playground";
    self.view.backgroundColor = UIColor.systemBackgroundColor;
    self.tapCount = 0;
    self.tableItems = @[@"Apple", @"Banana", @"Cherry", @"Date", @"Elderberry",
                        @"Fig", @"Grape", @"Honeydew", @"Kiwi", @"Lemon"];

    if (self.navigationController) {
        self.navigationItem.rightBarButtonItem =
            [[UIBarButtonItem alloc] initWithBarButtonSystemItem:UIBarButtonSystemItemDone
                                                         target:self
                                                         action:@selector(dismissSelf)];
    }

    [self buildUI];
}

- (void)dismissSelf {
    if (self.navigationController && self.navigationController.viewControllers.count > 1) {
        [self.navigationController popViewControllerAnimated:YES];
    } else {
        [self dismissViewControllerAnimated:YES completion:nil];
    }
}

#pragma mark - Build UI

- (void)buildUI {
    self.scrollView = [[UIScrollView alloc] init];
    self.scrollView.translatesAutoresizingMaskIntoConstraints = NO;
    self.scrollView.accessibilityIdentifier = @"mainScrollView";
    [self.view addSubview:self.scrollView];

    self.mainStack = [[UIStackView alloc] init];
    self.mainStack.axis = UILayoutConstraintAxisVertical;
    self.mainStack.spacing = 16;
    self.mainStack.alignment = UIStackViewAlignmentFill;
    self.mainStack.translatesAutoresizingMaskIntoConstraints = NO;
    [self.scrollView addSubview:self.mainStack];

    UILayoutGuide *safe = self.view.safeAreaLayoutGuide;
    [NSLayoutConstraint activateConstraints:@[
        [self.scrollView.topAnchor constraintEqualToAnchor:safe.topAnchor],
        [self.scrollView.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
        [self.scrollView.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],
        [self.scrollView.bottomAnchor constraintEqualToAnchor:self.view.bottomAnchor],

        [self.mainStack.topAnchor constraintEqualToAnchor:self.scrollView.topAnchor constant:16],
        [self.mainStack.leadingAnchor constraintEqualToAnchor:self.scrollView.leadingAnchor constant:16],
        [self.mainStack.trailingAnchor constraintEqualToAnchor:self.scrollView.trailingAnchor constant:-16],
        [self.mainStack.bottomAnchor constraintEqualToAnchor:self.scrollView.bottomAnchor constant:-16],
        [self.mainStack.widthAnchor constraintEqualToAnchor:self.scrollView.widthAnchor constant:-32],
    ]];

    [self addSectionHeader:@"Login Form (type / clearText / tap)"];
    [self buildLoginSection];

    [self addSectionHeader:@"Tap Actions (tap / doubleTap / longPress)"];
    [self buildTapSection];

    [self addSectionHeader:@"Controls (setSwitch / setSlider / selectSegment / setDate)"];
    [self buildControlsSection];

    [self addSectionHeader:@"Text Input (type into UITextView)"];
    [self buildTextViewSection];

    [self addSectionHeader:@"ScrollView + TableView (scroll / scrollBy / scrollToTop)"];
    [self buildTableSection];

    [self addSectionHeader:@"Search (find.byText / find.byId / find.byClass)"];
    [self buildSearchSection];

    [self addSectionHeader:@"Alert (alert.current / alert.tapButton / alert.typeInField)"];
    [self buildAlertSection];

    [self addSectionHeader:@"Navigation (nav.push / nav.pop / nav.dismiss)"];
    [self buildNavSection];

    [self addSectionHeader:@"Async + Hook (Interceptor.attach → assert callback)"];
    [self buildAsyncSection];

    [self addSectionHeader:@"Visibility & State (props.isVisible / props.isEnabled)"];
    [self buildVisibilitySection];
}

#pragma mark - Section: Login

- (void)buildLoginSection {
    self.usernameField = [self makeTextField:@"Username" identifier:@"usernameField"];
    self.passwordField = [self makeTextField:@"Password" identifier:@"passwordField"];
    self.passwordField.secureTextEntry = YES;

    self.loginButton = [self makeActionButton:@"Login" color:UIColor.systemBlueColor
                                      action:@selector(loginTapped) identifier:@"loginButton"];

    self.loginStatusLabel = [self makeResultLabel:@"Not logged in" identifier:@"loginStatus"];

    [self.mainStack addArrangedSubview:self.usernameField];
    [self.mainStack addArrangedSubview:self.passwordField];
    [self.mainStack addArrangedSubview:self.loginButton];
    [self.mainStack addArrangedSubview:self.loginStatusLabel];
}

- (void)loginTapped {
    NSString *user = self.usernameField.text ?: @"";
    NSString *pass = self.passwordField.text ?: @"";
    if ([user isEqualToString:@"admin"] && [pass isEqualToString:@"secret"]) {
        self.loginStatusLabel.text = @"Login Success";
        self.loginStatusLabel.textColor = UIColor.systemGreenColor;
    } else {
        self.loginStatusLabel.text = @"Login Failed";
        self.loginStatusLabel.textColor = UIColor.systemRedColor;
    }
}

#pragma mark - Section: Tap

- (void)buildTapSection {
    self.tapButton = [self makeActionButton:@"Tap Me" color:UIColor.systemIndigoColor
                                     action:@selector(tapMeTapped) identifier:@"tapButton"];
    self.tapCountLabel = [self makeResultLabel:@"Taps: 0" identifier:@"tapCount"];

    self.doubleTapButton = [self makeActionButton:@"Double Tap Target" color:UIColor.systemTealColor
                                           action:@selector(doubleTapDetected) identifier:@"doubleTapButton"];
    self.doubleTapLabel = [self makeResultLabel:@"Waiting for double tap..." identifier:@"doubleTapResult"];

    self.longPressButton = [self makeActionButton:@"Long Press Target" color:UIColor.systemOrangeColor
                                           action:nil identifier:@"longPressButton"];
    UILongPressGestureRecognizer *lp = [[UILongPressGestureRecognizer alloc]
                                        initWithTarget:self action:@selector(longPressDetected:)];
    lp.minimumPressDuration = 0.5;
    [self.longPressButton addGestureRecognizer:lp];
    self.longPressLabel = [self makeResultLabel:@"Waiting for long press..." identifier:@"longPressResult"];

    [self.mainStack addArrangedSubview:self.tapButton];
    [self.mainStack addArrangedSubview:self.tapCountLabel];
    [self.mainStack addArrangedSubview:self.doubleTapButton];
    [self.mainStack addArrangedSubview:self.doubleTapLabel];
    [self.mainStack addArrangedSubview:self.longPressButton];
    [self.mainStack addArrangedSubview:self.longPressLabel];
}

- (void)tapMeTapped {
    self.tapCount++;
    self.tapCountLabel.text = [NSString stringWithFormat:@"Taps: %ld", (long)self.tapCount];
}

- (void)doubleTapDetected {
    self.doubleTapLabel.text = @"Double tap received!";
    self.doubleTapLabel.textColor = UIColor.systemGreenColor;
}

- (void)longPressDetected:(UILongPressGestureRecognizer *)gesture {
    if (gesture.state == UIGestureRecognizerStateBegan) {
        self.longPressLabel.text = @"Long press received!";
        self.longPressLabel.textColor = UIColor.systemGreenColor;
    }
}

#pragma mark - Section: Controls

- (void)buildControlsSection {
    UIStackView *switchRow = [[UIStackView alloc] init];
    switchRow.axis = UILayoutConstraintAxisHorizontal;
    switchRow.spacing = 12;
    switchRow.alignment = UIStackViewAlignmentCenter;

    UILabel *swLbl = [[UILabel alloc] init];
    swLbl.text = @"Toggle:";
    self.testSwitch = [[UISwitch alloc] init];
    self.testSwitch.accessibilityIdentifier = @"testSwitch";
    self.testSwitch.on = NO;
    [self.testSwitch addTarget:self action:@selector(switchChanged:) forControlEvents:UIControlEventValueChanged];
    self.switchLabel = [self makeResultLabel:@"OFF" identifier:@"switchStatus"];

    [switchRow addArrangedSubview:swLbl];
    [switchRow addArrangedSubview:self.testSwitch];
    [switchRow addArrangedSubview:self.switchLabel];
    [self.mainStack addArrangedSubview:switchRow];

    self.testSlider = [[UISlider alloc] init];
    self.testSlider.accessibilityIdentifier = @"testSlider";
    self.testSlider.minimumValue = 0;
    self.testSlider.maximumValue = 100;
    self.testSlider.value = 50;
    [self.testSlider addTarget:self action:@selector(sliderChanged:) forControlEvents:UIControlEventValueChanged];
    self.sliderLabel = [self makeResultLabel:@"Slider: 50" identifier:@"sliderValue"];
    [self.mainStack addArrangedSubview:self.testSlider];
    [self.mainStack addArrangedSubview:self.sliderLabel];

    self.testSegment = [[UISegmentedControl alloc] initWithItems:@[@"Red", @"Green", @"Blue"]];
    self.testSegment.accessibilityIdentifier = @"testSegment";
    self.testSegment.selectedSegmentIndex = 0;
    [self.testSegment addTarget:self action:@selector(segmentChanged:) forControlEvents:UIControlEventValueChanged];
    self.segmentLabel = [self makeResultLabel:@"Selected: Red" identifier:@"segmentValue"];
    [self.mainStack addArrangedSubview:self.testSegment];
    [self.mainStack addArrangedSubview:self.segmentLabel];

    self.testDatePicker = [[UIDatePicker alloc] init];
    self.testDatePicker.accessibilityIdentifier = @"testDatePicker";
    self.testDatePicker.datePickerMode = UIDatePickerModeDate;
    if (@available(iOS 13.4, *)) {
        self.testDatePicker.preferredDatePickerStyle = UIDatePickerStyleCompact;
    }
    [self.testDatePicker addTarget:self action:@selector(dateChanged:) forControlEvents:UIControlEventValueChanged];
    self.dateLabel = [self makeResultLabel:@"Date: (not changed)" identifier:@"dateValue"];
    [self.mainStack addArrangedSubview:self.testDatePicker];
    [self.mainStack addArrangedSubview:self.dateLabel];
}

- (void)switchChanged:(UISwitch *)sw {
    self.switchLabel.text = sw.isOn ? @"ON" : @"OFF";
    self.switchLabel.textColor = sw.isOn ? UIColor.systemGreenColor : UIColor.systemRedColor;
}

- (void)sliderChanged:(UISlider *)sl {
    self.sliderLabel.text = [NSString stringWithFormat:@"Slider: %d", (int)roundf(sl.value)];
}

- (void)segmentChanged:(UISegmentedControl *)seg {
    NSArray *names = @[@"Red", @"Green", @"Blue"];
    self.segmentLabel.text = [NSString stringWithFormat:@"Selected: %@",
                              names[(NSUInteger)seg.selectedSegmentIndex]];
}

- (void)dateChanged:(UIDatePicker *)dp {
    NSDateFormatter *fmt = [[NSDateFormatter alloc] init];
    fmt.dateFormat = @"yyyy-MM-dd";
    self.dateLabel.text = [NSString stringWithFormat:@"Date: %@", [fmt stringFromDate:dp.date]];
}

#pragma mark - Section: TextView

- (void)buildTextViewSection {
    self.textView = [[UITextView alloc] init];
    self.textView.accessibilityIdentifier = @"testTextView";
    self.textView.font = [UIFont systemFontOfSize:16];
    self.textView.layer.borderColor = UIColor.separatorColor.CGColor;
    self.textView.layer.borderWidth = 1;
    self.textView.layer.cornerRadius = 8;
    self.textView.text = @"";
    [self.textView.heightAnchor constraintEqualToConstant:80].active = YES;
    [self.mainStack addArrangedSubview:self.textView];
}

#pragma mark - Section: TableView

- (void)buildTableSection {
    self.testTableView = [[UITableView alloc] initWithFrame:CGRectZero style:UITableViewStylePlain];
    self.testTableView.accessibilityIdentifier = @"testTableView";
    self.testTableView.dataSource = self;
    self.testTableView.delegate = self;
    self.testTableView.scrollEnabled = YES;
    [self.testTableView registerClass:[UITableViewCell class] forCellReuseIdentifier:@"FruitCell"];
    [self.testTableView.heightAnchor constraintEqualToConstant:200].active = YES;
    self.testTableView.layer.borderColor = UIColor.separatorColor.CGColor;
    self.testTableView.layer.borderWidth = 1;
    self.testTableView.layer.cornerRadius = 8;
    [self.mainStack addArrangedSubview:self.testTableView];
}

#pragma mark - Section: Search

- (void)buildSearchSection {
    self.searchBar = [[UISearchBar alloc] init];
    self.searchBar.accessibilityIdentifier = @"testSearchBar";
    self.searchBar.placeholder = @"Search fruits...";
    self.searchBar.delegate = self;
    [self.mainStack addArrangedSubview:self.searchBar];
}

- (void)searchBar:(UISearchBar *)searchBar textDidChange:(NSString *)searchText {
    // placeholder for automation to verify text input via props
}

#pragma mark - Section: Alert

- (void)buildAlertSection {
    self.alertButton = [self makeActionButton:@"Show Alert" color:UIColor.systemRedColor
                                      action:@selector(showTestAlert) identifier:@"alertButton"];
    self.alertResultLabel = [self makeResultLabel:@"No alert shown yet" identifier:@"alertResult"];
    [self.mainStack addArrangedSubview:self.alertButton];
    [self.mainStack addArrangedSubview:self.alertResultLabel];

    UIButton *inputAlertBtn = [self makeActionButton:@"Show Input Alert" color:UIColor.systemPurpleColor
                                              action:@selector(showInputAlert) identifier:@"inputAlertButton"];
    [self.mainStack addArrangedSubview:inputAlertBtn];
}

- (void)showTestAlert {
    UIAlertController *ac = [UIAlertController alertControllerWithTitle:@"Test Alert"
                                                               message:@"Choose an option"
                                                        preferredStyle:UIAlertControllerStyleAlert];
    [ac addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel
                                         handler:^(UIAlertAction *a) {
        self.alertResultLabel.text = @"Alert: Cancel";
    }]];
    [ac addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault
                                         handler:^(UIAlertAction *a) {
        self.alertResultLabel.text = @"Alert: OK";
        self.alertResultLabel.textColor = UIColor.systemGreenColor;
    }]];
    [self presentViewController:ac animated:YES completion:nil];
}

- (void)showInputAlert {
    UIAlertController *ac = [UIAlertController alertControllerWithTitle:@"Input Alert"
                                                               message:@"Enter a value"
                                                        preferredStyle:UIAlertControllerStyleAlert];
    [ac addTextFieldWithConfigurationHandler:^(UITextField *tf) {
        tf.placeholder = @"Type here...";
        tf.accessibilityIdentifier = @"alertTextField";
    }];
    [ac addAction:[UIAlertAction actionWithTitle:@"Submit" style:UIAlertActionStyleDefault
                                         handler:^(UIAlertAction *a) {
        NSString *val = ac.textFields.firstObject.text ?: @"";
        self.alertResultLabel.text = [NSString stringWithFormat:@"Input: %@", val];
        self.alertResultLabel.textColor = UIColor.systemBlueColor;
    }]];
    [ac addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:nil]];
    [self presentViewController:ac animated:YES completion:nil];
}

#pragma mark - Section: Navigation

- (void)buildNavSection {
    self.navPushButton = [self makeActionButton:@"Push Detail VC" color:UIColor.systemGreenColor
                                        action:@selector(pushDetailVC) identifier:@"navPushButton"];
    [self.mainStack addArrangedSubview:self.navPushButton];
}

- (void)pushDetailVC {
    UIViewController *detail = [[UIViewController alloc] init];
    detail.title = @"Detail Page";
    detail.view.backgroundColor = UIColor.systemBackgroundColor;
    detail.view.accessibilityIdentifier = @"detailView";

    UILabel *lbl = [[UILabel alloc] init];
    lbl.text = @"This is the detail page";
    lbl.accessibilityIdentifier = @"detailLabel";
    lbl.textAlignment = NSTextAlignmentCenter;
    lbl.translatesAutoresizingMaskIntoConstraints = NO;
    [detail.view addSubview:lbl];
    [NSLayoutConstraint activateConstraints:@[
        [lbl.centerXAnchor constraintEqualToAnchor:detail.view.centerXAnchor],
        [lbl.centerYAnchor constraintEqualToAnchor:detail.view.centerYAnchor],
    ]];

    if (self.navigationController) {
        [self.navigationController pushViewController:detail animated:YES];
    } else {
        UINavigationController *nav = [[UINavigationController alloc] initWithRootViewController:detail];
        detail.navigationItem.rightBarButtonItem =
            [[UIBarButtonItem alloc] initWithBarButtonSystemItem:UIBarButtonSystemItemDone
                                                         target:detail
                                                         action:@selector(wn_dismissSelf)];
        nav.modalPresentationStyle = UIModalPresentationFullScreen;
        [self presentViewController:nav animated:YES completion:nil];
    }
}

#pragma mark - Section: Async + Hook

- (void)buildAsyncSection {
    self.asyncFetchButton = [self makeActionButton:@"Fetch Data (async)" color:UIColor.systemCyanColor
                                            action:@selector(fetchDataTapped) identifier:@"asyncFetchButton"];
    self.asyncResultLabel = [self makeResultLabel:@"No data fetched" identifier:@"asyncResult"];
    [self.mainStack addArrangedSubview:self.asyncFetchButton];
    [self.mainStack addArrangedSubview:self.asyncResultLabel];

    self.asyncLoginButton = [self makeActionButton:@"Async Login (hookable)" color:UIColor.systemMintColor
                                            action:@selector(asyncLoginTapped) identifier:@"asyncLoginButton"];
    self.asyncLoginLabel = [self makeResultLabel:@"Async login not started" identifier:@"asyncLoginResult"];
    [self.mainStack addArrangedSubview:self.asyncLoginButton];
    [self.mainStack addArrangedSubview:self.asyncLoginLabel];

    self.spinner = [[UIActivityIndicatorView alloc] initWithActivityIndicatorStyle:UIActivityIndicatorViewStyleMedium];
    self.spinner.accessibilityIdentifier = @"loadingSpinner";
    self.spinner.hidesWhenStopped = YES;
    [self.mainStack addArrangedSubview:self.spinner];
}

- (void)fetchDataTapped {
    self.asyncResultLabel.text = @"Loading...";
    [self.spinner startAnimating];
    [[WNAutoTestDataService shared] fetchDataWithCompletion:^(NSDictionary *result) {
        [self.spinner stopAnimating];
        self.asyncResultLabel.text = [NSString stringWithFormat:@"Fetched: %@ (%@ items)",
                                      result[@"status"], result[@"count"]];
        self.asyncResultLabel.textColor = UIColor.systemGreenColor;
    }];
}

- (void)asyncLoginTapped {
    NSString *user = self.usernameField.text ?: @"";
    NSString *pass = self.passwordField.text ?: @"";
    self.asyncLoginLabel.text = @"Logging in...";
    [self.spinner startAnimating];
    [[WNAutoTestDataService shared] loginWithUsername:user password:pass completion:^(BOOL success, NSString *token) {
        [self.spinner stopAnimating];
        if (success) {
            self.asyncLoginLabel.text = [NSString stringWithFormat:@"Token: %@", token];
            self.asyncLoginLabel.textColor = UIColor.systemGreenColor;
        } else {
            self.asyncLoginLabel.text = @"Async login failed";
            self.asyncLoginLabel.textColor = UIColor.systemRedColor;
        }
    }];
}

#pragma mark - Section: Visibility

- (void)buildVisibilitySection {
    self.hiddenView = [[UIView alloc] init];
    self.hiddenView.accessibilityIdentifier = @"hiddenTestView";
    self.hiddenView.backgroundColor = UIColor.systemYellowColor;
    self.hiddenView.hidden = YES;
    [self.hiddenView.heightAnchor constraintEqualToConstant:30].active = YES;
    [self.mainStack addArrangedSubview:self.hiddenView];

    UIButton *disabledBtn = [self makeActionButton:@"Disabled Button" color:UIColor.systemGrayColor
                                            action:nil identifier:@"disabledButton"];
    disabledBtn.enabled = NO;
    [self.mainStack addArrangedSubview:disabledBtn];

    UILabel *footer = [self makeResultLabel:@"— End of Test Playground —" identifier:@"footer"];
    footer.textAlignment = NSTextAlignmentCenter;
    footer.textColor = UIColor.tertiaryLabelColor;
    [self.mainStack addArrangedSubview:footer];
}

#pragma mark - UITableViewDataSource

- (NSInteger)tableView:(UITableView *)tableView numberOfRowsInSection:(NSInteger)section {
    return (NSInteger)self.tableItems.count;
}

- (UITableViewCell *)tableView:(UITableView *)tableView cellForRowAtIndexPath:(NSIndexPath *)indexPath {
    UITableViewCell *cell = [tableView dequeueReusableCellWithIdentifier:@"FruitCell" forIndexPath:indexPath];
    cell.textLabel.text = self.tableItems[(NSUInteger)indexPath.row];
    cell.accessibilityIdentifier = [NSString stringWithFormat:@"fruit_%ld", (long)indexPath.row];
    return cell;
}

#pragma mark - UITableViewDelegate

- (void)tableView:(UITableView *)tableView didSelectRowAtIndexPath:(NSIndexPath *)indexPath {
    [tableView deselectRowAtIndexPath:indexPath animated:YES];
}

#pragma mark - Helpers

- (void)addSectionHeader:(NSString *)title {
    UILabel *lbl = [[UILabel alloc] init];
    lbl.text = title;
    lbl.font = [UIFont boldSystemFontOfSize:15];
    lbl.textColor = UIColor.secondaryLabelColor;
    [self.mainStack addArrangedSubview:lbl];

    UIView *divider = [[UIView alloc] init];
    divider.backgroundColor = UIColor.separatorColor;
    [divider.heightAnchor constraintEqualToConstant:1].active = YES;
    [self.mainStack addArrangedSubview:divider];
}

- (UITextField *)makeTextField:(NSString *)placeholder identifier:(NSString *)identifier {
    UITextField *tf = [[UITextField alloc] init];
    tf.placeholder = placeholder;
    tf.accessibilityIdentifier = identifier;
    tf.borderStyle = UITextBorderStyleRoundedRect;
    tf.autocapitalizationType = UITextAutocapitalizationTypeNone;
    tf.autocorrectionType = UITextAutocorrectionTypeNo;
    [tf.heightAnchor constraintEqualToConstant:44].active = YES;
    return tf;
}

- (UIButton *)makeActionButton:(NSString *)title color:(UIColor *)color
                        action:(SEL _Nullable)action identifier:(NSString *)identifier {
    UIButton *btn = [UIButton buttonWithType:UIButtonTypeSystem];
    [btn setTitle:title forState:UIControlStateNormal];
    btn.accessibilityIdentifier = identifier;
    btn.backgroundColor = color;
    [btn setTitleColor:UIColor.whiteColor forState:UIControlStateNormal];
    btn.titleLabel.font = [UIFont boldSystemFontOfSize:15];
    btn.layer.cornerRadius = 10;
    btn.clipsToBounds = YES;
    if (action) {
        [btn addTarget:self action:action forControlEvents:UIControlEventTouchUpInside];
    }
    [btn.heightAnchor constraintEqualToConstant:44].active = YES;
    return btn;
}

- (UILabel *)makeResultLabel:(NSString *)text identifier:(NSString *)identifier {
    UILabel *lbl = [[UILabel alloc] init];
    lbl.text = text;
    lbl.accessibilityIdentifier = identifier;
    lbl.font = [UIFont monospacedSystemFontOfSize:14 weight:UIFontWeightMedium];
    lbl.textColor = UIColor.labelColor;
    lbl.numberOfLines = 0;
    return lbl;
}

@end

#pragma mark - UIViewController dismiss helper

@implementation UIViewController (WNAutoTestDismiss)

- (void)wn_dismissSelf {
    [self dismissViewControllerAnimated:YES completion:nil];
}

@end
