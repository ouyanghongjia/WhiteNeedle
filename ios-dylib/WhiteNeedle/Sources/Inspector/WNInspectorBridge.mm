#import "WNInspectorBridge.h"
#import "WNInspectorCAPI.h"

static NSString *const kLogPrefix = @"[WNInspector]";

static void inspectorMessageCallback(const char *message, void *userData) {
    if (!message || !userData) return;

    WNInspectorBridge *bridge = (__bridge WNInspectorBridge *)userData;
    NSString *msg = [NSString stringWithUTF8String:message];
    if (!msg) return;

    [bridge.delegate inspectorBridge:bridge didReceiveMessage:msg];
}

@interface WNInspectorBridge ()
@property (nonatomic, strong) JSContext *context;
@property (nonatomic, assign) WNInspectorSession session;
@property (nonatomic, assign) BOOL isConnected;
@end

@implementation WNInspectorBridge

+ (BOOL)isAvailable {
    return WNInspectorIsAvailable();
}

- (instancetype)initWithContext:(JSContext *)context {
    self = [super init];
    if (self) {
        _context = context;
        _session = NULL;
        _isConnected = NO;
    }
    return self;
}

- (void)dealloc {
    [self disconnect];
}

- (BOOL)connect {
    if (self.isConnected) {
        NSLog(@"%@ Already connected", kLogPrefix);
        return YES;
    }

    if (!self.context) {
        NSLog(@"%@ No JSContext provided", kLogPrefix);
        return NO;
    }

    JSGlobalContextRef globalCtx = [self.context JSGlobalContextRef];
    if (!globalCtx) {
        NSLog(@"%@ Failed to get JSGlobalContextRef", kLogPrefix);
        return NO;
    }

    self.session = WNInspectorConnect(globalCtx, inspectorMessageCallback,
                                       (__bridge void *)self);
    if (!self.session) {
        NSLog(@"%@ Failed to create inspector session", kLogPrefix);
        return NO;
    }

    self.isConnected = YES;
    NSLog(@"%@ Inspector bridge connected", kLogPrefix);
    return YES;
}

- (void)disconnect {
    if (!self.isConnected || !self.session) return;

    WNInspectorDisconnect(self.session);
    self.session = NULL;
    self.isConnected = NO;

    NSLog(@"%@ Inspector bridge disconnected", kLogPrefix);

    [self.delegate inspectorBridgeDidDisconnect:self];
}

- (void)dispatchMessage:(NSString *)message {
    if (!self.isConnected || !self.session) return;

    const char *utf8 = [message UTF8String];
    if (!utf8) return;

    WNInspectorDispatchMessage(self.session, utf8);
}

@end
